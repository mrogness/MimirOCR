"""Load Kraken segmentation and write binarized line crops."""
import os
from typing import Any, Iterable

from backend.domain.line import Line
from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers.segmenter.reading_order import _bbox_from_meta, _sort_lines_within_regions

def create_segmenter():
    """Load the same Kraken 4.3 default model once per worker."""
    from pathlib import Path
    import kraken
    from kraken.lib.vgsl import TorchVGSLModel

    return TorchVGSLModel.load_model(str(Path(kraken.__file__).parent / "blla.mlmodel"))


def segment(page: Page, config: ProjectConfig, model: object) -> Page:
    """Segment a page with the worker-owned BLLA model and save its line crops."""
    # Keep heavyweight OCR/segmentation dependencies lazy so helper-only imports
    # in lightweight test and docs environments do not require PIL/Kraken.
    from PIL import Image, ImageOps
    from kraken.blla import segment as segment_blla
    from kraken.lib.segmentation import extract_polygons

    with Image.open(page.image_path) as source:
        image = source.copy()

    seg_payload = segment_blla(
        image,
        model=model,
        device=config.device,
        mask=None,
        raise_on_error=config.segmentation.seg_raises_error,
    )

    if not isinstance(seg_payload, dict):
        raise TypeError(f"Kraken 4.3 segmentation payload must be dict, got: {type(seg_payload).__name__}")
    seg: dict[str, Any] = seg_payload
    lines_payload = seg.get("lines")
    if not isinstance(lines_payload, list):
        lines_payload = []

    # 4. Sort columns cleanly if requested
    if config.segmentation.strict_top_to_bottom and lines_payload:
        seg["lines"] = _sort_lines_within_regions(seg)

    # Convert to grayscale and invert strictly for Kraken's extraction mapping requirements
    inv_img = ImageOps.invert(image.convert("L"))
    polygons = extract_polygons(inv_img, seg)

    lines_dir = os.path.join(config.temp_dir, "lines", page.id)
    os.makedirs(lines_dir, exist_ok=True)

    # 5. Save lines and apply your line-level binarizer here!
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

        baseline_info = meta if isinstance(meta, dict) else {}
        baseline_info = dict(baseline_info)
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
