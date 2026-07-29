import os
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import Pool
import threading
import time

if __package__ is None or __package__ == "":
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

from backend.models.project_config import ProjectConfig
from backend.models.project import Project
from backend.models.page import Page
from backend.runtime_paths import get_output_dir, get_temp_dir


def _process_page_task(args):
    from backend.stages.ingest import ingest
    from backend.stages.segment import segment

    page, stage_config = args
    page = ingest(page, stage_config)
    page = segment(page, stage_config)
    return page


def _resolve_segmentation_workers(default_workers: int) -> int:
    raw = os.getenv("MIMIR_SEGMENTATION_WORKERS")
    try:
        requested = int(raw) if raw is not None else default_workers
    except (TypeError, ValueError):
        requested = default_workers
    return max(1, min(requested, max(1, default_workers)))


def _page_cooldown_seconds() -> float:
    try:
        milliseconds = int(os.getenv("MIMIR_PAGE_COOLDOWN_MS", "0"))
    except ValueError:
        milliseconds = 0
    return max(0, milliseconds) / 1000.0


class PipelineRunner:
    def __init__(
        self,
        config: ProjectConfig,
        progress_callback: Callable[[str, int, str, dict[str, object] | None], None] | None = None,
    ):
        self.config = config
        self.progress_callback = progress_callback
        self.num_workers = config.num_workers
        self.segmentation_workers = _resolve_segmentation_workers(config.num_workers)
        self.page_cooldown_seconds = _page_cooldown_seconds()
        self.device = config.device
        self.temp_dir = config.temp_dir
        self.output_dir = config.output_dir
        self.logger = config.logger

    def _cool_down(self) -> None:
        if self.page_cooldown_seconds > 0:
            time.sleep(self.page_cooldown_seconds)

    def _report_progress(self, phase: str, progress: int, message: str, details=None) -> None:
        if self.progress_callback:
            self.progress_callback(phase, progress, message, details)

    @staticmethod
    def _progress_from_units(completed_units: int, total_units: int) -> int:
        if total_units <= 0:
            return 0
        return max(0, min(99, int((completed_units / total_units) * 100)))

    def process_project(self, project: Project):
        from backend.stages.export import export
        from backend.stages.ocr import ocr_pages
        from backend.stages.prepare import prepare_pages

        self._report_progress("preparing", 0, "Rasterizing PDF pages (0/?)", {
            "total_pages": None,
            "rasterized_pages": 0,
            "segmented_pages": 0,
            "ocr_pages": 0,
        })

        rasterized_count = 0
        total_pages_hint = 0

        def on_page_rasterized(completed: int, total: int) -> None:
            nonlocal rasterized_count, total_pages_hint
            rasterized_count = completed
            total_pages_hint = total
            self._report_progress(
                "preparing",
                self._progress_from_units(completed, max(1, total * 3)),
                f"Rasterizing PDF pages ({completed}/{total})",
                {
                    "total_pages": total,
                    "rasterized_pages": completed,
                    "segmented_pages": 0,
                    "ocr_pages": 0,
                },
            )

        pages = prepare_pages(project, self.config, on_page_rasterized=on_page_rasterized)
        project.pages = pages
        total_pages = len(pages)
        total_units = max(1, total_pages * 3)

        if total_pages == 0:
            self._report_progress("preparing", 33, "No pages found to process", {
                "total_pages": 0,
                "rasterized_pages": 0,
                "segmented_pages": 0,
                "ocr_pages": 0,
            })
            self._report_progress("exporting", 95, "Exporting OCR artifacts")
            export(project, self.config)
            self._report_progress("completed", 100, "OCR complete")
            return

        if rasterized_count == 0 and total_pages_hint == 0:
            self._report_progress(
                "preparing",
                self._progress_from_units(total_pages, total_units),
                f"Rasterizing PDF pages ({total_pages}/{total_pages})",
                {
                    "total_pages": total_pages,
                    "rasterized_pages": total_pages,
                    "segmented_pages": 0,
                    "ocr_pages": 0,
                },
            )

        self._report_progress(
            "segmenting",
            self._progress_from_units(total_pages, total_units),
            f"Segmenting pages (0/{total_pages})",
            {
                "total_pages": total_pages,
                "rasterized_pages": total_pages,
                "segmented_pages": 0,
                "ocr_pages": 0,
            },
        )

        def report_segmented(idx: int) -> None:
            self._report_progress(
                "segmenting",
                self._progress_from_units(total_pages + idx, total_units),
                f"Segmenting pages ({idx}/{total_pages})",
                {
                    "total_pages": total_pages,
                    "rasterized_pages": total_pages,
                    "segmented_pages": idx,
                    "ocr_pages": 0,
                },
            )
            self._cool_down()

        if self.segmentation_workers > 1:
            segmented_pages = []
            if threading.current_thread() is threading.main_thread():
                with Pool(processes=self.segmentation_workers) as pool:
                    tasks = [(page, self.config) for page in pages]
                    for idx, processed_page in enumerate(
                        pool.imap_unordered(_process_page_task, tasks), start=1
                    ):
                        segmented_pages.append(processed_page)
                        report_segmented(idx)
            else:
                with ThreadPoolExecutor(max_workers=self.segmentation_workers) as executor:
                    futures = [executor.submit(self.process_page, page, self.config) for page in pages]
                    for idx, future in enumerate(as_completed(futures), start=1):
                        segmented_pages.append(future.result())
                        report_segmented(idx)
            pages = sorted(segmented_pages, key=lambda page: page.page_number)
        else:
            pages_out = []
            for idx, page in enumerate(pages, start=1):
                pages_out.append(self.process_page(page, self.config))
                report_segmented(idx)
            pages = pages_out

        self._report_progress(
            "ocr",
            self._progress_from_units(total_pages * 2, total_units),
            f"Running OCR model (0/{total_pages} pages)",
            {
                "total_pages": total_pages,
                "rasterized_pages": total_pages,
                "segmented_pages": total_pages,
                "ocr_pages": 0,
            },
        )

        def on_ocr_page_done(completed: int, total: int) -> None:
            self._report_progress(
                "ocr",
                self._progress_from_units((total_pages * 2) + completed, total_units),
                f"Running OCR model ({completed}/{total} pages)",
                {
                    "total_pages": total_pages,
                    "rasterized_pages": total_pages,
                    "segmented_pages": total_pages,
                    "ocr_pages": completed,
                },
            )
            self._cool_down()

        pages = ocr_pages(pages, self.config, on_page_done=on_ocr_page_done)
        project.pages = pages
        self._report_progress("exporting", 95, "Exporting OCR artifacts")
        export(project, self.config)
        self._report_progress("completed", 100, "OCR complete")

    @staticmethod
    def process_page(page: Page, stage_config: ProjectConfig):
        from backend.stages.ingest import ingest
        from backend.stages.segment import segment

        return segment(ingest(page, stage_config), stage_config)


if __name__ == "__main__":
    demo_config = ProjectConfig(
        input_pdf_path="eventyr/pdfs/Norske-Eventyr.pdf",
        temp_dir=str(get_temp_dir() / "project3"),
        output_dir=str(get_output_dir() / "project3"),
        num_workers=2,
        device="cpu",
    )
    demo_project = Project(id="project3", name="Norske Eventyr", source_path=demo_config.input_pdf_path)
    PipelineRunner(demo_config).process_project(demo_project)
