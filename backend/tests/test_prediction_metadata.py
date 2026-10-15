"""Calamari-shaped fixtures require no TensorFlow, NumPy or model files."""
from types import SimpleNamespace

import pytest

from backend.workers.recognizer import predictions as p


def test_nested_predictions_decode_labels_and_preserve_position_domain():
    output = {"prediction": {"logits": [[0]] * 100, "positions": [
        {"local_start": 20, "local_end": 30, "chars": [
            {"label": 0, "probability": 0.99},
            {"label": 1, "probability": 0.8},
            {"label": 2, "probability": 0.2},
        ]},
    ]}}
    positions = p._extract_char_positions(output, codec={"code2char": {0: "", 1: "Æ", 2: "A"}})
    assert positions == [{
        "index": 0, "start": 4, "end": 14, "domain": 100,
        "char": "Æ", "label": 1, "char_id": 1, "probability": 0.8,
        "candidates": [{"char": "Æ", "label": 1, "char_id": 1, "probability": 0.8},
                       {"char": "A", "label": 2, "char_id": 2, "probability": 0.2}],
    }]


def test_candidates_are_nonblank_distinct_ranked_and_bounded():
    chars = [{"char": ch, "probability": value} for ch, value in [
        ("", 1), ("a", 0.1), ("a", 0.9), ("b", 0.8), ("c", 0.7),
        ("d", 0.6), ("e", 0.5), ("f", 0.4), ("bad", float("nan")),
    ]]
    candidates = p._extract_char_candidates(chars)
    assert [candidate["char"] for candidate in candidates] == list("abcde")
    assert candidates[0]["probability"] == 0.9


@pytest.mark.parametrize("start,end,expected", [(30, 20, (20, 30)), (None, 20, (20, 20)), (0, 0, (0, 0))])
def test_spans_normalize_reversed_or_partial_global_coordinates(start, end, expected):
    output = {"positions": [{"global_start": start, "global_end": end, "chars": []}]}
    position = p._extract_char_positions(output)[0]
    assert (position["start"], position["end"]) == expected


def test_missing_or_malformed_metadata_is_optional():
    assert p._extract_char_positions({"positions": "bad"}) is None
    assert p._extract_char_positions({"positions": [{"global_start": float("inf")} ]}) is None
    assert p._extract_char_confidence(SimpleNamespace(char_confidences="bad")) is None
    assert p._extract_line_confidence(SimpleNamespace(confidence=float("nan"))) is None


def test_confidence_extraction_accepts_nested_runtime_shapes():
    output = SimpleNamespace(prediction={"positions": [
        {"chars": [{"probability": 0.2}, {"probability": 0.9}]},
        {"chars": [{"probability": "bad"}, {"probability": 0.7}]},
    ]})
    assert p._extract_char_confidence(output) == [0.9, 0.7]
    assert p._coerce_confidence_sequence({"values": [{"confidence": 0.8}, [0.6], float("nan")]}) == [0.8, 0.6]
