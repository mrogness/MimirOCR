"""Standalone backend launcher for Tauri sidecar packaging."""

import argparse
import ctypes
import multiprocessing as mp
import os
import sys
import threading
import time
import uvicorn

# Mitigate TensorFlow/coremltools protobuf descriptor collisions in packaged runtimes.
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION_VERSION", "2")

from backend.main import app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Mimir backend sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--parent-pid", type=int, default=0)
    # In frozen multiprocessing child boots, Python may append internal flags
    # (for example spawn/fork bootstrap args). Ignore unknown args so child
    # startup cannot fail with argparse exit code 2.
    args, _unknown = parser.parse_known_args()
    return args


def _read_parent_pid(cli_parent_pid: int) -> int:
    if cli_parent_pid and cli_parent_pid > 0:
        return cli_parent_pid

    raw = (os.environ.get("MIMIR_PARENT_PID") or "").strip()
    if not raw:
        return 0

    try:
        parsed = int(raw)
    except ValueError:
        return 0

    return parsed if parsed > 0 else 0


def _is_parent_alive_unix(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return True

    try:
        os.kill(parent_pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

    return True


def _is_parent_alive_windows(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return True

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    SYNCHRONIZE = 0x00100000
    WAIT_OBJECT_0 = 0x00000000
    WAIT_TIMEOUT = 0x00000102

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, parent_pid)
    if not handle:
        return False

    try:
        wait_result = kernel32.WaitForSingleObject(handle, 0)
        if wait_result == WAIT_TIMEOUT:
            return True
        if wait_result == WAIT_OBJECT_0:
            return False
        return False
    finally:
        kernel32.CloseHandle(handle)


def _start_parent_watchdog(parent_pid: int) -> None:
    if parent_pid <= 0:
        return

    def monitor() -> None:
        while True:
            if sys.platform.startswith("win"):
                is_alive = _is_parent_alive_windows(parent_pid)
            else:
                is_alive = _is_parent_alive_unix(parent_pid)

            if not is_alive:
                os._exit(0)

            time.sleep(2.0)

    thread = threading.Thread(target=monitor, name="mimir-parent-watchdog", daemon=True)
    thread.start()


def main() -> None:
    # Required for multiprocessing spawn in frozen/PyInstaller executables.
    # Without this, child bootstrap args (e.g. --multiprocessing-fork) are
    # treated as app CLI args and the worker exits with argparse code 2.
    mp.freeze_support()

    args = parse_args()
    parent_pid = _read_parent_pid(args.parent_pid)
    _start_parent_watchdog(parent_pid)
    uvicorn.run(app, host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
