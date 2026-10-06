from types import SimpleNamespace
from pathlib import Path
import sys

import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.routes import ocr as ocr_routes
from backend.database import Base, Page as DbPage, Project as DbProject
from backend.models.page import Page
from backend.pipeline.jobs import JobStore
from backend.runtime_gate import RuntimeGate


@pytest.mark.parametrize("fail", [False, True])
def test_run_ocr_job_with_fake_processes_persists_or_releases_gate(tmp_path, monkeypatch, fail):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)

    with sessions() as db:
        db.add(DbProject(id=1, name="Integration"))
        db.commit()

    monkeypatch.setattr(ocr_routes, "SessionLocal", sessions)
    monkeypatch.setattr(ocr_routes, "runtime_gate", RuntimeGate())
    monkeypatch.setattr(ocr_routes, "job_store", JobStore())
    monkeypatch.setattr(ocr_routes, "get_temp_dir", lambda: tmp_path / "tmp")
    monkeypatch.setattr(ocr_routes, "get_output_dir", lambda: tmp_path / "output")

    from backend.stages import prepare
    from backend.workers import client

    monkeypatch.setattr(client, "worker_command", lambda role:
                        [sys.executable, "-u", "-m", "backend.tests.fake_worker", role])

    def fake_prepare(project, config, on_page_rasterized):
        image = Path(config.temp_dir) / "page.png"
        image.parent.mkdir(parents=True, exist_ok=True)
        image.write_bytes(b"test image contents")
        on_page_rasterized(1, 1)
        return [Page(id="p-1", page_number=0, image_path=str(image), width=120, height=60,
                     metadata={"mode": "error" if fail else "ok"})]
    monkeypatch.setattr(prepare, "prepare_pages", fake_prepare)

    upload = ocr_routes.job_store.register_upload(
        project_id=1,
        filename="book.pdf",
        stored_path="/tmp/book.pdf",
    )
    job = ocr_routes.job_store.create_job(project_id=1, upload_id=upload.upload_id)

    reservation = ocr_routes.runtime_gate.try_begin_job(1)
    assert reservation is not None
    assert ocr_routes.runtime_gate.attach_job(reservation, job.job_id)

    request_config = SimpleNamespace(
        dpi=300,
        binarization_threshold=170,
        ocr_model_path=None,
        disambiguate_ij=True,
        strict_top_to_bottom=False,
        device="cpu",
    )

    run_job = getattr(ocr_routes, "_run_ocr_job")
    run_job(
        job_id=job.job_id,
        project_id=1,
        project_name="Integration",
        source_pdf_path="/tmp/book.pdf",
        source_pdf_name="book.pdf",
        request_config=request_config,
    )

    saved_job = ocr_routes.job_store.get_job(job.job_id)
    assert saved_job is not None
    assert saved_job.status == ("failed" if fail else "succeeded")
    assert saved_job.phase == ("failed" if fail else "completed")
    assert not client._ACTIVE
    assert not (tmp_path / "tmp" / "project_1" / job.job_id).exists()
    if fail:
        assert "fake inference failed" in saved_job.error
    else:
        assert saved_job.ocr_pages == 1
        assert Path(saved_job.transcript_path).read_text(encoding="utf-8") == "Æble, ø og Å — 日本語"
    assert ocr_routes.runtime_gate.snapshot()["runtime_state"] == "idle"

    with sessions() as db:
        db_project = db.get(DbProject, 1)
        assert db_project is not None
        assert db_project.ocr_last_status == ("failed" if fail else "succeeded")
        persisted_pages = db.query(DbPage).filter(DbPage.project_id == 1).all()
        assert len(persisted_pages) == (0 if fail else 1)
        if not fail:
            assert len(persisted_pages[0].lines) == 1
            assert Path(persisted_pages[0].img_path).read_bytes() == b"test image contents"
            assert Path(persisted_pages[0].lines[0].img_path).is_file()

    engine.dispose()
