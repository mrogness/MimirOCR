from datetime import datetime, timezone
from pathlib import Path
import shutil
from threading import Thread
import time
import traceback
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import OcrJobResponse, OcrJobsListResponse, OcrJobStartRequest
from backend.database import Session as SessionLocal
from backend.models.project import Project
from backend.models.project_config import ProjectConfig
from backend.performance import get_active_limits
from backend.pipeline.jobs import OcrJobRecord, job_store
from backend.pipeline.runner import PipelineRunner
from backend.runtime_gate import JobReservation, runtime_gate
from backend.runtime_paths import get_output_dir, get_temp_dir


router = APIRouter(prefix="/ocr", tags=["ocr"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _job_to_response(job: OcrJobRecord) -> OcrJobResponse:
    return OcrJobResponse(
        job_id=job.job_id,
        project_id=job.project_id,
        upload_id=job.upload_id,
        status=job.status,
        phase=job.phase,
        progress=job.progress,
        message=job.message,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        error=job.error,
        transcript_path=job.transcript_path,
        project_json_path=job.project_json_path,
        total_pages=job.total_pages,
        rasterized_pages=job.rasterized_pages,
        segmented_pages=job.segmented_pages,
        ocr_pages=job.ocr_pages,
    )


def _run_ocr_job(
    *,
    job_id: str,
    project_id: int,
    project_name: str,
    source_pdf_path: str,
    source_pdf_name: str,
    request_config,
) -> None:
    run_started = time.monotonic()
    temp_dir = get_temp_dir() / f"project_{project_id}" / job_id
    output_dir = get_output_dir()
    limits = get_active_limits()

    job_store.update_job(
        job_id,
        status="running",
        phase="preparing",
        progress=5,
        message=f"Preparing OCR pipeline ({limits.profile} profile)",
        started_at=_utc_now(),
        total_pages=0,
        rasterized_pages=0,
        segmented_pages=0,
        ocr_pages=0,
    )

    try:
        config = ProjectConfig(
            project_id=str(project_id),
            project_name=project_name,
            input_pdf_path=source_pdf_path,
            temp_dir=str(temp_dir),
            output_dir=str(output_dir),
            num_workers=limits.segmentation_workers,
            device=request_config.device or "cpu",
        )

        if request_config.dpi is not None:
            config.ingestion.dpi = request_config.dpi
        if request_config.binarization_threshold is not None:
            config.ingestion.binarization_threshold = request_config.binarization_threshold
        if request_config.ocr_model_path is not None:
            config.ocr.model_path = request_config.ocr_model_path
        if request_config.strict_top_to_bottom is not None:
            config.segmentation.strict_top_to_bottom = request_config.strict_top_to_bottom

        project = Project(
            id=str(project_id),
            name=project_name,
            source_path=source_pdf_path,
            config=config,
        )

        def report_progress(
            phase: str,
            progress: int,
            message: str,
            details: Optional[dict] = None,
        ) -> None:
            details = details or {}
            job_store.update_job(
                job_id,
                status="running",
                phase=phase,
                progress=progress,
                message=message,
                total_pages=details.get("total_pages"),
                rasterized_pages=details.get("rasterized_pages"),
                segmented_pages=details.get("segmented_pages"),
                ocr_pages=details.get("ocr_pages"),
            )

        PipelineRunner(config, report_progress).process_project(project)

        persist_db = SessionLocal()
        try:
            db_project = crud.get_project(persist_db, project_id=project_id)
            if db_project:
                crud.replace_project_pages_and_lines(
                    persist_db,
                    db_project,
                    project.pages,
                    source_pdf_name=source_pdf_name,
                    source_pdf_path=source_pdf_path,
                )
                elapsed_seconds = max(0.0, time.monotonic() - run_started)
                crud.mark_project_ocr_finished(
                    persist_db,
                    db_project,
                    status="succeeded",
                    elapsed_seconds=elapsed_seconds,
                )
        finally:
            persist_db.close()

        output_root = Path(config.output_dir) / project.id
        job_store.update_job(
            job_id,
            status="succeeded",
            phase="completed",
            progress=100,
            message="OCR complete",
            finished_at=_utc_now(),
            transcript_path=str(output_root / "transcript.txt"),
            project_json_path=str(output_root / "project.json"),
            ocr_pages=len(project.pages),
        )
    except Exception as exc:  # noqa: BLE001
        details = traceback.format_exc()
        persist_db = SessionLocal()
        try:
            db_project = crud.get_project(persist_db, project_id=project_id)
            if db_project:
                elapsed_seconds = max(0.0, time.monotonic() - run_started)
                crud.mark_project_ocr_finished(
                    persist_db,
                    db_project,
                    status="failed",
                    elapsed_seconds=elapsed_seconds,
                )
        finally:
            persist_db.close()

        job_store.update_job(
            job_id,
            status="failed",
            phase="failed",
            progress=100,
            message="OCR failed",
            finished_at=_utc_now(),
            error=f"{type(exc).__name__}: {exc}\n{details}",
        )
    finally:
        try:
            if temp_dir.exists() and temp_dir.is_dir():
                shutil.rmtree(temp_dir, ignore_errors=True)
        finally:
            runtime_gate.finish_job(job_id)


def _busy_error() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "ocr_job_already_running",
            "message": "Only one OCR job may run at a time.",
            "runtime": runtime_gate.snapshot(),
        },
    )


@router.post("/projects/{project_id}/jobs", response_model=OcrJobResponse)
def start_ocr_job(
    project_id: int,
    payload: OcrJobStartRequest,
    db: Session = Depends(get_db),
) -> OcrJobResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    reservation: JobReservation | None = runtime_gate.try_begin_job(project_id)
    if reservation is None:
        raise _busy_error()

    try:
        upload = job_store.consume_upload(payload.upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="Upload not found")
        if upload.project_id != project_id:
            raise HTTPException(status_code=400, detail="Upload does not belong to this project")

        crud.mark_project_ocr_started(db, project)
        job = job_store.create_job(project_id=project_id, upload_id=payload.upload_id)
        if not runtime_gate.attach_job(reservation, job.job_id):
            raise RuntimeError("OCR runtime reservation was lost before job start")

        worker = Thread(
            target=_run_ocr_job,
            kwargs={
                "job_id": job.job_id,
                "project_id": project_id,
                "project_name": project.name,
                "source_pdf_path": upload.stored_path,
                "source_pdf_name": upload.filename,
                "request_config": payload.config,
            },
            daemon=True,
            name=f"mimir-ocr-{job.job_id[:8]}",
        )
        try:
            worker.start()
        except Exception:
            runtime_gate.finish_job(job.job_id)
            raise
        return _job_to_response(job)
    except Exception:
        runtime_gate.release_reservation(reservation)
        raise


@router.get("/jobs/{job_id}", response_model=OcrJobResponse)
def get_ocr_job(job_id: str) -> OcrJobResponse:
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


@router.get("/projects/{project_id}/jobs", response_model=OcrJobsListResponse)
def list_project_ocr_jobs(project_id: int, db: Session = Depends(get_db)) -> OcrJobsListResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return OcrJobsListResponse(
        jobs=[_job_to_response(job) for job in job_store.list_project_jobs(project_id)]
    )


@router.get("/jobs/{job_id}/transcript")
def get_ocr_job_transcript(job_id: str) -> dict:
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "succeeded":
        raise HTTPException(status_code=409, detail="Job has not completed successfully")
    if not job.transcript_path:
        raise HTTPException(status_code=404, detail="Transcript path unavailable")

    path = Path(job.transcript_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Transcript file not found")
    return {"job_id": job_id, "transcript": path.read_text(encoding="utf-8")}
