"""Expose CPU/runtime status and reserve or cancel coordinated backend restarts."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.runtime.performance import get_active_limits
from backend.runtime.gate import RESTART_RESERVATION_SECONDS, runtime_gate
from backend.runtime.paths import get_app_data_dir


router = APIRouter(prefix="/system", tags=["system"])
RESTART_RESERVATION_FILE = "backend-restart-reservation.json"


class RestartPrepareRequest(BaseModel):
    """Performance profile to apply when the desktop host restarts the backend."""
    profile: Literal["cool", "balanced", "fast"]


class RestartCancelRequest(BaseModel):
    """Opaque token identifying the restart reservation that should be cancelled."""
    restart_token: str


def _reservation_path() -> Path:
    """Locate the JSON restart-reservation file in persistent application data."""
    return get_app_data_dir() / RESTART_RESERVATION_FILE


def _write_reservation(token: str, profile: str, expires_unix_seconds: int) -> None:
    """Atomically replace the host-readable reservation JSON with a token, profile, and Unix
    expiry time.
    """
    path = _reservation_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(
            {
                "restart_token": token,
                "profile": profile,
                "expires_unix_seconds": expires_unix_seconds,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    temporary.replace(path)


def _remove_reservation_file() -> None:
    """Remove the host-readable reservation file, tolerating an absent file or OS deletion
    error.
    """
    try:
        _reservation_path().unlink(missing_ok=True)
    except OSError:
        pass


@router.get("/cpu")
def get_cpu_info() -> dict[str, int]:
    """Report logical CPU count and the active profile's default segmentation worker count."""
    return {
        "total_cores": os.cpu_count() or 1,
        "default_worker_count": get_active_limits().segmentation_workers,
    }


@router.get("/runtime")
def get_runtime_info() -> dict:
    """Combine the runtime gate's public job/restart snapshot with resolved performance limits."""
    snapshot = runtime_gate.snapshot()
    snapshot["performance"] = get_active_limits().as_dict()
    return snapshot


@router.post("/restart/prepare")
def prepare_backend_restart(payload: RestartPrepareRequest) -> dict[str, str | int]:
    """Reserve an idle backend for restart and write the token the desktop host must present.

    Return HTTP 409 while a job or another restart is reserved. If writing the reservation
    fails, release the gate and return HTTP 500.
    """
    prepared = runtime_gate.prepare_restart()
    if prepared is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "runtime_busy",
                "message": "The backend cannot restart while OCR is running or another restart is pending.",
                "runtime": runtime_gate.snapshot(),
            },
        )

    token, expires_at = prepared
    try:
        _write_reservation(token, payload.profile, int(expires_at.timestamp()))
    except OSError as error:
        runtime_gate.cancel_restart(token)
        raise HTTPException(status_code=500, detail=f"Unable to prepare backend restart: {error}") from error

    return {
        "restart_token": token,
        "expires_at": expires_at.isoformat(),
        "expires_in_seconds": RESTART_RESERVATION_SECONDS,
    }


@router.post("/restart/cancel")
def cancel_backend_restart(payload: RestartCancelRequest) -> dict[str, bool]:
    """Cancel the matching unexpired restart token and remove its reservation file.

    Return HTTP 409 when the token is missing, expired, or does not match the pending
    reservation.
    """
    if not runtime_gate.cancel_restart(payload.restart_token):
        raise HTTPException(status_code=409, detail="Restart reservation is missing or expired")
    _remove_reservation_file()
    return {"cancelled": True}
