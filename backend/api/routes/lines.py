import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Response, status
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import LineUpdateRequest, LineUpdateResponse, ProjectLineRead

router = APIRouter(prefix="/lines", tags=["lines"])


@router.patch("/{line_id}", response_model=LineUpdateResponse)
def update_line(line_id: int, payload: LineUpdateRequest, db: Session = Depends(get_db)) -> LineUpdateResponse:
    line = crud.get_line(db, line_id)
    if not line and payload.page_id is not None and payload.line_order is not None:
        line = crud.get_line_by_page_and_order(db, payload.page_id, payload.line_order)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    updated = crud.update_line(db, line, payload.corrected_text, payload.line_order)
    bbox = json.loads(updated.bounding_box) if updated.bounding_box else None
    polygon_points = json.loads(updated.polygon_points) if updated.polygon_points else None

    return LineUpdateResponse(
        line=ProjectLineRead(
            id=updated.id,
            page_id=updated.page_id,
            line_order=updated.line_order,
            img_path=updated.img_path,
            bounding_box=bbox,
            polygon_points=polygon_points,
            ocr_text=updated.ocr_text,
            corrected_text=updated.corrected_text,
            line_confidence=updated.line_confidence,
            char_confidence=updated.char_confidence,
            char_positions=json.loads(updated.char_positions) if updated.char_positions else None,
        )
    )


@router.delete("/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_line(line_id: int, db: Session = Depends(get_db)) -> Response:
    line = crud.get_line(db, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    crud.delete_line(db, line)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
