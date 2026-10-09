"""Exercise real export builders through HTTP, with isolated SQLite records."""
from io import BytesIO
import json
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes.export import router
from backend.exporting import pdf
from backend.persistence.models import Base, Line, Page, Project


@pytest.fixture
def export_client(tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    image = tmp_path / "line.png"
    image.write_bytes(b"line image bytes")
    bbox = json.dumps({"x_min": 10, "y_min": 10, "x_max": 400, "y_max": 30})
    with sessions() as db:
        db.add_all([Project(id=1, name="My Book!"), Project(id=2, name="Empty")])
        db.add_all([Page(id=10, project_id=1, page_number=0, width=1000, height=1200),
                    Page(id=20, project_id=2, page_number=0, width=1000, height=1200)])
        db.add_all([
            Line(id=101, page_id=10, line_order=2, img_path=str(image), bounding_box=bbox,
                 ocr_text="wrong", corrected_text="Æble, ø og Å"),
            Line(id=102, page_id=10, line_order=1, img_path=str(image), bounding_box=bbox,
                 ocr_text="First", corrected_text=""),
            Line(id=103, page_id=10, line_order=3, img_path=str(tmp_path / "missing.png"),
                 ocr_text="Missing image"),
        ])
        db.commit()

    def override_db():
        with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        engine.dispose()


@pytest.mark.parametrize("layout", ["source-lines", "reading"])
def test_pdf_get_and_post_preserve_export_headers_and_generate_pdf(export_client, layout):
    url = "/export/projects/1/pdf"
    get = export_client.get(url, params={"layout_mode": layout, "spread_mode": "single"})
    post = export_client.post(url, json={"layout_mode": layout, "spread_mode": "single"})
    for response in (get, post):
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"] == 'attachment; filename="My_Book_export.pdf"'
        assert response.content.startswith(b"%PDF-")
        assert response.content.rstrip().endswith(b"%%EOF")


def test_training_export_preserves_filenames_corrected_text_and_pair_order(export_client):
    response = export_client.get("/export/projects/1/training-data")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == 'attachment; filename="project_1_my-book_training_data.zip"'
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        first = "project_1_my-book/proj0001_p0001_l0001_102"
        second = "project_1_my-book/proj0001_p0001_l0002_101"
        assert archive.namelist() == [first + ".png", first + ".gt.txt", second + ".png", second + ".gt.txt"]
        assert archive.read(first + ".gt.txt").decode("utf-8") == "First"
        assert archive.read(second + ".gt.txt").decode("utf-8") == "Æble, ø og Å"
        assert archive.read(second + ".png") == b"line image bytes"


@pytest.mark.parametrize("format", ["pdf", "training-data"])
def test_missing_project_still_returns_404(export_client, format):
    response = export_client.get(f"/export/projects/999/{format}")
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"


@pytest.mark.parametrize("format,params,detail", [
    ("pdf", {"layout_mode": "reading"}, "No usable OCR text available for PDF export"),
    ("training-data", {}, "No line image/text pairs available for training data export"),
])
def test_empty_exports_preserve_errors(export_client, format, params, detail):
    response = export_client.get(f"/export/projects/2/{format}", params=params)
    assert response.status_code == 400
    assert response.json()["detail"] == detail


def test_pdf_dependency_error_precedes_project_lookup(export_client, monkeypatch):
    monkeypatch.setattr(pdf, "canvas", None)
    monkeypatch.setattr(pdf, "_IMPORT_ERROR", ImportError("test missing reportlab"))
    response = export_client.get("/export/projects/999/pdf")
    assert response.status_code == 500
    assert "PDF export dependency missing" in response.json()["detail"]
