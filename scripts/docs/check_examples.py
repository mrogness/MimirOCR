"""Validate illustrative worker exchanges against the production domain/protocol.

No worker process, model, or image file is loaded. Run in the API environment.
"""
import json
from pathlib import Path, PurePosixPath, PureWindowsPath

ROOT = Path(__file__).resolve().parents[2]


def validate_examples(root: Path = ROOT) -> None:
    """Fail generation if example envelopes or page/config schemas drift."""
    from backend.domain.page import Page
    from backend.domain.project_config import ProjectConfig
    from backend.workers.protocol import decode, encode

    examples = json.loads((root / "docs/contracts/examples/worker-exchanges.json").read_text(encoding="utf-8"))
    for role in ("segmenter", "recognizer"):
        exchanges = examples[role]
        assert len(exchanges) == 2, f"{role}: expected init and page exchanges"
        for request_id, exchange in enumerate(exchanges, start=1):
            request = decode(encode(exchange["request"]))
            response = decode(encode(exchange["response"]))
            assert request["id"] == response["id"] == request_id
            if request_id == 1:
                assert request["op"] == "init"
                ProjectConfig.model_validate(request["config"])
                assert response["type"] == "ready" and response["role"] == role
            else:
                assert request["op"] == "page" and response["type"] == "result"
                before = Page.model_validate(request["page"])
                after = Page.model_validate(response["page"])
                assert (before.id, before.page_number) == (after.id, after.page_number)
                for page in (before, after):
                    for path in [page.image_path, *(line.image_path for line in page.lines)]:
                        assert PurePosixPath(path).is_absolute() or PureWindowsPath(path).is_absolute()
                if role == "recognizer":
                    assert [line.id for line in before.lines] == [line.id for line in after.lines]
    assert examples["segmenter"][1]["response"]["page"] == examples["recognizer"][1]["request"]["page"]


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    validate_examples()
    print("Worker documentation examples match the current protocol and domain schemas.")
