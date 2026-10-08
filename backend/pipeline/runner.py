from collections.abc import Callable
from pathlib import Path
import time

from backend.domain.project_config import ProjectConfig
from backend.domain.project import Project
from backend.runtime.performance import get_active_limits
from backend.pipeline.dispatch import run_stage


class PipelineRunner:
    def __init__(self, config: ProjectConfig, progress_callback: Callable | None = None):
        self.config = config.model_copy(deep=True)
        # Workers do not depend on the API process's working directory.
        self.config.temp_dir = str(Path(config.temp_dir).resolve())
        self.config.output_dir = str(Path(config.output_dir).resolve())
        model = Path(config.ocr.model_path).expanduser()
        if model.exists():
            self.config.ocr.model_path = str(model.resolve())
        self.progress_callback = progress_callback
        self.page_cooldown_seconds = get_active_limits().page_cooldown_ms / 1000

    def _report_progress(self, phase, progress, message, details=None):
        if self.progress_callback:
            self.progress_callback(phase, progress, message, details)

    def process_project(self, project: Project):
        from backend.pipeline.artifacts import export
        from backend.pipeline.prepare import prepare_pages

        def report(phase, completed, total, offset, label):
            counts = {
                "total_pages": total,
                "rasterized_pages": completed if offset == 0 else total,
                "segmented_pages": completed if offset == 1 else (total if offset == 2 else 0),
                "ocr_pages": completed if offset == 2 else 0,
            }
            progress = min(94, int(94 * (offset * total + completed) / max(1, total * 3)))
            self._report_progress(phase, progress, f"{label} ({completed}/{total})", counts)
            if offset and completed and self.page_cooldown_seconds:
                time.sleep(self.page_cooldown_seconds)

        self._report_progress("preparing", 0, "Rasterizing PDF pages")
        pages = prepare_pages(project, self.config, on_page_rasterized=lambda n, total:
                              report("preparing", n, total, 0, "Rasterizing PDF pages"))
        total = len(pages)
        report("segmenting", 0, total, 1, "Segmenting pages")
        # Multiple CPU workers reuse one model each. Avoid duplicating GPU models.
        workers = max(1, self.config.num_workers) if self.config.device == "cpu" else 1
        pages = run_stage("segmenter", pages, self.config, workers,
                          lambda n, total: report("segmenting", n, total, 1, "Segmenting pages"))
        report("ocr", 0, total, 2, "Running OCR model")
        pages = run_stage("recognizer", pages, self.config, 1,
                          lambda n, total: report("ocr", n, total, 2, "Running OCR model"))
        project.pages = pages
        self._report_progress("exporting", 95, "Exporting OCR artifacts")
        export(project, self.config)
        self._report_progress("completed", 100, "OCR complete")
