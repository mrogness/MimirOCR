import json
from pathlib import Path
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import (
    ProjectCreate,
    ProjectLineRead,
    ProjectPageRead,
    ProjectPagesResponse,
    ProjectRead,
    ProjectsListResponse,
    ProjectUpdate,
)
from backend.pipeline.jobs import job_store
from backend.runtime_paths import get_output_dir, get_temp_dir, get_uploads_dir

router = APIRouter(prefix="/projects", tags=["projects"])


def _cleanup_project_artifacts(project_id: int, source_pdf_path: Optional[str]) -> None:
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

    uploads_root = get_uploads_dir()
    if uploads_root.exists() and uploads_root.is_dir():
        for candidate in uploads_root.glob(f"{project_id}_*"):
            if candidate.is_file():
                try:
                    candidate.unlink(missing_ok=True)
                except OSError:
                    pass

    if source_pdf_path:
        source_path = Path(source_pdf_path)
        try:
            if source_path.exists() and source_path.is_file() and source_path.parent.name == "uploads":
                source_path.unlink(missing_ok=True)
        except OSError:
            pass


@router.post("/", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectRead:
    project = crud.create_project(db, name=payload.name)
    return project


@router.get("/", response_model=ProjectsListResponse)
def list_projects(db: Session = Depends(get_db)) -> ProjectsListResponse:
    projects = crud.list_projects(db)
    return ProjectsListResponse(projects=projects)


@router.get("/{project_id}", response_model=ProjectRead)
def read_project(project_id: int, db: Session = Depends(get_db)) -> ProjectRead:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)) -> ProjectRead:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    updated = crud.update_project_name(db, project=project, name=payload.name)
    return updated


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> Response:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    job_store.clear_project_records(project.id)
    _cleanup_project_artifacts(project_id=project.id, source_pdf_path=project.source_pdf_path)
    crud.delete_project(db, project=project)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/pages", response_model=ProjectPagesResponse)
def list_project_pages(project_id: int, db: Session = Depends(get_db)) -> ProjectPagesResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    page_rows = crud.list_project_pages(db, project_id)
    payload_pages = []
    for page in page_rows:
        ordered_lines = sorted(page.lines, key=lambda line: (line.line_order or 10**9, line.id))
        payload_pages.append(
            ProjectPageRead(
                id=page.id,
                page_number=page.page_number,
                img_path=page.img_path,
                width=page.width,
                height=page.height,
                rotation=page.rotation,
                lines=[
                    ProjectLineRead(
                        id=line.id,
                        page_id=line.page_id,
                        line_order=line.line_order,
                        img_path=line.img_path,
                        bounding_box=json.loads(line.bounding_box) if line.bounding_box else None,
                        polygon_points=json.loads(line.polygon_points) if line.polygon_points else None,
                        ocr_text=line.ocr_text,
                        corrected_text=line.corrected_text,
                        line_confidence=line.line_confidence,
                        char_confidence=line.char_confidence,
                        char_positions=json.loads(line.char_positions) if line.char_positions else None,
                    )
                    for line in ordered_lines
                ],
            )
        )

    return ProjectPagesResponse(project_id=project_id, pages=payload_pages)


@router.get("/{project_id}/pages/{page_id}/image")
def get_project_page_image(project_id: int, page_id: int, db: Session = Depends(get_db)) -> FileResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    page = crud.get_project_page(db, project_id=project_id, page_id=page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if not page.img_path:
        raise HTTPException(status_code=404, detail="Page image path unavailable")

    path = Path(page.img_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Page image file not found")

    return FileResponse(
        path,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.get("/{project_id}/source-pdf")
def get_project_source_pdf(project_id: int, db: Session = Depends(get_db)) -> FileResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.source_pdf_path:
        raise HTTPException(status_code=404, detail="No source PDF for project")
    if not project.source_pdf_name:
        raise HTTPException(status_code=404, detail="No source PDF name for project")

    path = Path(project.source_pdf_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Source PDF file not found")

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=project.source_pdf_name,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
