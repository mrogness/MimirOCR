import pytest

from backend.models.page import Page
from backend.models.project import Project
from backend.models.project_config import ProjectConfig
from backend.pipeline import runner as runner_mod


def _make_project(config: ProjectConfig) -> Project:
    return Project(id="p1", name="Test", source_path="input.pdf", config=config)


def _make_page(number: int) -> Page:
    return Page(id=f"page-{number}", page_number=number)


def test_parallel_segmentation_orders_pages_before_ocr(monkeypatch: pytest.MonkeyPatch):
    import backend.stages.export as export_stage
    import backend.stages.ocr as ocr_stage
    import backend.stages.prepare as prepare_stage

    config = ProjectConfig(num_workers=4)
    progress_events = []
    runner = runner_mod.PipelineRunner(
        config,
        progress_callback=lambda phase, progress, message, details=None: progress_events.append(
            (phase, progress, message, details)
        ),
    )
    runner.segmentation_workers = 2
    runner.page_cooldown_seconds = 0

    def fake_prepare_pages(_project, _config, on_page_rasterized=None):
        pages = [_make_page(0), _make_page(1), _make_page(2)]
        for idx in range(1, 4):
            on_page_rasterized(idx, 3)
        return pages

    class FakePool:
        def __init__(self, processes):
            self.processes = processes

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def imap_unordered(self, _func, tasks):
            for page, _cfg in reversed(tasks):
                yield page

    seen_ocr_order = []

    def fake_ocr_pages(pages, _config, on_page_done=None):
        seen_ocr_order.extend(page.page_number for page in pages)
        total = len(pages)
        for idx in range(1, total + 1):
            on_page_done(idx, total)
        return pages

    monkeypatch.setattr(prepare_stage, "prepare_pages", fake_prepare_pages)
    monkeypatch.setattr(ocr_stage, "ocr_pages", fake_ocr_pages)
    monkeypatch.setattr(export_stage, "export", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runner_mod, "Pool", FakePool)

    project = _make_project(config)
    runner.process_project(project)

    assert seen_ocr_order == [0, 1, 2]
    assert [page.page_number for page in project.pages] == [0, 1, 2]
    assert progress_events[-1][0] == "completed"
    assert progress_events[-1][1] == 100


def test_segmentation_failure_stops_before_ocr_and_export(monkeypatch: pytest.MonkeyPatch):
    import backend.stages.export as export_stage
    import backend.stages.ocr as ocr_stage
    import backend.stages.prepare as prepare_stage

    config = ProjectConfig(num_workers=1)
    runner = runner_mod.PipelineRunner(config)
    runner.segmentation_workers = 1
    runner.page_cooldown_seconds = 0

    def fake_prepare_pages(_project, _config, on_page_rasterized=None):
        pages = [_make_page(0), _make_page(1)]
        for idx in range(1, 3):
            on_page_rasterized(idx, 2)
        return pages

    def fake_process_page(page, _stage_config):
        if page.page_number == 1:
            raise RuntimeError("segmentation failed")
        return page

    calls = {"ocr": 0, "export": 0}

    def fake_ocr_pages(*_args, **_kwargs):
        calls["ocr"] += 1
        return []

    def fake_export(*_args, **_kwargs):
        calls["export"] += 1

    monkeypatch.setattr(prepare_stage, "prepare_pages", fake_prepare_pages)
    monkeypatch.setattr(runner_mod.PipelineRunner, "process_page", staticmethod(fake_process_page))
    monkeypatch.setattr(ocr_stage, "ocr_pages", fake_ocr_pages)
    monkeypatch.setattr(export_stage, "export", fake_export)

    project = _make_project(config)
    with pytest.raises(RuntimeError, match="segmentation failed"):
        runner.process_project(project)

    assert calls["ocr"] == 0
    assert calls["export"] == 0
