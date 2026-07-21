import json
import os
from datetime import datetime

from backend.models.page import Page
from backend.models.project import Project
from backend.models.project_config import ProjectConfig


def export(project: Project, config: ProjectConfig) -> Project:
    """Finalize project outputs after all page-level stages have completed."""
    output_root = os.path.join(config.output_dir, project.id)
    pages_dir = os.path.join(output_root, "pages")
    os.makedirs(pages_dir, exist_ok=True)

    ordered_pages = sorted(project.pages, key=lambda p: p.page_number)

    for page in ordered_pages:
        page_file = os.path.join(pages_dir, f"{page.page_number + 1:04d}.txt")
        with open(page_file, "w", encoding="utf-8") as f:
            f.write(_page_text(page))

    transcript_path = os.path.join(output_root, "transcript.txt")
    with open(transcript_path, "w", encoding="utf-8") as f:
        f.write("\n\n".join(_page_text(page) for page in ordered_pages))

    payload = {
        "project": {
            "id": project.id,
            "name": project.name,
            "source_path": project.source_path,
            "exported_at": datetime.utcnow().isoformat() + "Z",
            "page_count": len(ordered_pages),
        },
        "pages": [_page_payload(page) for page in ordered_pages],
    }

    json_path = os.path.join(output_root, "project.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return project


def _page_text(page: Page) -> str:
    lines = _ordered_lines(page)
    return "\n".join(line.correct_text or line.ocr_text or "" for line in lines)


def _ordered_lines(page: Page):
    def _source_order(line):
        meta = line.baseline_info if isinstance(line.baseline_info, dict) else {}
        order = meta.get("source_order")
        return order if isinstance(order, int) else 10**9

    return sorted(page.lines, key=lambda l: (_source_order(l), l.bbox['y_min'], l.bbox['x_min']))


def _page_payload(page: Page) -> dict:
    return {
        "id": page.id,
        "page_number": page.page_number,
        "image_path": page.image_path,
        "width": page.width,
        "height": page.height,
        "confidence": page.confidence,
        "text": _page_text(page),
        "lines": [_line_payload(line) for line in _ordered_lines(page)],
    }


def _line_payload(line) -> dict:
    return {
        "id": line.id,
        "bbox": [line.bbox['x_min'], line.bbox['y_min'], line.bbox['x_max'], line.bbox['y_max']],
        "image_path": line.image_path,
        "ocr_text": line.ocr_text,
        "correct_text": line.correct_text,
        "confidence": line.confidence,
    }
