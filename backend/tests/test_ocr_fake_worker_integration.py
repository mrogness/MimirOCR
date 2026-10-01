from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.routes import ocr as ocr_routes
from backend.database import Base, Page as DbPage, Project as DbProject
from backend.models.line import Line
from backend.models.page import Page
from backend.pipeline.jobs import JobStore
from backend.runtime_gate import RuntimeGate


def test_run_ocr_job_with_fake_runner_persists_results(tmp_path, monkeypatch):
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

    class FakeRunner:
        def __init__(self, _config, progress_callback=None):
            self.progress_callback = progress_callback

        def process_project(self, project):
            if self.progress_callback:
                self.progress_callback(
                    "ocr",
                    80,
                    "Fake worker running",
                    {
                        "total_pages": 1,
                        "rasterized_pages": 1,
                        "segmented_pages": 1,
                        "ocr_pages": 1,
                    },
                )
            project.pages = [
                Page(
                    id="p-1",
                    page_number=0,
                    image_path="/does/not/exist/page.png",
                    width=120,
                    height=60,
                    lines=[
                        Line(
                            id="line-1",
                            bbox={"x_min": 1, "y_min": 2, "x_max": 40, "y_max": 12},
                            image_path="/does/not/exist/line.png",
                            ocr_text="Transcribed",
                            confidence=0.95,
                        )
                    ],
                )
            ]

    monkeypatch.setattr(ocr_routes, "PipelineRunner", FakeRunner)

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
    assert saved_job.status == "succeeded"
    assert saved_job.phase == "completed"
    assert saved_job.ocr_pages == 1
    assert ocr_routes.runtime_gate.snapshot()["runtime_state"] == "idle"

    with sessions() as db:
        db_project = db.get(DbProject, 1)
        assert db_project is not None
        assert db_project.ocr_last_status == "succeeded"
        persisted_pages = db.query(DbPage).filter(DbPage.project_id == 1).all()
        assert len(persisted_pages) == 1
        assert len(persisted_pages[0].lines) == 1

    engine.dispose()
