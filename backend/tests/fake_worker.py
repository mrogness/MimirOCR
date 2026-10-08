"""Model-free engine for tests of the production stdio loop and process client."""
import os
import sys
import time
from backend.domain.line import Line
from backend.workers.server import serve


def initialize(config):
    # Exercise OS-level output redirection, not only Python print interception.
    os.write(1, b"native initialization log\n")
    calls = 0

    def process(page):
        nonlocal calls
        calls += 1
        mode = page.metadata.get("mode")
        if mode == "error":
            raise ValueError("fake inference failed")
        if mode == "exit":
            os.write(2, b"native crash diagnostic\n")
            os._exit(9)
        time.sleep(page.metadata.get("delay", 0))
        page.metadata.update(pid=os.getpid(), calls=calls, threads=os.environ["OMP_NUM_THREADS"])
        if not page.lines:
            page.lines = [Line(id=page.id + "_line_1", image_path=page.image_path,
                               bbox={"x_min": 1, "y_min": 2, "x_max": 30, "y_max": 20},
                               baseline_info={"source_order": 1})]
        for line in page.lines:
            line.ocr_text = "Æble, ø og Å — 日本語"
            line.confidence = 0.95
            line.char_positions = [{"char": "Æ", "start": 1, "end": 4,
                                    "candidates": [{"char": "A", "probability": 0.05}]}]
        return page
    return process


if __name__ == "__main__":
    role = sys.argv.pop(1)
    serve(role, initialize)
