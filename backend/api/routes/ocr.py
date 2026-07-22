from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
from threading import Thread
import traceback
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import OcrJobResponse, OcrJobsListResponse, OcrJobStartRequest
from backend.database import Session as SessionLocal
from backend.models.project import Project
from backend.models.project_config import ProjectConfig
from backend.pipeline.jobs import OcrJobRecord, job_store
from backend.pipeline.runner import PipelineRunner
from backend.runtime_paths import get_output_dir, get_temp_dir

router = APIRouter(prefix="/ocr", tags=["ocr"])


def _apply_thread_limits(max_threads: int) -> None:
    thread_count = str(max_threads)
    os.environ["OMP_NUM_THREADS"] = thread_count
    os.environ["OMP_THREAD_LIMIT"] = thread_count
    os.environ["OPENBLAS_NUM_THREADS"] = thread_count
    os.environ["MKL_NUM_THREADS"] = thread_count
    os.environ["VECLIB_MAXIMUM_THREADS"] = thread_count
    os.environ["NUMEXPR_NUM_THREADS"] = thread_count
    os.environ["BLIS_NUM_THREADS"] = thread_count
    os.environ["TF_NUM_INTRAOP_THREADS"] = thread_count
    os.environ["TF_NUM_INTEROP_THREADS"] = "1"
    os.environ["OMP_DYNAMIC"] = "FALSE"
    os.environ["MKL_DYNAMIC"] = "FALSE"
    os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"


def _resolve_ocr_thread_limit(effective_workers: int, device: str) -> int:
    env_override = os.getenv("MIMIR_OCR_THREADS")
    if env_override:
        try:
            parsed = int(env_override)
            if parsed > 0:
                return max(1, min(parsed, effective_workers))
        except ValueError:
            pass

    # OCR on CPU tends to overheat quickly when native math libraries fan out.
    # Keep a conservative default unless explicitly overridden.
    if (device or "cpu").lower() == "cpu":
        return 1

    return effective_workers


def _resolve_segmentation_worker_limit(effective_workers: int, device: str) -> int:
    env_override = os.getenv("MIMIR_SEGMENTATION_WORKERS")
    if env_override:
        try:
            parsed = int(env_override)
            if parsed > 0:
                return max(1, min(parsed, effective_workers))
        except ValueError:
            pass

    # Keep segmentation conservative by default on CPU to reduce thermal spikes.
    if (device or "cpu").lower() == "cpu":
        return max(1, min(2, effective_workers))

    return effective_workers


def _resolve_segmentation_thread_limit(segmentation_workers: int, device: str) -> int:
    env_override = os.getenv("MIMIR_SEGMENTATION_THREADS")
    if env_override:
        try:
            parsed = int(env_override)
            if parsed > 0:
                return max(1, min(parsed, segmentation_workers))
        except ValueError:
            pass

    if (device or "cpu").lower() == "cpu":
        return 1

    return segmentation_workers


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
    job_store.update_job(
        job_id,
        status="running",
        phase="preparing",
        progress=5,
        message="Preparing OCR pipeline",
        started_at=_utc_now(),
        total_pages=0,
        rasterized_pages=0,
        segmented_pages=0,
        ocr_pages=0,
    )

    try:
        requested_workers = request_config.num_workers or 4
        total_cores = os.cpu_count() or 1
        effective_workers = max(1, min(int(requested_workers), total_cores))
        effective_device = request_config.device or "cpu"
        segmentation_workers = _resolve_segmentation_worker_limit(effective_workers, effective_device)
        segmentation_threads = _resolve_segmentation_thread_limit(segmentation_workers, effective_device)
        os.environ["MIMIR_SEGMENTATION_WORKERS"] = str(segmentation_workers)
        os.environ["MIMIR_SEGMENTATION_THREADS"] = str(segmentation_threads)

        ocr_thread_limit = _resolve_ocr_thread_limit(effective_workers, effective_device)
        os.environ["MIMIR_OCR_THREADS"] = str(ocr_thread_limit)
        _apply_thread_limits(ocr_thread_limit)

        config = ProjectConfig(
            project_id=str(project_id),
            project_name=project_name,
            input_pdf_path=source_pdf_path,
            temp_dir=str(temp_dir),
            output_dir=str(output_dir),
            num_workers=effective_workers,
            device=effective_device,
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

        def report_progress(phase: str, progress: int, message: str, details: Optional[dict] = None) -> None:
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

        runner = PipelineRunner(
            config,
            report_progress,
        )
        runner.process_project(project)

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
                crud.mark_project_ocr_finished(persist_db, db_project, status="succeeded", elapsed_seconds=elapsed_seconds)
        finally:
            persist_db.close()

        output_root = Path(config.output_dir) / project.id
        transcript_path = str(output_root / "transcript.txt")
        project_json_path = str(output_root / "project.json")

        job_store.update_job(
            job_id,
            status="succeeded",
            phase="completed",
            progress=100,
            message="OCR complete",
            finished_at=_utc_now(),
            transcript_path=transcript_path,
            project_json_path=project_json_path,
            ocr_pages=len(project.pages),
        )
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, AttributeError) as exc:
        details = traceback.format_exc()
        persist_db = SessionLocal()
        try:
            db_project = crud.get_project(persist_db, project_id=project_id)
            if db_project:
                elapsed_seconds = max(0.0, time.monotonic() - run_started)
                crud.mark_project_ocr_finished(persist_db, db_project, status="failed", elapsed_seconds=elapsed_seconds)
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
        except OSError:
            pass


@router.post("/projects/{project_id}/jobs", response_model=OcrJobResponse)
def start_ocr_job(
    project_id: int,
    payload: OcrJobStartRequest,
    db: Session = Depends(get_db),
) -> OcrJobResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    crud.mark_project_ocr_started(db, project)

    upload = job_store.consume_upload(payload.upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    if upload.project_id != project_id:
        raise HTTPException(status_code=400, detail="Upload does not belong to this project")

    job = job_store.create_job(project_id=project_id, upload_id=payload.upload_id)

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
    )
    worker.start()

    return _job_to_response(job)


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

    jobs = [_job_to_response(job) for job in job_store.list_project_jobs(project_id)]
    return OcrJobsListResponse(jobs=jobs)


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

    return {
        "job_id": job_id,
        "transcript": path.read_text(encoding="utf-8"),
    }
