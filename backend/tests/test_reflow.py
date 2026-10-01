import json
from types import SimpleNamespace

import pytest

from backend.exporting.reflow import (
    BoundaryKind, RegionStats, SourceLine, SourceRegion, build_source_regions,
    classify_boundary, normalize_for_reflow, infer_reflow_paragraphs,
)


@pytest.mark.parametrize("enabled,expected", [(True, '"s s Æø'), (False, '„ſ ẛ Æø')])
def test_normalization_is_opt_in(enabled, expected):
    assert normalize_for_reflow(
        "  „ſ ẛ Æø  ", normalize_low_double_quote=enabled, normalize_long_s=enabled
    ) == expected


def source_line(identifier, text, y, *, page=0, region=0):
    return SourceLine(identifier, text, 0, y, 100, y + 10, page, region, identifier)


@pytest.mark.parametrize("mark", ["⸗", "⸺", "⸻"])
def test_historical_join_mark_can_join_across_pages(mark):
    previous = source_line(1, "For" + mark, 100)
    current = source_line(2, "bindelse", 0, page=1)
    stats = RegionStats(0, 100, 10, 8, 5)
    assert classify_boundary(previous, current, previous_stats=stats,
                             join_historical_line_breaks=True).kind == BoundaryKind.JOIN_WITHOUT_SPACE
    assert classify_boundary(previous, current, previous_stats=stats,
                             join_historical_line_breaks=False).kind == BoundaryKind.BLOCK


def test_large_gap_creates_paragraph_and_different_column_creates_block():
    previous = source_line(1, "Text", 0)
    stats = RegionStats(0, 100, 10, 8, 5)
    assert classify_boundary(previous, source_line(2, "Next", 80), previous_stats=stats,
                             join_historical_line_breaks=True).kind == BoundaryKind.PARAGRAPH
    assert classify_boundary(previous, source_line(2, "Column", 0, region=1), previous_stats=stats,
                             join_historical_line_breaks=True).kind == BoundaryKind.BLOCK


def test_spread_regions_ignore_invalid_geometry_and_use_corrected_text():
    def row(identifier, bbox, text, corrected=None):
        return SimpleNamespace(id=identifier, line_order=identifier, bounding_box=bbox,
                               ocr_text=text, corrected_text=corrected)

    page = SimpleNamespace(page_number=4, width=1000, lines=[
        row(1, json.dumps(dict(x_min=600, y_min=0, x_max=900, y_max=10)), "right"),
        row(2, json.dumps(dict(x_min=10, y_min=20, x_max=400, y_max=30)), "wrong", "left"),
        row(3, "not-json", "invalid"),
        row(4, json.dumps(dict(x_min=10, y_min=0, x_max=10, y_max=10)), "zero width"),
        row(5, "[]", "not an object"),
    ])
    regions = build_source_regions([page], spread_mode="split-spread",
                                   normalize_low_double_quote=False, normalize_long_s=False)
    assert [[line.text for line in region.lines] for region in regions] == [["left"], ["right"]]
    assert [region.source_region_index for region in regions] == [0, 1]
    assert all(region.source_page_number == 4 for region in regions)


@pytest.mark.parametrize("join,normalize,expected", [
    (True, False, "Forbindelse"),
    (False, False, "For⸗ bindelse"),
    (False, True, "For- bindelse"),
])
def test_reflow_paragraph_text_and_provenance(join, normalize, expected):
    lines = [source_line(1, "For⸗", 0), source_line(2, "bindelse", 18)]
    regions = [SourceRegion(0, 0, lines, RegionStats(0, 100, 10, 8, 5))]
    paragraphs = infer_reflow_paragraphs(regions, join_historical_line_breaks=join,
                                        normalize_double_oblique_hyphen=normalize)
    assert len(paragraphs) == 1
    assert paragraphs[0].text == expected
    assert paragraphs[0].source_line_ids == [1, 2]
    assert paragraphs[0].source_page_numbers == [0]


def test_empty_document_has_no_reflow_paragraphs():
    assert infer_reflow_paragraphs([], join_historical_line_breaks=True,
                                  normalize_double_oblique_hyphen=True) == []
