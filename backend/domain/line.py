"""Pipeline line records shared by segmentation, recognition, and artifact export."""
from typing import Any

from pydantic import BaseModel


class Line(BaseModel):
    """One text line with page geometry and optional recognition metadata.

    ``bbox`` stores x/y minimum and maximum coordinates in rasterized page
    pixels. ``image_path`` points to the line crop read by the recognizer.
    Character confidences and positions describe model output; editing text
    does not realign those arrays. This is a worker/domain record, distinct
    from the SQLAlchemy line and the HTTP response schema.
    """
    id: str
    bbox: dict[str, int]  # {"x_min": int, "y_min": int, "x_max": int, "y_max": int}
    image_path: str = ""

    ocr_text: str | None = None
    correct_text: str | None = None
    confidence: float | None = None
    char_confidence: list[float] | None = None
    char_positions: list[dict[str, Any]] | None = None
    baseline_info: dict[str, Any] | None = None

    is_manual_edit: bool = False
    is_reviewed: bool = False
    is_deleted: bool = False

    def update_text(self, new_text: str) -> None:
        """Store corrected text and mark this line as manually edited."""
        self.correct_text = new_text
        self.is_manual_edit = True

    def mark_reviewed(self) -> None:
        """Mark review complete without changing recognized or corrected text."""
        self.is_reviewed = True
