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
    reservation_id: str
    project_id: int


class RuntimeGate:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active_job: dict[str, Any] | None = None
        self._restart_token: str | None = None
        self._restart_expires_at: datetime | None = None

    def _expire_restart_locked(self) -> None:
        if self._restart_expires_at and datetime.now(timezone.utc) >= self._restart_expires_at:
            self._restart_token = None
            self._restart_expires_at = None

    def try_begin_job(self, project_id: int) -> JobReservation | None:
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
        with self._lock:
            active = self._active_job
            if not active or active.get("reservation_id") != reservation.reservation_id:
                return False
            active["job_id"] = job_id
            active["status"] = "running"
            return True

    def release_reservation(self, reservation: JobReservation) -> None:
        with self._lock:
            active = self._active_job
            if active and active.get("reservation_id") == reservation.reservation_id:
                self._active_job = None

    def finish_job(self, job_id: str) -> None:
        with self._lock:
            if self._active_job and self._active_job.get("job_id") == job_id:
                self._active_job = None

    def prepare_restart(self) -> tuple[str, datetime] | None:
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
        with self._lock:
            self._expire_restart_locked()
            if not token or token != self._restart_token:
                return False
            self._restart_token = None
            self._restart_expires_at = None
            return True

    def snapshot(self) -> dict[str, Any]:
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
