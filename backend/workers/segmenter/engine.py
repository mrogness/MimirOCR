"""Load Kraken segmentation and write binarized line crops."""
from __future__ import annotations

from dataclasses import asdict, replace
import os
from typing import Any, Iterable, TYPE_CHECKING

from backend.domain.line import Line
from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers.segmenter.reading_order import _bbox_from_meta, _sort_lines_within_regions

if TYPE_CHECKING:
    from kraken.containers import Segmentation
    from kraken.tasks import SegmentationTaskModel


def create_segmenter():
    """Load Kraken 7's default model, or an explicit model, once per worker."""
    from kraken.tasks import SegmentationTaskModel

    return SegmentationTaskModel.load_model(os.getenv("MIMIR_SEGMENTER_MODEL") or None)


def _ordered_segmentation(seg: Segmentation, strict: bool) -> Segmentation:
    """Choose one line order before extracting crops; retain Kraken line objects."""
    if not seg.lines:
        return seg

    if strict:
        # Reuse the existing geometry heuristic without feeding dictionaries to
        # Kraken 7's extractor or discarding dataclass metadata.
        by_id = {line.id: line for line in seg.lines}
        lines = [by_id[line["id"]] for line in _sort_lines_within_regions(asdict(seg))]
    elif seg.line_orders:
        # The task API appends learned reading orders without reordering lines.
        # Prefer the latest order produced by the loaded model collection.
        order = seg.line_orders[-1]
        if sorted(order) != list(range(len(seg.lines))):
            raise ValueError("Kraken reading order must contain every line exactly once")
        lines = [seg.lines[index] for index in order]
    else:
        return seg

    # Alternative indices refer to the original list and are now obsolete.
    return replace(seg, lines=lines, line_orders=[])


def segment(page: Page, config: ProjectConfig, model: SegmentationTaskModel) -> Page:
    """Segment a page with the worker-owned BLLA model and save its line crops."""
    # Keep heavyweight OCR/segmentation dependencies lazy so helper-only imports
    # in lightweight test and docs environments do not require PIL/Kraken.
    from PIL import Image, ImageOps
    from kraken.configs import SegmentationInferenceConfig
    from kraken.containers import Segmentation
    from kraken.ketos.util import to_ptl_device
    from kraken.lib.segmentation import extract_polygons

    with Image.open(page.image_path) as source:
        image = source.copy()

    # Kraken 7 uses Lightning accelerator/device settings, not a torch device
    # string. Its CLI helper also handles MPS and indexed CUDA devices.
    device = "cuda:0" if config.device == "cuda" else config.device
    accelerator, devices = to_ptl_device(device)
    inference = SegmentationInferenceConfig(
        accelerator=accelerator,
        device=devices,
        num_threads=int(os.getenv("MIMIR_SEGMENTATION_THREADS", "1")),
        raise_on_error=config.segmentation.seg_raises_error,
    )
    seg = model.predict(im=image, config=inference)
    if not isinstance(seg, Segmentation):
        raise TypeError(f"Kraken 7 must return Segmentation, got: {type(seg).__name__}")
    seg = _ordered_segmentation(seg, config.segmentation.strict_top_to_bottom)

    # Convert to grayscale and invert strictly for Kraken's extraction mapping requirements
    inv_img = ImageOps.invert(image.convert("L"))
    polygons = extract_polygons(inv_img, seg)

    lines_dir = os.path.join(config.temp_dir, "lines", page.id)
    os.makedirs(lines_dir, exist_ok=True)

    # Preserve the line-level input preprocessing used by the Calamari model.
    threshold = config.ingestion.binarization_threshold
    page.lines = _save_and_binarize_segmented_lines(polygons, page.id, lines_dir, threshold)

    page.metadata["segmentation"] = {
        "line_count": len(page.lines),
        "lines_dir": lines_dir,
    }
    return page


def _save_and_binarize_segmented_lines(polygons: Iterable[Any], page_id: str, lines_dir: str, threshold: int) -> list[Line]:
    from PIL import ImageOps

    lines: list[Line] = []
    for idx, (line_img, meta) in enumerate(polygons, start=1):
        filename = f"{idx:06d}.png"
        line_path = os.path.join(lines_dir, filename)

        # Re-invert to recover normal polarity (black text on white background)
        line_img = ImageOps.invert(line_img.convert("L"))

        # LINE-LEVEL BINARIZATION HAPPENS HERE
        # This keeps the Fraktur text sharp, isolated from global page noise!
        binary_line = line_img.point(lambda p: 255 if p > threshold else 0, mode="1")
        binary_line.save(line_path)

        baseline_info = asdict(meta)
        baseline_info["source_order"] = idx

        bbox = _bbox_from_meta(meta)
        if bbox is None:
            # Fallback keeps pipeline robust when upstream metadata omits geometry.
            bbox = {
                "x_min": 0,
                "y_min": 0,
                "x_max": int(line_img.width),
                "y_max": int(line_img.height),
            }

        lines.append(
            Line(
                id=f"{page_id}_line_{idx}",
                bbox=bbox,
                image_path=line_path,
                baseline_info=baseline_info,
            )
        )
    return lines
