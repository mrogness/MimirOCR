import copy
import json

import pytest

from backend.database import Line


def snapshot():
    return {
        "id": 101, "page_id": 10, "line_order": 1,
        "ocr_text": "Første linje", "corrected_text": "Ændret ſkrift",
        "bounding_box": {"x_min": 1, "y_min": 2, "x_max": 50, "y_max": 20},
        "polygon_points": [[1, 2], [50, 2], [50, 20]],
        "char_positions": [{"char": "Æ", "start": 0, "end": 2}],
        "char_confidence": [0.9], "line_confidence": 0.9,
    }


def restore_payload():
    return {"line": snapshot(), "line_orders": [
        {"id": 101, "line_order": 1}, {"id": 102, "line_order": 2},
    ]}


@pytest.mark.parametrize("text", ["Æ ø ſ — corrected", ""])
def test_patch_persists_correction_without_changing_ocr(line_client, text):
    client, sessions = line_client
    response = client.patch("/lines/101", json={"corrected_text": text})
    assert response.status_code == 200
    assert response.json()["line"]["corrected_text"] == text
    with sessions() as db:
        row = db.get(Line, 101)
        assert row.corrected_text == text
        assert row.ocr_text == "Første linje"
        assert db.get(Line, 201).corrected_text is None


def test_missing_line_can_be_remapped_by_page_and_order(line_client):
    client, sessions = line_client
    response = client.patch("/lines/999", json={
        "corrected_text": "Recovered", "page_id": 10, "line_order": 2,
    })
    assert response.status_code == 200
    assert response.json()["line"]["id"] == 102
    with sessions() as db:
        assert db.get(Line, 102).corrected_text == "Recovered"


def test_missing_line_and_invalid_patch_are_rejected(line_client):
    client, _ = line_client
    assert client.patch("/lines/999", json={"corrected_text": "x"}).status_code == 404
    assert client.delete("/lines/999").status_code == 404
    assert client.patch("/lines/101", json={}).status_code == 422


def test_delete_restore_roundtrip_preserves_geometry_and_order(line_client):
    client, sessions = line_client
    response = client.delete("/lines/101")
    assert response.status_code == 204
    assert response.content == b""
    with sessions() as db:
        assert db.get(Line, 101) is None
    payload = restore_payload()
    payload["line_orders"] = [{"id": 102, "line_order": 1}, {"id": 101, "line_order": 2}]
    response = client.post("/lines/restore", json=payload)
    assert response.status_code == 200
    restored = response.json()["line"]
    assert restored["line_order"] == 2
    for field in ("bounding_box", "polygon_points", "char_positions", "corrected_text"):
        assert restored[field] == payload["line"][field]
    with sessions() as db:
        assert db.get(Line, 102).line_order == 1
        assert json.loads(db.get(Line, 101).char_confidence) == [0.9]
        assert db.get(Line, 201).line_order == 1


@pytest.mark.parametrize("orders", [
    [],
    [{"id": 101, "line_order": 1}],
    [{"id": 101, "line_order": 1}, {"id": 101, "line_order": 2}],
    [{"id": 101, "line_order": 1}, {"id": 201, "line_order": 2}],
    [{"id": 101, "line_order": 1}, {"id": 102, "line_order": 1}],
    [{"id": 101, "line_order": 1}, {"id": 102, "line_order": 3}],
    [{"id": 101, "line_order": 0}, {"id": 102, "line_order": 1}],
])
def test_invalid_restore_does_not_partially_mutate_database(line_client, orders):
    client, sessions = line_client
    client.delete("/lines/101")
    payload = restore_payload()
    payload["line_orders"] = copy.deepcopy(orders)
    assert client.post("/lines/restore", json=payload).status_code == 400
    with sessions() as db:
        assert db.get(Line, 101) is None
        assert db.get(Line, 102).line_order == 2
        assert db.get(Line, 201).line_order == 1


def test_restore_conflicts_and_missing_page(line_client):
    client, _ = line_client
    payload = restore_payload()
    assert client.post("/lines/restore", json=payload).status_code == 409
    payload["line"]["page_id"] = 999
    assert client.post("/lines/restore", json=payload).status_code == 404
