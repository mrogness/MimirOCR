from typing import Any

from pydantic import BaseModel


class Line(BaseModel):
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
        self.correct_text = new_text
        self.is_manual_edit = True

    def mark_reviewed(self) -> None:
        self.is_reviewed = True