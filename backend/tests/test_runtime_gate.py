from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest

import backend.runtime.gate as runtime


def test_job_lifecycle_rejects_stale_owners_and_hides_reservation():
    gate = runtime.RuntimeGate()
    reservation = gate.try_begin_job(42)
    assert reservation is not None
    assert gate.try_begin_job(43) is None
    assert gate.prepare_restart() is None
    stale = runtime.JobReservation("stale", 42)
    assert not gate.attach_job(stale, "wrong")
    gate.release_reservation(stale)
    assert gate.attach_job(reservation, "job-1")
    snapshot = gate.snapshot()
    assert snapshot["active_job"] == {"job_id": "job-1", "project_id": 42, "status": "running"}
    snapshot["active_job"]["status"] = "tampered"
    assert gate.snapshot()["active_job"]["status"] == "running"
    gate.finish_job("wrong")
    assert gate.try_begin_job(43) is None
    gate.finish_job("job-1")
    assert gate.snapshot()["runtime_state"] == "idle"
    assert gate.try_begin_job(43) is not None


def test_aborted_job_reservation_can_be_released():
    gate = runtime.RuntimeGate()
    reservation = gate.try_begin_job(1)
    gate.release_reservation(reservation)
    assert gate.prepare_restart() is not None


def test_only_one_concurrent_job_wins():
    gate = runtime.RuntimeGate()
    barrier = Barrier(8)

    def begin(project_id):
        barrier.wait(timeout=10)
        return gate.try_begin_job(project_id)

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(begin, range(8)))
    assert sum(result is not None for result in results) == 1


@pytest.mark.parametrize("elapsed,available", [(29, False), (30, True), (31, True)])
def test_restart_expiry_boundary(monkeypatch, elapsed, available):
    class Clock:
        current = datetime(2026, 1, 1, tzinfo=timezone.utc)

        @classmethod
        def now(cls, tz):
            return cls.current

    monkeypatch.setattr(runtime, "datetime", Clock)
    gate = runtime.RuntimeGate()
    token, expires = gate.prepare_restart()
    assert expires == Clock.current + timedelta(seconds=30)
    assert gate.prepare_restart() is None
    assert not gate.cancel_restart("wrong")
    Clock.current += timedelta(seconds=elapsed)
    assert (gate.try_begin_job(1) is not None) is available
    assert gate.cancel_restart(token) is (not available)
