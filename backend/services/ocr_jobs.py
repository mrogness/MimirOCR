"""Own OCR job reservation, execution, persistence, and cleanup."""
from datetime import datetime, timezone
from pathlib import Path
import shutil
from threading import Thread
import time
import traceback
from typing import Optional

from sqlalchemy.orm import Session

from backend.persistence import repository
from backend.persistence.database import Session as SessionLocal
from backend.domain.project import Project
from backend.domain.project_config import ProjectConfig
from backend.runtime.performance import get_active_limits
from backend.services.job_store import OcrJobRecord, job_store
from backend.pipeline.runner import PipelineRunner
from backend.runtime.gate import JobReservation, runtime_gate
from backend.runtime.paths import get_output_dir, get_temp_dir


class JobStartError(Exception):
    def __init__(self, status_code: int, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def run_ocr_job(
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
        if request_config.disambiguate_ij is not None:
            config.ocr.disambiguate_ij = request_config.disambiguate_ij
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
            db_project = repository.get_project(persist_db, project_id=project_id)
            if db_project:
                repository.replace_project_pages_and_lines(
                    persist_db,
                    db_project,
                    project.pages,
                    source_pdf_name=source_pdf_name,
                    source_pdf_path=source_pdf_path,
                )
                elapsed_seconds = max(0.0, time.monotonic() - run_started)
                repository.mark_project_ocr_finished(
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
            db_project = repository.get_project(persist_db, project_id=project_id)
            if db_project:
                elapsed_seconds = max(0.0, time.monotonic() - run_started)
                repository.mark_project_ocr_finished(
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


def _busy_error() -> JobStartError:
    return JobStartError(
        status_code=409,
        detail={
            "code": "ocr_job_already_running",
            "message": "Only one OCR job may run at a time.",
            "runtime": runtime_gate.snapshot(),
        },
    )


def start_job(project, upload_id: str, request_config, db: Session) -> OcrJobRecord:
    """Reserve the runtime and start the same background document job."""
    project_id = project.id
    reservation: JobReservation | None = runtime_gate.try_begin_job(project_id)
    if reservation is None:
        raise _busy_error()

    try:
        upload = job_store.consume_upload(upload_id)
        if not upload:
            raise JobStartError(status_code=404, detail="Upload not found")
        if upload.project_id != project_id:
            raise JobStartError(status_code=400, detail="Upload does not belong to this project")

        repository.mark_project_ocr_started(db, project)
        job = job_store.create_job(project_id=project_id, upload_id=upload_id)
        if not runtime_gate.attach_job(reservation, job.job_id):
            raise RuntimeError("OCR runtime reservation was lost before job start")

        worker = Thread(
            target=run_ocr_job,
            kwargs={
                "job_id": job.job_id,
                "project_id": project_id,
                "project_name": project.name,
                "source_pdf_path": upload.stored_path,
                "source_pdf_name": upload.filename,
                "request_config": request_config,
            },
            daemon=True,
            name=f"mimir-ocr-{job.job_id[:8]}",
        )
        try:
            worker.start()
        except Exception:
            runtime_gate.finish_job(job.job_id)
            raise
        return job
    except Exception:
        runtime_gate.release_reservation(reservation)
        raise
