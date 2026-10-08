import json
import os
from pathlib import Path
import subprocess
import sys
from threading import Thread

import pytest

from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers import client as module
from backend.workers.client import WorkerClient, WorkerError
from backend.workers.protocol import VERSION


def fake_command(role="segmenter"):
    return [sys.executable, "-u", "-m", "backend.tests.fake_worker", role]


def test_real_process_round_trip_reuses_model_and_preserves_metadata():
    with WorkerClient("segmenter", command=fake_command()) as worker:
        worker.initialize(ProjectConfig())
        first = worker.process_page(Page(id="p1", page_number=0, image_path="/path with spaces/æ.png"))
        second = worker.process_page(Page(id="p2", page_number=1))
        assert first.metadata["pid"] == second.metadata["pid"] == worker.process.pid
        assert first.metadata["calls"] == 1 and second.metadata["calls"] == 2
        assert first.lines[0].ocr_text == "Æble, ø og Å — 日本語"
        assert first.lines[0].baseline_info == {"source_order": 1}
        assert first.lines[0].char_positions[0]["candidates"][0]["char"] == "A"
        assert first.lines[0].image_path == "/path with spaces/æ.png"
    assert worker.process.poll() is not None
    assert "native initialization log" in worker.log_tail


@pytest.mark.parametrize("mode,message", [("error", "fake inference failed"), ("exit", "native crash diagnostic")])
def test_worker_errors_and_native_crashes_are_actionable(mode, message):
    with WorkerClient("segmenter", command=fake_command()) as worker:
        worker.initialize(ProjectConfig())
        with pytest.raises(WorkerError, match=message):
            worker.process_page(Page(id="p", page_number=0, metadata={"mode": mode}))
    assert worker.process.poll() is not None


def test_deadline_kills_hung_inference():
    with WorkerClient("segmenter", command=fake_command()) as worker:
        worker.initialize(ProjectConfig())
        worker.timeout = 0.15
        with pytest.raises(WorkerError, match="timed out"):
            worker.process_page(Page(id="p", page_number=0, metadata={"delay": 60}))
    assert worker.process.poll() is not None


def test_deadline_includes_blocked_stdin_write():
    with WorkerClient("segmenter", command=[sys.executable, "-c", "import time; time.sleep(60)"], timeout=0.15) as worker:
        with pytest.raises(WorkerError, match="timed out"):
            worker.request("init", config={"large": "x" * 2_000_000})
    assert worker.process.poll() is not None


@pytest.mark.parametrize("response", [
    {"version": 99, "id": 1, "type": "ready", "role": "segmenter"},
    {"version": VERSION, "id": 99, "type": "ready", "role": "segmenter"},
    {"version": VERSION, "id": 1, "type": "ready", "role": "recognizer"},
    {"version": VERSION, "id": 1, "type": "unexpected"},
])
def test_rejects_protocol_mismatch(response):
    code = f"import sys; sys.stdin.readline(); print({json.dumps(response)!r}, flush=True)"
    with WorkerClient("segmenter", command=[sys.executable, "-c", code]) as worker:
        with pytest.raises(WorkerError):
            worker.initialize(ProjectConfig())


def test_stop_workers_unblocks_outstanding_requests():
    with WorkerClient("recognizer", command=fake_command("recognizer")) as worker:
        worker.initialize(ProjectConfig())
        errors = []
        def run():
            try:
                worker.process_page(Page(id="p", page_number=0, metadata={"delay": 60}))
            except WorkerError as exc:
                errors.append(exc)
        thread = Thread(target=run)
        thread.start()
        module.stop_workers()
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert errors
    assert not module._ACTIVE


def test_development_interpreters_are_explicit_and_separate(tmp_path, monkeypatch):
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.delattr(sys, "frozen", raising=False)
    for role in ("segmenter", "recognizer"):
        monkeypatch.delenv(f"MIMIR_{role.upper()}_PYTHON", raising=False)
        path = tmp_path / ".venvs" / role / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        path.parent.mkdir(parents=True)
        path.touch()
        assert module.worker_command(role)[0] == str(path)
    assert module.worker_command("segmenter")[0] != module.worker_command("recognizer")[0]


def test_frozen_discovery_uses_sibling_bundle_and_cleans_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    api = tmp_path / "backend-runtime"
    internal = api / "_internal"
    internal.mkdir(parents=True)
    monkeypatch.setattr(sys, "executable", str(api / "backend-runtime"))
    monkeypatch.setattr(sys, "_MEIPASS", str(internal), raising=False)
    monkeypatch.setenv("PYTHONPATH", "wrong environment")
    monkeypatch.setenv("LD_LIBRARY_PATH", str(internal))
    monkeypatch.delenv("LD_LIBRARY_PATH_ORIG", raising=False)
    monkeypatch.setenv("PATH", os.pathsep.join([str(internal / "lib"), str(tmp_path / "system")]))
    name = "mimir-segmenter" + (".exe" if os.name == "nt" else "")
    binary = tmp_path / "mimir-segmenter" / name
    binary.parent.mkdir()
    binary.touch()
    assert module.worker_command("segmenter") == [str(binary)]
    env = module.child_environment("segmenter")
    assert "PYTHONPATH" not in env and "LD_LIBRARY_PATH" not in env
    assert env["PATH"] == str(tmp_path / "system")
    assert env["PYINSTALLER_RESET_ENVIRONMENT"] == "1"
    assert env["MIMIR_PARENT_PID"] == str(os.getpid())


def test_missing_runtime_does_not_fall_back_to_api_python(tmp_path, monkeypatch):
    monkeypatch.setenv("MIMIR_SEGMENTER_PYTHON", str(tmp_path / "missing"))
    with pytest.raises(WorkerError, match="Missing segmenter runtime"):
        module.worker_command("segmenter")


def test_worker_exits_when_parent_disappears(tmp_path):
    # Parent stays alive through initialization, starts slow inference, then dies.
    # The grandchild keeps the inherited stderr pipe open until its watchdog exits.
    code = '''
import os, subprocess, sys
from backend.workers.protocol import encode
p = subprocess.Popen([sys.executable, '-u', '-m', 'backend.tests.fake_worker', 'segmenter'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
    env={**os.environ, 'MIMIR_PARENT_PID': str(os.getpid())})
p.stdin.write(encode({'version': 1, 'id': 1, 'op': 'init', 'config': {}})); p.stdin.flush()
assert p.stdout.readline()
p.stdin.write(encode({'version': 1, 'id': 2, 'op': 'page', 'page': {'id': 'p', 'page_number': 0, 'metadata': {'delay': 60}}})); p.stdin.flush()
os._exit(0)
'''
    parent = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        _, stderr = parent.communicate(timeout=12)
        assert parent.returncode == 0, stderr
    finally:
        if parent.poll() is None:
            parent.kill()
            parent.wait()
