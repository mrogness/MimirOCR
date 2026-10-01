from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import ocr as ocr_routes
from backend.database import Base, Project
from backend.pipeline.jobs import JobStore
from backend.runtime_gate import RuntimeGate


@pytest.fixture(autouse=True)
def reset_ocr_runtime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ocr_routes, "runtime_gate", RuntimeGate())
    monkeypatch.setattr(ocr_routes, "job_store", JobStore())
    monkeypatch.setattr(ocr_routes, "get_temp_dir", lambda: tmp_path / "tmp")
    monkeypatch.setattr(ocr_routes, "get_output_dir", lambda: tmp_path / "output")


@pytest.fixture(name="ocr_api_client")
def fixture_ocr_api_client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(Project(id=1, name="OCR Test Project"))
        db.add(Project(id=2, name="Other Project"))
        db.commit()

    def override_db():
        with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(ocr_routes.router)
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _register_upload(project_id: int = 1):
    return ocr_routes.job_store.register_upload(
        project_id=project_id,
        filename="book.pdf",
        stored_path="/tmp/book.pdf",
    )


def test_start_job_and_list_and_get_job(ocr_api_client, monkeypatch: pytest.MonkeyPatch):
    class NoopThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            return None

    monkeypatch.setattr(ocr_routes, "Thread", NoopThread)

    upload = _register_upload(project_id=1)
    start = ocr_api_client.post(
        "/ocr/projects/1/jobs",
        json={"upload_id": upload.upload_id, "config": {"dpi": 300}},
    )
    assert start.status_code == 200
    payload = start.json()
    assert payload["project_id"] == 1
    assert payload["upload_id"] == upload.upload_id
    assert payload["status"] == "queued"

    job_id = payload["job_id"]
    get_one = ocr_api_client.get(f"/ocr/jobs/{job_id}")
    assert get_one.status_code == 200
    assert get_one.json()["job_id"] == job_id

    listed = ocr_api_client.get("/ocr/projects/1/jobs")
    assert listed.status_code == 200
    jobs = listed.json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == job_id


def test_start_job_rejects_concurrent_runs(ocr_api_client, monkeypatch: pytest.MonkeyPatch):
    class HoldThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            return None

    monkeypatch.setattr(ocr_routes, "Thread", HoldThread)

    first_upload = _register_upload(project_id=1)
    first = ocr_api_client.post(
        "/ocr/projects/1/jobs",
        json={"upload_id": first_upload.upload_id, "config": {}},
    )
    assert first.status_code == 200

    second_upload = _register_upload(project_id=1)
    second = ocr_api_client.post(
        "/ocr/projects/1/jobs",
        json={"upload_id": second_upload.upload_id, "config": {}},
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "ocr_job_already_running"


def test_start_job_upload_validation_errors(ocr_api_client):
    missing = ocr_api_client.post(
        "/ocr/projects/1/jobs",
        json={"upload_id": "missing", "config": {}},
    )
    assert missing.status_code == 404

    wrong_upload = _register_upload(project_id=2)
    mismatch = ocr_api_client.post(
        "/ocr/projects/1/jobs",
        json={"upload_id": wrong_upload.upload_id, "config": {}},
    )
    assert mismatch.status_code == 400


def test_transcript_endpoint_requires_success_and_existing_file(ocr_api_client, tmp_path: Path):
    job = ocr_routes.job_store.create_job(project_id=1, upload_id="upload-1")

    not_done = ocr_api_client.get(f"/ocr/jobs/{job.job_id}/transcript")
    assert not_done.status_code == 409

    transcript = tmp_path / "transcript.txt"
    transcript.write_text("line 1\nline 2", encoding="utf-8")
    ocr_routes.job_store.update_job(
        job.job_id,
        status="succeeded",
        phase="completed",
        progress=100,
        finished_at=datetime.now(timezone.utc),
        transcript_path=str(transcript),
    )

    done = ocr_api_client.get(f"/ocr/jobs/{job.job_id}/transcript")
    assert done.status_code == 200
    assert done.json()["transcript"] == "line 1\nline 2"

    ocr_routes.job_store.update_job(job.job_id, transcript_path=str(tmp_path / "missing.txt"))
    missing_file = ocr_api_client.get(f"/ocr/jobs/{job.job_id}/transcript")
    assert missing_file.status_code == 404
