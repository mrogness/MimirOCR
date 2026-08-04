import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Response, status
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import (
    LineRestoreRequest,
    LineRestoreResponse,
    LineUpdateRequest,
    LineUpdateResponse,
    ProjectLineRead,
)

router = APIRouter(prefix="/lines", tags=["lines"])


def _line_to_read_payload(line) -> ProjectLineRead:
    bbox = json.loads(line.bounding_box) if line.bounding_box else None
    polygon_points = json.loads(line.polygon_points) if line.polygon_points else None
    char_positions = json.loads(line.char_positions) if line.char_positions else None
    return ProjectLineRead(
        id=line.id,
        page_id=line.page_id,
        line_order=line.line_order,
        img_path=line.img_path,
        bounding_box=bbox,
        polygon_points=polygon_points,
        ocr_text=line.ocr_text,
        corrected_text=line.corrected_text,
        line_confidence=line.line_confidence,
        char_confidence=line.char_confidence,
        char_positions=char_positions,
    )


@router.patch("/{line_id}", response_model=LineUpdateResponse)
def update_line(line_id: int, payload: LineUpdateRequest, db: Session = Depends(get_db)) -> LineUpdateResponse:
    line = crud.get_line(db, line_id)
    if not line and payload.page_id is not None and payload.line_order is not None:
        line = crud.get_line_by_page_and_order(db, payload.page_id, payload.line_order)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    updated = crud.update_line(db, line, payload.corrected_text, payload.line_order)
    return LineUpdateResponse(line=_line_to_read_payload(updated))


@router.post("/restore", response_model=LineRestoreResponse)
def restore_line(payload: LineRestoreRequest, db: Session = Depends(get_db)) -> LineRestoreResponse:
    try:
        restored = crud.restore_deleted_line(db, payload.line, payload.line_orders)
    except LookupError as error:
        if str(error) == "page-not-found":
            raise HTTPException(status_code=404, detail="Page not found") from error
        raise
    except FileExistsError as error:
        if str(error) == "line-id-occupied":
            raise HTTPException(status_code=409, detail="Line ID already exists") from error
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return LineRestoreResponse(line=_line_to_read_payload(restored))


@router.delete("/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_line(line_id: int, db: Session = Depends(get_db)) -> Response:
    line = crud.get_line(db, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    crud.delete_line(db, line)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
