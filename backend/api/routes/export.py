"""HTTP adapters for PDF and training-data exports."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.schemas import ExportPdfRequest
from backend.exporting.common import ExportArtifact, ExportError
from backend.exporting.pdf import build_pdf, ensure_pdf_dependency
from backend.exporting.training_data import build_training_data
from backend.persistence import repository


router = APIRouter(prefix="/export", tags=["export"])


def _response(artifact: ExportArtifact) -> StreamingResponse:
    return StreamingResponse(
        artifact.buffer,
        media_type=artifact.media_type,
        headers={"Content-Disposition": f'attachment; filename="{artifact.filename}"'},
    )


def _pdf_response(project_id: int, request: ExportPdfRequest, db: Session) -> StreamingResponse:
    try:
        # Preserve the existing dependency check before querying the project.
        ensure_pdf_dependency()
        project = repository.get_project(db, project_id=project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        pages = repository.list_project_pages(db, project_id=project_id)
        return _response(build_pdf(str(project.name or ""), pages, request))
    except ExportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/projects/{project_id}/pdf")
def export_project_pdf_post(
    project_id: int,
    request: ExportPdfRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return _pdf_response(project_id, request, db)


@router.get("/projects/{project_id}/pdf")
def export_project_pdf_get(
    project_id: int,
    request: ExportPdfRequest = Depends(),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return _pdf_response(project_id, request, db)


@router.get("/projects/{project_id}/training-data")
def export_project_training_data(project_id: int, db: Session = Depends(get_db)) -> StreamingResponse:
    project = repository.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    pages = repository.list_project_pages(db, project_id=project_id)
    try:
        return _response(build_training_data(project_id, str(project.name or ""), pages))
    except ExportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
