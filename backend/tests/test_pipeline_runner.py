import sys
import pytest

from backend.domain.page import Page
from backend.domain.project import Project
from backend.domain.project_config import ProjectConfig
from backend.pipeline.runner import PipelineRunner
from backend.workers import client as clients


@pytest.fixture
def fake_pipeline(monkeypatch):
    from backend.pipeline import prepare, artifacts
    monkeypatch.setattr(clients, "worker_command", lambda role:
                        [sys.executable, "-u", "-m", "backend.tests.fake_worker", role])
    calls = []
    monkeypatch.setattr(artifacts, "export", lambda project, config: calls.append(project))
    def setup(pages):
        def prepare_pages(project, config, on_page_rasterized):
            for idx in range(len(pages)):
                on_page_rasterized(idx + 1, len(pages))
            return pages
        monkeypatch.setattr(prepare, "prepare_pages", prepare_pages)
        return calls
    return setup


def test_parallel_workers_preserve_order_and_progress(fake_pipeline):
    pages = [Page(id=str(n), page_number=n, metadata={"delay": 0.2 if n == 0 else 0}) for n in range(4)]
    exported = fake_pipeline(pages)
    config = ProjectConfig(num_workers=2)
    project = Project(id="p", name="Test", source_path="input.pdf", config=config)
    progress = []
    runner = PipelineRunner(config, lambda *args: progress.append(args))
    runner.page_cooldown_seconds = 0
    runner.process_project(project)
    assert [p.page_number for p in project.pages] == [0, 1, 2, 3]
    # One recognizer process handles every page, with one initialization.
    assert len({p.metadata["pid"] for p in project.pages}) == 1
    assert [p.metadata["calls"] for p in project.pages] == [1, 2, 3, 4]
    assert len(exported) == 1
    assert [p[1] for p in progress] == sorted(p[1] for p in progress)
    assert progress[-1][:2] == ("completed", 100)
    assert not clients._ACTIVE


def test_failed_segmentation_stops_other_workers_before_cleanup(fake_pipeline):
    exported = fake_pipeline([
        Page(id="bad", page_number=0, metadata={"mode": "error"}),
        Page(id="slow", page_number=1, metadata={"delay": 60}),
    ])
    project = Project(id="p", name="Test", source_path="input.pdf")
    with pytest.raises(clients.WorkerError, match="fake inference failed"):
        PipelineRunner(ProjectConfig(num_workers=2)).process_project(project)
    assert not exported
    assert not clients._ACTIVE


def test_empty_document_does_not_launch_workers(fake_pipeline, monkeypatch):
    exported = fake_pipeline([])
    monkeypatch.setattr(clients, "worker_command", lambda role: pytest.fail("unnecessary worker"))
    project = Project(id="p", name="Test", source_path="input.pdf")
    PipelineRunner(ProjectConfig()).process_project(project)
    assert project.pages == []
    assert len(exported) == 1
