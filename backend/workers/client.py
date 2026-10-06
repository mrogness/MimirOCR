"""Launch one isolated runtime and make bounded, sequential JSON requests."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
import sys
import tempfile
from threading import Lock, Thread

from backend.models.page import Page
from backend.performance import worker_environment
from backend.workers.protocol import VERSION, decode, encode

ROOT = Path(__file__).resolve().parents[2]
_ACTIVE: set[WorkerClient] = set()
_ACTIVE_LOCK = Lock()
_SPAWN_LOCK = Lock()


class WorkerError(RuntimeError):
    pass


def worker_command(role: str) -> list[str]:
    if role not in ("segmenter", "recognizer"):
        raise ValueError(f"Unknown worker: {role}")
    if getattr(sys, "frozen", False):
        # Each onedir bundle is a sibling of backend-runtime, never inside _internal.
        name = f"mimir-{role}"
        binary = Path(sys.executable).parent.parent / name / (name + (".exe" if os.name == "nt" else ""))
        command = [str(binary)]
    else:
        override = os.environ.get(f"MIMIR_{role.upper()}_PYTHON")
        python = Path(override).expanduser() if override else (
            ROOT / ".venvs" / role / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        )
        command = [str(python.absolute()), "-u", "-m", f"backend.workers.{role}"]
    if not Path(command[0]).is_file():
        raise WorkerError(f"Missing {role} runtime: {command[0]}. Run yarn backend:setup or rebuild the app.")
    return command


def child_environment(role: str) -> dict[str, str]:
    env = os.environ.copy()
    for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
        env.pop(key, None)
    env.update(worker_environment(role))
    env.update({"PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1",
                "PYTHONNOUSERSITE": "1", "MIMIR_PARENT_PID": str(os.getpid())})
    if getattr(sys, "frozen", False):
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        env.pop("_MEIPASS2", None)
        if "LD_LIBRARY_PATH_ORIG" in env:
            env["LD_LIBRARY_PATH"] = env.pop("LD_LIBRARY_PATH_ORIG")
        else:
            env.pop("LD_LIBRARY_PATH", None)
        bundle = Path(sys._MEIPASS).resolve()
        for key in ("PATH", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"):
            if key in env:
                env[key] = os.pathsep.join(
                    entry for entry in env[key].split(os.pathsep)
                    if entry and not Path(entry).resolve().is_relative_to(bundle)
                )
    return env


def _spawn(command: list[str], role: str, log):
    # SetDllDirectory is process-global on Windows; serialize reset/spawn/restore.
    with _SPAWN_LOCK:
        frozen_windows = os.name == "nt" and getattr(sys, "frozen", False)
        if frozen_windows:
            ctypes.windll.kernel32.SetDllDirectoryW(None)
        try:
            return subprocess.Popen(
                command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                text=True, encoding="utf-8", bufsize=1, env=child_environment(role),
                cwd=None if getattr(sys, "frozen", False) else ROOT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        finally:
            if frozen_windows:
                ctypes.windll.kernel32.SetDllDirectoryW(sys._MEIPASS)


class WorkerClient:
    """One model-owning process per instance. One request at a time per client."""
    def __init__(self, role: str, *, command: list[str] | None = None, timeout: float | None = None):
        self.role = role
        self.timeout = float(timeout if timeout is not None else os.getenv("MIMIR_WORKER_TIMEOUT_SECONDS", "600"))
        if not 0 < self.timeout < float("inf"):
            raise ValueError("Worker timeout must be finite and positive")
        self._next_id = 0
        self._close_lock = Lock()
        self._closed = False
        self.log_tail = ""
        self._io_thread = None
        self._log = tempfile.TemporaryFile(mode="w+b")
        try:
            self.process = _spawn(command or worker_command(role), role, self._log)
        except BaseException:
            self._log.close()
            raise
        with _ACTIVE_LOCK:
            _ACTIVE.add(self)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def _log_tail(self) -> str:
        self._log.seek(0, os.SEEK_END)
        self._log.seek(max(0, self._log.tell() - 8000))
        return self._log.read().decode("utf-8", errors="replace").strip()

    def request(self, op: str, **payload) -> dict:
        if self._closed:
            raise WorkerError(f"{self.role}: worker is closed")
        self._next_id += 1
        request_id = self._next_id
        line = encode({"version": VERSION, "id": request_id, "op": op, **payload})
        reply: Queue = Queue(maxsize=1)

        def exchange():
            try:
                self.process.stdin.write(line)
                self.process.stdin.flush()
                reply.put(self.process.stdout.readline())
            except (OSError, ValueError) as exc:
                reply.put(exc)

        # Both the write and read are covered by the deadline, even for large pages.
        with self._close_lock:
            if self._closed:
                raise WorkerError(f"{self.role}: worker is closed")
            self._io_thread = Thread(target=exchange, name=f"{self.role}-ipc", daemon=True)
            self._io_thread.start()
        try:
            result = reply.get(timeout=self.timeout)
            if isinstance(result, Exception):
                raise WorkerError(f"IPC failed: {result}") from result
            if not result:
                raise WorkerError(f"Worker exited before replying (exit={self.process.poll()})")
            response = decode(result)
            if response.get("id") != request_id:
                raise WorkerError("Worker response ID mismatch")
            if response.get("type") == "error":
                raise WorkerError(response.get("error", "Worker failed"))
            if response.get("type") != ("ready" if op == "init" else "result"):
                raise WorkerError("Unexpected worker response")
            if op == "init" and response.get("role") != self.role:
                raise WorkerError("Worker role mismatch")
            return response
        except (Empty, ValueError, WorkerError) as exc:
            detail = "Request timed out" if isinstance(exc, Empty) else str(exc)
            self.close()
            raise WorkerError(f"{self.role}: {detail}\n{self.log_tail}") from exc
        finally:
            self._io_thread.join(timeout=1)

    def initialize(self, config) -> None:
        self.request("init", config=config.model_dump(mode="json"))

    def process_page(self, page: Page) -> Page:
        response = self.request("page", page=page.model_dump(mode="json"))
        try:
            result = Page.model_validate(response["page"])
            if (result.id, result.page_number) != (page.id, page.page_number):
                raise ValueError("Worker returned a different page")
            if self.role == "recognizer" and [l.id for l in result.lines] != [l.id for l in page.lines]:
                raise ValueError("OCR worker changed line identities/order")
            return result
        except (KeyError, ValueError) as exc:
            self.close()
            raise WorkerError(f"{self.role}: invalid result: {exc}") from exc

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            self._closed = True
            # No child-created pools: killing this process releases its models.
            if self.process.poll() is None:
                try:
                    self.process.terminate()
                except ProcessLookupError:
                    pass
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
            if self._io_thread is not None:
                self._io_thread.join(timeout=2)
            for stream in (self.process.stdin, self.process.stdout):
                try:
                    stream.close()
                except (OSError, ValueError):
                    pass
            self.log_tail = self._log_tail()
            self._log.close()
            with _ACTIVE_LOCK:
                _ACTIVE.discard(self)


def stop_workers() -> None:
    with _ACTIVE_LOCK:
        workers = list(_ACTIVE)
    for worker in workers:
        worker.close()
