"""Shared worker loop. stdout is reserved at the OS descriptor level for IPC."""
import argparse
import os
import sys
import traceback

from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.runtime.parent_watchdog import start_parent_watchdog
from backend.workers.protocol import VERSION, decode, encode


def serve(role: str, initialize) -> None:
    parser = argparse.ArgumentParser(description=f"Mimir {role} worker")
    parser.parse_args()
    start_parent_watchdog(direct_parent=True)

    # Redirect native libraries' printf output as well as Python print output.
    # Keep console builds on Windows: --noconsole would remove these streams.
    sys.stdout.flush()
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1) as output:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        handler = None
        for line in sys.stdin:
            request_id = None
            try:
                request = decode(line)
                request_id = request["id"]
                if request["op"] == "init" and handler is None:
                    config = ProjectConfig.model_validate(request["config"])
                    handler = initialize(config)
                    response = {"type": "ready", "role": role}
                elif request["op"] == "page" and handler is not None:
                    page = Page.model_validate(request["page"])
                    response = {"type": "result", "page": handler(page).model_dump()}
                else:
                    raise ValueError("Expected init once, then page requests")
                output.write(encode({"version": VERSION, "id": request_id, **response}))
                output.flush()
            except Exception as exc:
                traceback.print_exc(file=sys.stderr)
                output.write(encode({
                    "version": VERSION, "id": request_id, "type": "error",
                    "error": f"{type(exc).__name__}: {exc}",
                }))
                output.flush()
                raise SystemExit(1) from exc
