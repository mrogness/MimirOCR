from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from typing_extensions import Annotated
from fastapi.params import File
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import UploadedPdfResponse
from backend.pipeline.jobs import job_store
from backend.runtime_paths import get_output_dir, get_temp_dir, get_uploads_dir

router = APIRouter(prefix="/files", tags=["files"])


def _cleanup_project_artifacts(project_id: int, source_pdf_path: str) -> None:
    output_root = get_output_dir()
    candidate_output_dirs = [output_root / str(project_id), output_root / f"project{project_id}"]
    for output_dir in candidate_output_dirs:
        if output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)

    tmp_root = get_temp_dir()
    if tmp_root.exists():
        for child in tmp_root.iterdir():
            if not child.is_dir():
                continue

            name = child.name
            if name.startswith(f"project_{project_id}") or name.startswith(f"project{project_id}"):
                shutil.rmtree(child, ignore_errors=True)

        lines_root = tmp_root / "lines"
        if lines_root.exists() and lines_root.is_dir():
            for child in lines_root.iterdir():
                if not child.is_dir():
                    continue

                name = child.name
                if (
                    name.startswith(f"{project_id}_page_")
                    or name.startswith(f"project{project_id}_page_")
                    or name.startswith(f"project_{project_id}_page_")
                ):
                    shutil.rmtree(child, ignore_errors=True)

    if source_pdf_path:
        source_path = Path(source_pdf_path)
        try:
            if source_path.exists() and source_path.is_file() and source_path.parent.name == "uploads":
                source_path.unlink(missing_ok=True)
        except OSError:
            pass


@router.post("/projects/{project_id}/upload-pdf", response_model=UploadedPdfResponse)
async def upload_pdf_for_project(
    project_id: int,
    file: Annotated[UploadFile, File(description="A PDF file")],
    db: Session = Depends(get_db),
) -> UploadedPdfResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    previous_source_path = project.source_pdf_path or ""
    # New upload replaces the project's previous OCR dataset entirely.
    job_store.clear_project_records(project_id)
    crud.replace_project_pages_and_lines(db, project, [])
    project.ocr_last_status = None
    project.ocr_last_elapsed_seconds = None
    db.commit()
    db.refresh(project)
    _cleanup_project_artifacts(project_id, previous_source_path)

    upload_dir = get_uploads_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_name = Path(file.filename or "document.pdf").name
    stored_name = f"{project_id}_{uuid4()}_{safe_name}"
    out_path = upload_dir / stored_name

    pdf_bytes = await file.read()
    out_path.write_bytes(pdf_bytes)

    upload_record = job_store.register_upload(
        project_id=project_id,
        filename=safe_name,
        stored_path=str(out_path),
    )

    crud.update_project_source_pdf(
        db,
        project=project,
        source_pdf_name=safe_name,
        source_pdf_path=str(out_path),
    )

    return UploadedPdfResponse(
        upload_id=upload_record.upload_id,
        project_id=project_id,
        filename=safe_name,
        message="Uploaded",
    )
