"""OCR job HTTP endpoints; execution lives in the job service."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.schemas import OcrJobResponse, OcrJobsListResponse, OcrJobStartRequest
from backend.persistence import repository
from backend.services import ocr_jobs
from backend.services.job_store import OcrJobRecord, job_store


router = APIRouter(prefix="/ocr", tags=["ocr"])


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


@router.post("/projects/{project_id}/jobs", response_model=OcrJobResponse)
def start_ocr_job(
    project_id: int,
    payload: OcrJobStartRequest,
    db: Session = Depends(get_db),
) -> OcrJobResponse:
    project = repository.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        job = ocr_jobs.start_job(project, payload.upload_id, payload.config, db)
    except ocr_jobs.JobStartError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _job_to_response(job)


@router.get("/jobs/{job_id}", response_model=OcrJobResponse)
def get_ocr_job(job_id: str) -> OcrJobResponse:
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job)


@router.get("/projects/{project_id}/jobs", response_model=OcrJobsListResponse)
def list_project_ocr_jobs(project_id: int, db: Session = Depends(get_db)) -> OcrJobsListResponse:
    project = repository.get_project(db, project_id=project_id)
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
