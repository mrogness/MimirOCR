import pytest

from backend.models.line import Line
from backend.models.page import Page
from backend.models.project_config import ProjectConfig


def line(identifier, x=0, y=0, **kwargs):
    return Line(id=identifier, bbox={"x_min": x, "y_min": y, "x_max": x + 100, "y_max": y + 10}, **kwargs)


def test_reading_order_prefers_model_order_then_geometry_without_mutation():
    page = Page(id="page", page_number=0, lines=[
        line("right", x=500, y=0, baseline_info={"source_order": 2}),
        line("left", y=50, baseline_info={"source_order": 1}),
        line("last", x=10, y=100),
        line("fallback", x=0, y=100),
    ])
    assert [item.id for item in page.ordered_lines()] == ["left", "right", "fallback", "last"]
    assert page.lines[0].id == "right"


def test_correction_preserves_prediction_and_marks_manual_edit():
    page = Page(id="page", page_number=0, lines=[line("a", ocr_text="Original")])
    page.update_line("a", "Ændret")
    assert page.text == "Ændret"
    assert page.lines[0].ocr_text == "Original"
    assert page.lines[0].is_manual_edit
    page.update_line("missing", "Ignored")
    assert len(page.lines) == 1


def test_confidence_ignores_missing_values_but_includes_zero():
    page = Page(id="page", page_number=0, lines=[
        line("zero", confidence=0.0), line("boundary", confidence=0.8), line("unknown"),
    ])
    assert page.confidence == pytest.approx(0.4)
    assert [item.id for item in page.get_low_confidence_lines(0.8)] == ["zero"]
    assert Page(id="empty", page_number=0).confidence is None


def test_mutable_defaults_are_not_shared():
    first, second = ProjectConfig(), ProjectConfig()
    first.ingestion.dpi = 600
    first.ocr.disambiguate_ij = False
    assert second.ingestion.dpi == 300
    assert second.ocr.disambiguate_ij is True
    a, b = Page(id="a", page_number=0), Page(id="b", page_number=1)
    a.lines.append(line("a"))
    a.metadata["test"] = True
    assert b.lines == []
    assert b.metadata == {}
