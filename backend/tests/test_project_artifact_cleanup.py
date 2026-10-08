"""Protect project-ID boundaries in deletion and PDF replacement cleanup."""

import pytest

from backend.api.routes import files, projects


@pytest.mark.parametrize("route_module", [projects, files], ids=["delete", "replace-pdf"])
def test_cleanup_matches_complete_project_id(route_module, tmp_path, monkeypatch):
    output = tmp_path / "output"
    temporary = tmp_path / "temp"
    uploads = tmp_path / "uploads"
    for root in (output, temporary, uploads):
        root.mkdir()
    monkeypatch.setattr(route_module, "get_output_dir", lambda: output)
    monkeypatch.setattr(route_module, "get_temp_dir", lambda: temporary)
    monkeypatch.setattr(route_module, "get_uploads_dir", lambda: uploads)

    owned = [
        temporary / "project_1",
        temporary / "project1",
        temporary / "project_1_run",
        temporary / "project1_run",
        temporary / "lines" / "1_page_0",
        temporary / "lines" / "project1_page_0",
        temporary / "lines" / "project_1_page_0",
        output / "1",
        output / "project1",
    ]
    unrelated = [
        temporary / "project_10",
        temporary / "project10",
        temporary / "project_100_run",
        temporary / "project100_run",
        temporary / "project_1backup",
        temporary / "project1backup",
        temporary / "lines" / "10_page_0",
        temporary / "lines" / "project10_page_0",
        temporary / "lines" / "project_10_page_0",
        output / "10",
        output / "project10",
    ]
    for directory in owned + unrelated:
        directory.mkdir(parents=True)
        (directory / "artifact.txt").write_text("keep or remove", encoding="utf-8")
    own_upload = uploads / "1_upload.pdf"
    other_upload = uploads / "10_upload.pdf"
    own_upload.write_bytes(b"own PDF")
    other_upload.write_bytes(b"other PDF")

    route_module._cleanup_project_artifacts(project_id=1, source_pdf_path=str(own_upload))

    for directory in owned:
        assert not directory.exists(), f"Owned directory was retained: {directory}"
    for directory in unrelated:
        assert (directory / "artifact.txt").read_text(encoding="utf-8") == "keep or remove"
    assert not own_upload.exists()
    assert other_upload.read_bytes() == b"other PDF"
