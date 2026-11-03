"""Serialize OCR admission and short-lived restart reservations so a backend restart cannot
interrupt an admitted run."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
import secrets
import uuid


RESTART_RESERVATION_SECONDS = 30
BACKEND_INSTANCE_ID = str(uuid.uuid4())


@dataclass(frozen=True)
class JobReservation:
    """Opaque admission token linking one accepted job to its owning project."""
    reservation_id: str
    project_id: int


class RuntimeGate:
    """Arbitrate one active job and mutually exclusive restart reservations."""
    def __init__(self) -> None:
        """Create an unlocked job/restart state protected by a per-gate mutex."""
        self._lock = Lock()
        self._active_job: dict[str, Any] | None = None
        self._restart_token: str | None = None
        self._restart_expires_at: datetime | None = None

    def _expire_restart_locked(self) -> None:
        """Clear an elapsed restart reservation while the caller holds the gate lock."""
        if self._restart_expires_at and datetime.now(timezone.utc) >= self._restart_expires_at:
            self._restart_token = None
            self._restart_expires_at = None

    def try_begin_job(self, project_id: int) -> JobReservation | None:
        """Reserve the idle runtime for a project's job, or return None while a job/restart is
        already reserved.
        """
        with self._lock:
            self._expire_restart_locked()
            if self._active_job is not None or self._restart_token is not None:
                return None

            reservation = JobReservation(secrets.token_urlsafe(18), project_id)
            self._active_job = {
                "reservation_id": reservation.reservation_id,
                "job_id": None,
                "project_id": project_id,
                "status": "reserving",
            }
            return reservation

    def attach_job(self, reservation: JobReservation, job_id: str) -> bool:
        """Attach a created job ID to its matching admission token; return False for an
        obsolete reservation.
        """
        with self._lock:
            active = self._active_job
            if not active or active.get("reservation_id") != reservation.reservation_id:
                return False
            active["job_id"] = job_id
            active["status"] = "running"
            return True

    def release_reservation(self, reservation: JobReservation) -> None:
        """Release job admission only when the supplied token still owns the active
        reservation.
        """
        with self._lock:
            active = self._active_job
            if active and active.get("reservation_id") == reservation.reservation_id:
                self._active_job = None

    def finish_job(self, job_id: str) -> None:
        """Clear the active job when its job ID matches, leaving any unrelated admission
        untouched.
        """
        with self._lock:
            if self._active_job and self._active_job.get("job_id") == job_id:
                self._active_job = None

    def prepare_restart(self) -> tuple[str, datetime] | None:
        """Reserve the idle runtime for a short-lived restart and return its opaque token and
        UTC expiry.

        Return None if either a job or another unexpired restart already owns the runtime.
        """
        with self._lock:
            self._expire_restart_locked()
            if self._active_job is not None or self._restart_token is not None:
                return None

            token = secrets.token_urlsafe(24)
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=RESTART_RESERVATION_SECONDS)
            self._restart_token = token
            self._restart_expires_at = expires_at
            return token, expires_at

    def cancel_restart(self, token: str) -> bool:
        """Clear a matching unexpired restart token and report whether cancellation succeeded."""
        with self._lock:
            self._expire_restart_locked()
            if not token or token != self._restart_token:
                return False
            self._restart_token = None
            self._restart_expires_at = None
            return True

    def snapshot(self) -> dict[str, Any]:
        """Return public job, restart, and backend-instance state under the gate lock.

        Expire stale restart reservations and omit the private job-reservation token from
        the copied job snapshot.
        """
        with self._lock:
            self._expire_restart_locked()
            active_job = dict(self._active_job) if self._active_job else None
            if active_job:
                active_job.pop("reservation_id", None)
            return {
                "backend_instance_id": BACKEND_INSTANCE_ID,
                "runtime_state": (
                    "running" if active_job else "restart_pending" if self._restart_token else "idle"
                ),
                "active_job": active_job,
                "restart_pending": self._restart_token is not None,
                "restart_expires_at": (
                    self._restart_expires_at.isoformat() if self._restart_expires_at else None
                ),
            }


runtime_gate = RuntimeGate()
