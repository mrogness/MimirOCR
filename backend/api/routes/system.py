from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.performance import get_active_limits
from backend.runtime_gate import RESTART_RESERVATION_SECONDS, runtime_gate
from backend.runtime_paths import get_app_data_dir


router = APIRouter(prefix="/system", tags=["system"])
RESTART_RESERVATION_FILE = "backend-restart-reservation.json"


class RestartPrepareRequest(BaseModel):
    profile: Literal["cool", "balanced", "fast"]


class RestartCancelRequest(BaseModel):
    restart_token: str


def _reservation_path() -> Path:
    return get_app_data_dir() / RESTART_RESERVATION_FILE


def _write_reservation(token: str, profile: str, expires_unix_seconds: int) -> None:
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
    try:
        _reservation_path().unlink(missing_ok=True)
    except OSError:
        pass


@router.get("/cpu")
def get_cpu_info() -> dict[str, int]:
    return {
        "total_cores": os.cpu_count() or 1,
        "default_worker_count": get_active_limits().segmentation_workers,
    }


@router.get("/runtime")
def get_runtime_info() -> dict:
    snapshot = runtime_gate.snapshot()
    snapshot["performance"] = get_active_limits().as_dict()
    return snapshot


@router.post("/restart/prepare")
def prepare_backend_restart(payload: RestartPrepareRequest) -> dict[str, str | int]:
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
    if not runtime_gate.cancel_restart(payload.restart_token):
        raise HTTPException(status_code=409, detail="Restart reservation is missing or expired")
    _remove_reservation_file()
    return {"cancelled": True}
