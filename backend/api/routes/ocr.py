from datetime import datetime, timezone
import multiprocessing as mp
import os
from pathlib import Path
import queue
import shutil
import sys
from threading import Thread
import traceback
import time
from typing import Any, Callable, Optional

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


def _is_macos_frozen_runtime() -> bool:
    return sys.platform == "darwin" and bool(getattr(sys, "frozen", False))


def _should_isolate_pipeline_runtime() -> bool:
    env = (os.getenv("MIMIR_ISOLATE_PIPELINE_PROCESS") or "").strip().lower()
    if env in {"0", "false", "no", "off"}:
        return False
    if env in {"1", "true", "yes", "on"}:
        return True
    return _is_macos_frozen_runtime()


def _pipeline_worker_main(
    project_payload: dict,
    config_payload: dict,
    progress_queue: Any,
    result_queue: Any,
) -> None:
    """Run full OCR pipeline in child process to contain native aborts."""
    project = Project.from_dict(project_payload)
    config = ProjectConfig(**config_payload)

    def report_progress(phase: str, progress: int, message: str, details: Optional[dict] = None) -> None:
        details = details or {}
        progress_queue.put((phase, progress, message, details))

    try:
        runner = PipelineRunner(config, report_progress)
        runner.process_project(project)
        result_queue.put(("ok", project.to_dict()))
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, AttributeError) as exc:
        result_queue.put(("error", f"{type(exc).__name__}: {exc}", traceback.format_exc()))


def _segment_worker_main(
    project_payload: dict,
    config_payload: dict,
    progress_queue: Any,
    result_queue: Any,
) -> None:
    from backend.stages.ingest import ingest
    from backend.stages.prepare import prepare_pages
    from backend.stages.segment import segment

    project = Project.from_dict(project_payload)
    config = ProjectConfig(**config_payload)

    try:
        last_total = 0

        def on_page_rasterized(completed: int, total: int) -> None:
            nonlocal last_total
            last_total = total
            progress = min(33, int((completed / max(1, total)) * 33))
            progress_queue.put(
                (
                    "preparing",
                    progress,
                    f"Rasterizing PDF pages ({completed}/{total})",
                    {
                        "total_pages": total,
                        "rasterized_pages": completed,
                        "segmented_pages": 0,
                        "ocr_pages": 0,
                    },
                )
            )

        pages = prepare_pages(project, config, on_page_rasterized=on_page_rasterized)
        total_pages = len(pages)
        if last_total == 0:
            last_total = total_pages

        if total_pages == 0:
            project.pages = []
            result_queue.put(("ok", project.to_dict()))
            return

        progress_queue.put(
            (
                "segmenting",
                34,
                f"Segmenting pages (0/{total_pages})",
                {
                    "total_pages": total_pages,
                    "rasterized_pages": total_pages,
                    "segmented_pages": 0,
                    "ocr_pages": 0,
                },
            )
        )

        segmented_pages = []
        for idx, page in enumerate(pages, start=1):
            processed = ingest(page, config)
            processed = segment(processed, config)
            segmented_pages.append(processed)

            progress = 34 + int((idx / total_pages) * 32)
            progress_queue.put(
                (
                    "segmenting",
                    min(66, progress),
                    f"Segmenting pages ({idx}/{total_pages})",
                    {
                        "total_pages": total_pages,
                        "rasterized_pages": total_pages,
                        "segmented_pages": idx,
                        "ocr_pages": 0,
                    },
                )
            )

        segmented_pages.sort(key=lambda p: p.page_number)
        project.pages = segmented_pages
        result_queue.put(("ok", project.to_dict()))
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, AttributeError) as exc:
        result_queue.put(("error", f"{type(exc).__name__}: {exc}", traceback.format_exc()))


def _ocr_worker_main(
    project_payload: dict,
    config_payload: dict,
    progress_queue: Any,
    result_queue: Any,
) -> None:
    from backend.stages.export import export
    from backend.stages.ocr import ocr_pages

    project = Project.from_dict(project_payload)
    config = ProjectConfig(**config_payload)

    try:
        total_pages = len(project.pages)
        progress_queue.put(
            (
                "ocr",
                67,
                f"Running OCR model (0/{total_pages} pages)",
                {
                    "total_pages": total_pages,
                    "rasterized_pages": total_pages,
                    "segmented_pages": total_pages,
                    "ocr_pages": 0,
                },
            )
        )

        def on_page_done(completed: int, total: int) -> None:
            progress = 67 + int((completed / max(1, total)) * 27)
            progress_queue.put(
                (
                    "ocr",
                    min(94, progress),
                    f"Running OCR model ({completed}/{total} pages)",
                    {
                        "total_pages": total,
                        "rasterized_pages": total,
                        "segmented_pages": total,
                        "ocr_pages": completed,
                    },
                )
            )

        project.pages = ocr_pages(project.pages, config, on_page_done=on_page_done)
        progress_queue.put(("exporting", 95, "Exporting OCR artifacts", None))
        export(project, config)
        progress_queue.put(("completed", 100, "OCR complete", None))
        result_queue.put(("ok", project.to_dict()))
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, AttributeError) as exc:
        result_queue.put(("error", f"{type(exc).__name__}: {exc}", traceback.format_exc()))


def _drain_progress_queue(progress_queue: Any, report_progress: Callable[[str, int, str, Optional[dict]], None]) -> None:
    while True:
        try:
            phase, progress, message, details = progress_queue.get_nowait()
        except queue.Empty:
            break
        report_progress(phase, progress, message, details)


def _run_isolated_worker(
    *,
    target: Callable[..., None],
    project_payload: dict,
    config_payload: dict,
    report_progress: Callable[[str, int, str, Optional[dict]], None],
    crash_label: str,
) -> dict:
    ctx = mp.get_context("spawn")
    progress_queue = ctx.Queue()
    result_queue = ctx.Queue()
    process = ctx.Process(
        target=target,
        args=(project_payload, config_payload, progress_queue, result_queue),
        daemon=True,
    )
    process.start()

    result: tuple | None = None
    while result is None:
        _drain_progress_queue(progress_queue, report_progress)

        try:
            result = result_queue.get(timeout=0.25)
            break
        except queue.Empty:
            pass

        if not process.is_alive():
            _drain_progress_queue(progress_queue, report_progress)
            try:
                result = result_queue.get_nowait()
            except queue.Empty:
                result = None
            break

    process.join(timeout=2)
    if process.is_alive():
        process.terminate()
        process.join(timeout=2)

    if result is None:
        exit_code = process.exitcode
        raise RuntimeError(f"{crash_label} crashed (exit code {exit_code})")

    status = result[0]
    if status == "ok":
        payload = result[1]
        return payload

    if status == "error":
        message = result[1]
        details = result[2]
        raise RuntimeError(f"{message}\n{details}")

    raise RuntimeError(f"Unexpected worker result: {result}")


def _run_pipeline_with_optional_isolation(
    project: Project,
    config: ProjectConfig,
    report_progress: Callable[[str, int, str, Optional[dict]], None],
) -> Project:
    if not _should_isolate_pipeline_runtime():
        runner = PipelineRunner(config, report_progress)
        runner.process_project(project)
        return project

    config_payload = config.model_dump()
    segmented_payload = _run_isolated_worker(
        target=_segment_worker_main,
        project_payload=project.to_dict(),
        config_payload=config_payload,
        report_progress=report_progress,
        crash_label="Segmentation worker",
    )
    ocr_payload = _run_isolated_worker(
        target=_ocr_worker_main,
        project_payload=segmented_payload,
        config_payload=config_payload,
        report_progress=report_progress,
        crash_label="OCR worker",
    )
    return Project.from_dict(ocr_payload)


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
        if _is_macos_frozen_runtime():
            segmentation_workers = 1
            segmentation_threads = 1
            os.environ.setdefault("MIMIR_FORCE_COREMLTOOLS_SHIM", "1")
            os.environ.setdefault("MIMIR_ISOLATE_PIPELINE_PROCESS", "1")
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

        project = _run_pipeline_with_optional_isolation(project, config, report_progress)

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
