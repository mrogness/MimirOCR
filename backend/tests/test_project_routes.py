"""Project API behavior with real SQLite records, files, and an isolated job store.

Run through pytest so backend/tests/conftest.py isolates import-time runtime paths.
The project-ID isolation regression deliberately fails until artifact cleanup
stops treating project_10 as belonging to project 1.
"""

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import projects as project_routes
from backend.persistence.models import Base, Line, Page, Project
from backend.services.job_store import JobStore


@pytest.fixture
def project_client(tmp_path, monkeypatch):
    """A fresh database, job store, and artifact directories for every test."""
    app = FastAPI()
    app.include_router(project_routes.router)
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    sessions = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    def override_get_db():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    store = JobStore()
    monkeypatch.setattr(project_routes, "job_store", store)
    for accessor, directory in (
        ("get_output_dir", "output"),
        ("get_temp_dir", "temp"),
        ("get_uploads_dir", "uploads"),
    ):
        path = tmp_path / directory
        path.mkdir()
        monkeypatch.setattr(project_routes, accessor, lambda path=path: path)

    try:
        with TestClient(app) as client:
            yield client, sessions, store
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def create_project(client, name="Test project"):
    response = client.post("/projects/", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def write_artifact(path, content=b"test artifact"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def seed_dataset(sessions, project_id, *, page_id, line_id):
    with sessions() as db:
        db.add(Page(id=page_id, project_id=project_id, page_number=0))
        db.flush()
        db.add(Line(id=line_id, page_id=page_id, line_order=1, ocr_text="Original",
                    corrected_text="Æble og ø"))
        db.commit()


def test_create_project(project_client):
    client, sessions, _ = project_client
    project_id = create_project(client, "Æble, ø og Å")
    assert isinstance(project_id, int)
    with sessions() as db:
        project = db.get(Project, project_id)
        assert project is not None
        assert project.name == "Æble, ø og Å"
        assert project.ocr_run_count == 0


@pytest.mark.parametrize("method,path", [("post", "/projects/"), ("put", "/projects/1")])
def test_missing_name_is_rejected(project_client, method, path):
    client, sessions, _ = project_client
    project_id = create_project(client, "Unchanged")
    response = getattr(client, method)(path, json={})
    assert response.status_code == 422
    with sessions() as db:
        assert db.query(Project).count() == 1
        assert db.get(Project, project_id).name == "Unchanged"


def test_list_projects_empty(project_client):
    client, _, _ = project_client
    response = client.get("/projects/")
    assert response.status_code == 200
    assert response.json() == {"projects": []}


def test_list_projects(project_client):
    client, _, _ = project_client
    first = create_project(client, "Project 1")
    second = create_project(client, "Project 2")
    response = client.get("/projects/")
    assert response.status_code == 200
    projects = response.json()["projects"]
    assert len(projects) == 2
    assert {p["id"]: p["name"] for p in projects} == {
        first: "Project 1", second: "Project 2",
    }


def test_read_project(project_client):
    client, _, _ = project_client
    project_id = create_project(client, "Read project")
    response = client.get(f"/projects/{project_id}")
    assert response.status_code == 200
    assert response.json()["id"] == project_id
    assert response.json()["name"] == "Read project"


@pytest.mark.parametrize("method,path,kwargs", [
    ("get", "/projects/9999", {}),
    ("put", "/projects/9999", {"json": {"name": "Missing"}}),
    ("delete", "/projects/9999", {}),
    ("get", "/projects/9999/pages", {}),
    ("get", "/projects/9999/pages/1/image", {}),
    ("get", "/projects/9999/source-pdf", {}),
])
def test_missing_project(project_client, method, path, kwargs):
    client, _, _ = project_client
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 404
    assert response.json() == {"detail": "Project not found"}


def test_rename_project_persists_and_preserves_other_projects(project_client):
    client, sessions, _ = project_client
    project_id = create_project(client, "Old name")
    other_id = create_project(client, "Other project")
    response = client.put(f"/projects/{project_id}", json={"name": "Renamed project"})
    assert response.status_code == 200
    assert response.json()["id"] == project_id
    assert response.json()["name"] == "Renamed project"
    assert client.get(f"/projects/{project_id}").json()["name"] == "Renamed project"
    with sessions() as db:
        assert db.get(Project, project_id).name == "Renamed project"
        assert db.get(Project, other_id).name == "Other project"


def test_delete_project_and_repeat_delete(project_client):
    client, sessions, _ = project_client
    project_id = create_project(client)
    response = client.delete(f"/projects/{project_id}")
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/projects/{project_id}").status_code == 404
    assert client.delete(f"/projects/{project_id}").status_code == 404
    with sessions() as db:
        assert db.get(Project, project_id) is None


def test_delete_project_cascades_and_preserves_other_dataset(project_client):
    client, sessions, _ = project_client
    project_id = create_project(client)
    other_id = create_project(client, "Other project")
    seed_dataset(sessions, project_id, page_id=101, line_id=1001)
    seed_dataset(sessions, other_id, page_id=102, line_id=1002)
    assert client.delete(f"/projects/{project_id}").status_code == 204
    with sessions() as db:
        assert db.get(Project, project_id) is None
        assert db.get(Page, 101) is None
        assert db.get(Line, 1001) is None
        assert db.get(Project, other_id) is not None
        assert db.get(Page, 102).project_id == other_id
        assert db.get(Line, 1002).corrected_text == "Æble og ø"


def test_delete_project_clears_only_its_upload_and_job_records(project_client):
    client, _, store = project_client
    project_id = create_project(client)
    other_id = create_project(client, "Other project")
    upload = store.register_upload(project_id, "book.pdf", "unused.pdf")
    other_upload = store.register_upload(other_id, "other.pdf", "other.pdf")
    job = store.create_job(project_id, upload.upload_id)
    other_job = store.create_job(other_id, other_upload.upload_id)
    assert client.delete(f"/projects/{project_id}").status_code == 204
    assert store.get_upload(upload.upload_id) is None
    assert store.get_job(job.job_id) is None
    assert store.list_project_jobs(project_id) == []
    assert store.get_upload(other_upload.upload_id) == other_upload
    assert store.get_job(other_job.job_id) == other_job


def test_delete_project_removes_owned_artifacts(project_client, tmp_path):
    client, sessions, _ = project_client
    project_id = create_project(client)
    owned = [
        tmp_path / "output" / str(project_id) / "page.png",
        tmp_path / "output" / f"project{project_id}" / "transcript.txt",
        tmp_path / "temp" / f"project_{project_id}_run" / "page.png",
        tmp_path / "temp" / f"project{project_id}_run" / "page.png",
        tmp_path / "temp" / "lines" / f"{project_id}_page_0" / "line.png",
        tmp_path / "temp" / "lines" / f"project{project_id}_page_0" / "line.png",
        tmp_path / "temp" / "lines" / f"project_{project_id}_page_0" / "line.png",
        tmp_path / "uploads" / f"{project_id}_upload_book.pdf",
        tmp_path / "uploads" / "legacy-source.pdf",
    ]
    for path in owned:
        write_artifact(path)
    unrelated = write_artifact(tmp_path / "temp" / "shared.txt", b"keep me")
    with sessions() as db:
        project = db.get(Project, project_id)
        project.source_pdf_path = str(owned[-1])
        project.source_pdf_name = "legacy-source.pdf"
        db.commit()
    assert client.delete(f"/projects/{project_id}").status_code == 204
    for path in owned:
        assert not path.exists(), f"Owned artifact was retained: {path}"
    assert unrelated.read_bytes() == b"keep me"


def test_delete_project_preserves_external_source_file(project_client, tmp_path):
    client, sessions, _ = project_client
    project_id = create_project(client)
    external = write_artifact(tmp_path / "external" / "original.pdf", b"original")
    with sessions() as db:
        db.get(Project, project_id).source_pdf_path = str(external)
        db.commit()
    assert client.delete(f"/projects/{project_id}").status_code == 204
    assert external.read_bytes() == b"original"


def test_delete_project_preserves_artifacts_for_similar_project_id(project_client, tmp_path):
    """Regression: deleting ID 1 must not remove project_10/project10 directories."""
    client, sessions, _ = project_client
    with sessions() as db:
        db.add_all([Project(id=1, name="Delete"), Project(id=10, name="Keep")])
        db.commit()
    owned = write_artifact(tmp_path / "temp" / "project_1" / "page.png")
    other = [
        tmp_path / "temp" / "project_10" / "page.png",
        tmp_path / "temp" / "project10_run" / "page.png",
        tmp_path / "temp" / "lines" / "10_page_0" / "line.png",
        tmp_path / "temp" / "lines" / "project10_page_0" / "line.png",
        tmp_path / "output" / "10" / "page.png",
        tmp_path / "uploads" / "10_upload_book.pdf",
    ]
    for path in other:
        write_artifact(path, b"other project")
    assert client.delete("/projects/1").status_code == 204
    assert not owned.exists()
    with sessions() as db:
        assert db.get(Project, 10) is not None
    missing = [str(path.relative_to(tmp_path)) for path in other if not path.exists()]
    assert missing == [], f"Deleted another project's artifacts: {missing}"


def test_list_project_pages_empty(project_client):
    client, _, _ = project_client
    project_id = create_project(client)
    response = client.get(f"/projects/{project_id}/pages")
    assert response.status_code == 200
    assert response.json() == {"project_id": project_id, "pages": []}


def test_pages_preserve_geometry_corrections_and_reading_order(project_client):
    client, sessions, _ = project_client
    project_id = create_project(client)
    bbox = {"x_min": 1, "y_min": 2, "x_max": 30, "y_max": 40}
    polygon = [[1, 2], [30, 2], [30, 40]]
    positions = [{"start": 0, "end": 12, "char": "Æ"}]
    with sessions() as db:
        db.add(Page(id=100, project_id=project_id, page_number=0, width=600, height=800))
        db.flush()
        db.add_all([
            Line(id=101, page_id=100, line_order=2, ocr_text="Second"),
            Line(id=102, page_id=100, line_order=1, ocr_text="Wrong", corrected_text="Æble",
                 bounding_box=json.dumps(bbox), polygon_points=json.dumps(polygon),
                 char_positions=json.dumps(positions), line_confidence=0.95),
        ])
        db.commit()
    response = client.get(f"/projects/{project_id}/pages")
    assert response.status_code == 200
    page = response.json()["pages"][0]
    assert (page["width"], page["height"]) == (600, 800)
    assert [line["id"] for line in page["lines"]] == [102, 101]
    first, second = page["lines"]
    assert first["ocr_text"] == "Wrong"
    assert first["corrected_text"] == "Æble"
    assert first["bounding_box"] == bbox
    assert first["polygon_points"] == polygon
    assert first["char_positions"] == positions
    assert first["line_confidence"] == pytest.approx(0.95)
    assert second["bounding_box"] is None
    assert second["char_positions"] is None


def test_page_image_response_and_cross_project_isolation(project_client, tmp_path):
    client, sessions, _ = project_client
    project_id = create_project(client)
    other_id = create_project(client, "Other")
    image = write_artifact(tmp_path / "output" / "page.png", b"page image")
    with sessions() as db:
        db.add(Page(id=100, project_id=project_id, page_number=0, img_path=str(image)))
        db.commit()
    response = client.get(f"/projects/{project_id}/pages/100/image")
    assert response.status_code == 200
    assert response.content == b"page image"
    assert "no-store" in response.headers["cache-control"]
    response = client.get(f"/projects/{other_id}/pages/100/image")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"


@pytest.mark.parametrize("image_path,detail", [
    (None, "Page image path unavailable"),
    ("missing.png", "Page image file not found"),
    (".", "Page image file not found"),
])
def test_page_image_unavailable(project_client, tmp_path, image_path, detail):
    client, sessions, _ = project_client
    project_id = create_project(client)
    with sessions() as db:
        db.add(Page(id=100, project_id=project_id, page_number=0,
                    img_path=str(tmp_path / image_path) if image_path else None))
        db.commit()
    response = client.get(f"/projects/{project_id}/pages/100/image")
    assert response.status_code == 404
    assert response.json()["detail"] == detail


def test_source_pdf_response(project_client, tmp_path):
    client, sessions, _ = project_client
    project_id = create_project(client)
    source = write_artifact(tmp_path / "uploads" / "stored.pdf", b"%PDF-test")
    with sessions() as db:
        project = db.get(Project, project_id)
        project.source_pdf_path = str(source)
        project.source_pdf_name = "book.pdf"
        db.commit()
    response = client.get(f"/projects/{project_id}/source-pdf")
    assert response.status_code == 200
    assert response.content == b"%PDF-test"
    assert response.headers["content-type"] == "application/pdf"
    assert 'filename="book.pdf"' in response.headers["content-disposition"]
    assert "no-store" in response.headers["cache-control"]


@pytest.mark.parametrize("source_path,source_name,detail", [
    (None, None, "No source PDF for project"),
    ("missing.pdf", None, "No source PDF name for project"),
    ("missing.pdf", "book.pdf", "Source PDF file not found"),
    (".", "book.pdf", "Source PDF file not found"),
])
def test_source_pdf_unavailable(project_client, tmp_path, source_path, source_name, detail):
    client, sessions, _ = project_client
    project_id = create_project(client)
    with sessions() as db:
        project = db.get(Project, project_id)
        project.source_pdf_path = str(tmp_path / source_path) if source_path else None
        project.source_pdf_name = source_name
        db.commit()
    response = client.get(f"/projects/{project_id}/source-pdf")
    assert response.status_code == 404
    assert response.json()["detail"] == detail
