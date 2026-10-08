from types import SimpleNamespace
from typing import cast

import pytest

from backend.workers.recognizer.engine import _disable_pipeline_params
from backend.workers.recognizer.predictions import _extract_char_confidence_from_positions
from backend.workers.recognizer.predictions import _extract_char_positions
from backend.workers.segmenter.reading_order import _bbox_from_meta
from backend.workers.segmenter.reading_order import _sort_lines_within_regions


def test_segment_helpers_filter_and_sort_lines_by_region():
    lines = [
        {"id": "left-top", "boundary": [[1, 1], [2, 1], [2, 2], [1, 2]]},
        {"id": "right", "boundary": [[20, 1], [21, 1], [21, 2], [20, 2]]},
        {"id": "left-bottom", "boundary": [[1, 10], [2, 10], [2, 11], [1, 11]]},
    ]

    seg = {
        "lines": lines,
        "regions": {
            "text": [
                {"boundary": [[15, 0], [30, 0], [30, 20], [15, 20]]},
                {"boundary": [[0, 0], [10, 0], [10, 20], [0, 20]]},
            ]
        },
    }
    ordered = _sort_lines_within_regions(seg)
    assert [line["id"] for line in ordered] == ["left-top", "left-bottom", "right"]


def test_segment_bbox_from_meta_supports_bbox_tuple_and_boundary_fallback():
    direct_bbox = _bbox_from_meta({"bbox": [10, 11, 20, 21]})
    assert direct_bbox == {"x_min": 10, "y_min": 11, "x_max": 20, "y_max": 21}

    boundary_bbox = _bbox_from_meta({"boundary": [[2, 4], [8, 4], [8, 9], [2, 9]]})
    assert boundary_bbox == {"x_min": 2, "y_min": 4, "x_max": 8, "y_max": 9}


def test_ocr_position_and_confidence_helpers_normalize_outputs():
    codec = SimpleNamespace(code2char={1: "A", 2: "B"})
    outputs = {
        "logits": [0, 0, 0, 0],
        "positions": [
            {
                "global_start": 0,
                "global_end": 0,
                "local_start": 18,
                "local_end": 24,
                "chars": [
                    {"label": 1, "probability": 0.91},
                    {"label": 2, "probability": 0.5},
                ],
            }
        ],
    }

    positions = _extract_char_positions(outputs, codec=codec)
    assert positions is not None
    first = next(iter(cast(list[dict], positions)), None)
    assert isinstance(first, dict)
    assert first["char"] == "A"
    assert first["start"] == pytest.approx(2.0)
    assert first["end"] == pytest.approx(8.0)
    assert first["domain"] == 4.0

    nested = {
        "positions": [
            {"chars": [{"probability": 0.2}, {"probability": 0.7}]},
            {"chars": [{"probability": 0.5}]},
        ]
    }
    assert _extract_char_confidence_from_positions(nested) == [0.7, 0.5]


def test_ocr_pipeline_parallelism_helper_updates_nested_params():
    nested = SimpleNamespace(run_parallel=True, num_threads=99, pipelines=[])
    params = SimpleNamespace(run_parallel=True, num_threads=77, pipelines=[nested])

    _disable_pipeline_params(params, max_threads=3)

    assert params.run_parallel is False
    assert params.num_threads == 3
    assert nested.run_parallel is False
    assert nested.num_threads == 3
