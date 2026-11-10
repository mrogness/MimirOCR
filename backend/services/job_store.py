"""Thread-protected, bounded in-memory upload and OCR-job status records.

These records support polling within the current API process. Durable project
content belongs to the persistence layer; this store is not a job database.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List, Optional
import uuid


MAX_JOBS_RETAINED = 500
MAX_UPLOADS_RETAINED = 200
UPLOAD_TTL_SECONDS = 60 * 60


def _utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp for upload and job records."""
    return datetime.now(timezone.utc)


@dataclass
class UploadedPdfRecord:
    """An uploaded PDF's token, owner, on-disk location, and registration time."""
    upload_id: str
    project_id: int
    filename: str
    stored_path: str
    created_at: datetime


@dataclass
class OcrJobRecord:
    """Mutable status snapshot exposed to frontend OCR polling."""
    job_id: str
    project_id: int
    upload_id: str
    status: str
    phase: str
    progress: int
    message: str
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    transcript_path: Optional[str] = None
    project_json_path: Optional[str] = None
    total_pages: Optional[int] = None
    rasterized_pages: Optional[int] = None
    segmented_pages: Optional[int] = None
    ocr_pages: Optional[int] = None


class JobStore:
    """Maintain upload tokens and job snapshots under a lock.

    Pruning removes expired upload registrations and limits retained records.
    Removing a registration does not itself delete its file. Getters return
    the stored records, rather than immutable copies.
    """
    def __init__(self) -> None:
        """Create empty upload/job registries and their synchronization lock."""
        self._lock = Lock()
        self._uploads: Dict[str, UploadedPdfRecord] = {}
        self._jobs: Dict[str, OcrJobRecord] = {}

    def register_upload(self, project_id: int, filename: str, stored_path: str) -> UploadedPdfRecord:
        """Prune retained records and register a stored PDF under a new opaque upload ID.

        This method records an existing file path; it neither writes nor validates the PDF
        itself.
        """
        upload_id = str(uuid.uuid4())
        record = UploadedPdfRecord(
            upload_id=upload_id,
            project_id=project_id,
            filename=filename,
            stored_path=stored_path,
            created_at=_utc_now(),
        )
        with self._lock:
            self._prune_locked()
            self._uploads[upload_id] = record
        return record

    def get_upload(self, upload_id: str) -> Optional[UploadedPdfRecord]:
        """Look up the stored upload record under the lock, returning None when its token is
        absent.
        """
        with self._lock:
            return self._uploads.get(upload_id)

    def consume_upload(self, upload_id: str) -> Optional[UploadedPdfRecord]:
        """Atomically remove and return an upload token so it cannot be submitted twice."""
        with self._lock:
            return self._uploads.pop(upload_id, None)

    def create_job(self, project_id: int, upload_id: str) -> OcrJobRecord:
        """Prune retained records and create a queued job snapshot with a new opaque job ID."""
        job_id = str(uuid.uuid4())
        record = OcrJobRecord(
            job_id=job_id,
            project_id=project_id,
            upload_id=upload_id,
            status="queued",
            phase="queued",
            progress=0,
            message="Job queued",
            created_at=_utc_now(),
        )
        with self._lock:
            self._prune_locked()
            self._jobs[job_id] = record
        return record

    def get_job(self, job_id: str) -> Optional[OcrJobRecord]:
        """Return the retained mutable job record under the lock, or None for an unknown ID."""
        with self._lock:
            return self._jobs.get(job_id)

    def list_project_jobs(self, project_id: int) -> List[OcrJobRecord]:
        """Prune old records and return this project's job snapshots newest first."""
        with self._lock:
            self._prune_locked()
            jobs = [job for job in self._jobs.values() if job.project_id == project_id]
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return jobs

    def clear_project_records(self, project_id: int) -> None:
        """Remove all upload and job registrations for one project without deleting files."""
        with self._lock:
            self._uploads = {key: value for key, value in self._uploads.items() if value.project_id != project_id}
            self._jobs = {key: value for key, value in self._jobs.items() if value.project_id != project_id}

    def update_job(
        self,
        job_id: str,
        *,
        status: Optional[str] = None,
        phase: Optional[str] = None,
        progress: Optional[int] = None,
        message: Optional[str] = None,
        started_at: Optional[datetime] = None,
        finished_at: Optional[datetime] = None,
        error: Optional[str] = None,
        transcript_path: Optional[str] = None,
        project_json_path: Optional[str] = None,
        total_pages: Optional[int] = None,
        rasterized_pages: Optional[int] = None,
        segmented_pages: Optional[int] = None,
        ocr_pages: Optional[int] = None,
    ) -> Optional[OcrJobRecord]:
        """Update supplied fields of an existing job under the lock and return the same record.

        Ignore fields whose arguments are None, clamp progress to 0..100 and page counts to
        nonnegative values, and return None when the job has been removed.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            if status is not None:
                job.status = status
            if phase is not None:
                job.phase = phase
            if progress is not None:
                job.progress = max(0, min(100, progress))
            if message is not None:
                job.message = message
            if started_at is not None:
                job.started_at = started_at
            if finished_at is not None:
                job.finished_at = finished_at
            if error is not None:
                job.error = error
            if transcript_path is not None:
                job.transcript_path = transcript_path
            if project_json_path is not None:
                job.project_json_path = project_json_path
            if total_pages is not None:
                job.total_pages = max(0, total_pages)
            if rasterized_pages is not None:
                job.rasterized_pages = max(0, rasterized_pages)
            if segmented_pages is not None:
                job.segmented_pages = max(0, segmented_pages)
            if ocr_pages is not None:
                job.ocr_pages = max(0, ocr_pages)

            return job

    def _prune_locked(self) -> None:
        """Discard expired upload registrations and trim excess uploads/jobs oldest first.

        The caller must hold the store lock. Pruning removes metadata only and is performed
        during selected store operations, not by a background timer.
        """
        now = _utc_now()
        expired_upload_ids = [
            upload_id
            for upload_id, record in self._uploads.items()
            if (now - record.created_at).total_seconds() > UPLOAD_TTL_SECONDS
        ]
        for upload_id in expired_upload_ids:
            self._uploads.pop(upload_id, None)

        if len(self._uploads) > MAX_UPLOADS_RETAINED:
            ordered_uploads = sorted(self._uploads.items(), key=lambda item: item[1].created_at)
            to_drop = len(self._uploads) - MAX_UPLOADS_RETAINED
            for upload_id, _ in ordered_uploads[:to_drop]:
                self._uploads.pop(upload_id, None)

        if len(self._jobs) > MAX_JOBS_RETAINED:
            ordered_jobs = sorted(self._jobs.items(), key=lambda item: item[1].created_at)
            to_drop = len(self._jobs) - MAX_JOBS_RETAINED
            for job_id, _ in ordered_jobs[:to_drop]:
                self._jobs.pop(job_id, None)


job_store = JobStore()
