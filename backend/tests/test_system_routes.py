from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import system as system_routes
from backend.runtime_gate import runtime_gate


@pytest.fixture(autouse=True)
def reset_runtime_gate_state() -> None:
    runtime_gate._active_job = None
    runtime_gate._restart_token = None
    runtime_gate._restart_expires_at = None


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(system_routes.router)
    return TestClient(app)


def test_get_cpu_info_has_expected_shape() -> None:
    response = _client().get("/system/cpu")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_cores"] >= 1
    assert payload["default_worker_count"] >= 1


def test_prepare_then_cancel_restart_roundtrip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(system_routes, "get_app_data_dir", lambda: tmp_path)

    prepare = _client().post("/system/restart/prepare", json={"profile": "balanced"})
    assert prepare.status_code == 200

    restart_token = prepare.json()["restart_token"]
    reservation_file = tmp_path / system_routes.RESTART_RESERVATION_FILE
    assert reservation_file.exists()

    cancel = _client().post("/system/restart/cancel", json={"restart_token": restart_token})
    assert cancel.status_code == 200
    assert cancel.json() == {"cancelled": True}
    assert not reservation_file.exists()


def test_cancel_with_invalid_token_returns_conflict() -> None:
    response = _client().post("/system/restart/cancel", json={"restart_token": "invalid-token"})

    assert response.status_code == 409
