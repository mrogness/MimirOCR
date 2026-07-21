from typing import Any

from pydantic import BaseModel, Field

from backend.models.line import Line


class Page(BaseModel):
    id: str
    page_number: int

    image_path: str = ""
    width: int = 0
    height: int = 0

    lines: list[Line] = Field(default_factory=list)
    rotation: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def text(self) -> str:
        return "\n".join(l.correct_text or l.ocr_text or "" for l in self.ordered_lines())

    def ordered_lines(self) -> list[Line]:
        return sorted(self.lines, key=lambda l: (self._source_order(l), *self._xy_from_bbox(l.bbox)))

    @staticmethod
    def _xy_from_bbox(bbox: object) -> tuple[float, float]:
        if isinstance(bbox, dict):
            y = bbox.get("y_min")
            x = bbox.get("x_min")
            return (
                float(y) if isinstance(y, (int, float)) else float("inf"),
                float(x) if isinstance(x, (int, float)) else float("inf"),
            )

        if isinstance(bbox, (list, tuple)) and len(bbox) >= 2:
            x = bbox[0]
            y = bbox[1]
            return (
                float(y) if isinstance(y, (int, float)) else float("inf"),
                float(x) if isinstance(x, (int, float)) else float("inf"),
            )

        return (float("inf"), float("inf"))

    @staticmethod
    def _source_order(line: Line) -> int:
        meta = line.baseline_info if isinstance(line.baseline_info, dict) else {}
        order = meta.get("source_order")
        return order if isinstance(order, int) else 10**9

    @property
    def confidence(self) -> float | None:
        # average of lines that have a confidence score
        scored = [l.confidence for l in self.lines if l.confidence is not None]
        return sum(scored) / len(scored) if scored else None

    def get_low_confidence_lines(self, threshold: float = 0.8) -> list[Line]:
        return [l for l in self.lines if l.confidence is not None and l.confidence < threshold]

    def sort_lines(self) -> None:
        sorted_lines = list(self.lines)
        sorted_lines.sort(key=lambda l: self._xy_from_bbox(l.bbox))
        self.lines = sorted_lines

    def update_line(self, line_id: str, new_text: str) -> None:
        for line in self.lines:
            if line.id == line_id:
                line.update_text(new_text)
                return