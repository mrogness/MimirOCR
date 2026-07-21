from __future__ import annotations

import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from statistics import median
from typing import Iterable, List, Optional, Tuple
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.api import crud
from backend.api.deps import get_db
from backend.api.schemas import ExportPdfRequest

try:
    from reportlab.lib.pagesizes import A4, LETTER
    from reportlab.pdfgen import canvas
except ImportError as exc:  # pragma: no cover - runtime dependency guard
    canvas = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None

router = APIRouter(prefix="/export", tags=["export"])

PAGE_SIZES = {
    "letter": LETTER,
    "a4": A4,
}


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower())
    text = text.strip("-")
    return text or "project"


def _clean_basename(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "_", (value or "").strip())
    text = text.strip("_")
    return text or "line"


def _pdf_export_filename(project_name: str) -> str:
    base = re.sub(r"\s+", "_", (project_name or "").strip())
    base = re.sub(r"[^a-zA-Z0-9_-]+", "", base)
    base = base.strip("_")
    return f"{base or 'project'}.pdf"


def _line_training_text(line) -> str:
    corrected = getattr(line, "corrected_text", None)
    predicted = getattr(line, "ocr_text", None)
    value = corrected if corrected not in (None, "") else predicted
    return "" if value is None else str(value)


@dataclass
class LineLayout:
    text: str
    x_min: float
    y_min: float
    y_max: float


@dataclass
class RenderLine:
    text: str
    indent_pt: float
    is_blank: bool = False


def _line_text(
    raw_text: Optional[str],
    normalize_low_double_quote: bool,
    normalize_long_s: bool,
    normalize_double_oblique_hyphen: bool,
) -> str:
    text = (raw_text or "").strip()
    if normalize_low_double_quote:
        text = text.replace("\u201e", '"')

    if normalize_long_s:
        text = text.replace("ſ", "s")
        text = text.replace("ẛ", "s")

    if normalize_double_oblique_hyphen:
        # OCR can emit several historical oblique/two-em/three-em dash codepoints.
        text = re.sub(r"[⸗⸺⸻]", "-", text)

    return _sanitize_for_builtin_pdf_fonts(text)


def _sanitize_for_builtin_pdf_fonts(text: str) -> str:
    replacement_map = {
        "\u00A0": " ",
        "\u2018": "'",
        "\u2019": "'",
        "\u201A": "'",
        "\u201B": "'",
        "\u201C": '"',
        "\u201D": '"',
        "\u201F": '"',
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\u2212": "-",
        "\u2044": "/",
        "\uFB00": "ff",
        "\uFB01": "fi",
        "\uFB02": "fl",
        "\uFB03": "ffi",
        "\uFB04": "ffl",
    }

    normalized = "".join(replacement_map.get(ch, ch) for ch in text)
    # Built-in reportlab fonts are not full Unicode; this prevents black-box glyphs.
    return normalized.encode("latin-1", errors="replace").decode("latin-1")


def _extract_bbox(raw_bbox: Optional[str]) -> Optional[Tuple[float, float, float, float]]:
    if not raw_bbox:
        return None

    try:
        bbox = json.loads(raw_bbox)
    except json.JSONDecodeError:
        return None

    if not isinstance(bbox, dict):
        return None

    x_min = bbox.get("x_min")
    y_min = bbox.get("y_min")
    x_max = bbox.get("x_max")
    y_max = bbox.get("y_max")

    if not all(isinstance(v, (int, float)) for v in (x_min, y_min, x_max, y_max)):
        return None

    return float(x_min), float(y_min), float(x_max), float(y_max)


def _word_wrap(text: str, max_width_pt: float, font_size: float) -> List[str]:
    if not text:
        return [""]

    # Average glyph width estimate across the built-in PDF fonts.
    avg_char_width = max(4.5, font_size * 0.22)
    max_chars = max(8, int(max_width_pt / avg_char_width))

    if len(text) <= max_chars:
        return [text]

    words = re.split(r"(\s+)", text)
    lines: List[str] = []
    current = ""
    for token in words:
        candidate = f"{current}{token}"
        if len(candidate) <= max_chars or not current:
            current = candidate
            continue

        lines.append(current.rstrip())
        current = token.lstrip()

    if current:
        lines.append(current.rstrip())

    return lines if lines else [text]


def _to_layout_lines(
    db_lines: Iterable,
    normalize_low_double_quote: bool,
    normalize_long_s: bool,
    normalize_double_oblique_hyphen: bool,
) -> List[LineLayout]:
    prepared: List[LineLayout] = []

    for line in db_lines:
        text = _line_text(
            getattr(line, "corrected_text", None) or getattr(line, "ocr_text", None),
            normalize_low_double_quote,
            normalize_long_s,
            normalize_double_oblique_hyphen,
        )
        bbox = _extract_bbox(getattr(line, "bounding_box", None))
        if not text or not bbox:
            continue

        x_min, y_min, _x_max, y_max = bbox
        prepared.append(LineLayout(text=text, x_min=x_min, y_min=y_min, y_max=y_max))

    return prepared


def _split_spread(lines: List[LineLayout], page_width: Optional[int]) -> Tuple[List[LineLayout], List[LineLayout], float]:
    if not lines:
        return [], [], 1.0

    if isinstance(page_width, int) and page_width > 0:
        midpoint = page_width / 2.0
    else:
        x_values = [line.x_min for line in lines]
        midpoint = (min(x_values) + max(x_values)) / 2.0

    left: List[LineLayout] = []
    right: List[LineLayout] = []

    for line in lines:
        if line.x_min < midpoint:
            left.append(line)
        else:
            right.append(line)

    left.sort(key=lambda l: (l.y_min, l.x_min))
    right.sort(key=lambda l: (l.y_min, l.x_min))
    return left, right, midpoint


def _render_lines_for_region(
    lines: List[LineLayout],
    *,
    region_start_x: float,
    region_width_px: float,
    content_width_pt: float,
    font_size: float,
) -> List[RenderLine]:
    if not lines:
        return []

    left_anchor = min(line.x_min for line in lines)
    line_heights = [max(1.0, line.y_max - line.y_min) for line in lines]
    typical_line_height = median(line_heights) if line_heights else 14.0
    pt_per_px = content_width_pt / max(1.0, region_width_px)

    rendered: List[RenderLine] = []
    prev_bottom: Optional[float] = None

    for line in lines:
        if prev_bottom is not None:
            gap = line.y_min - prev_bottom
            if gap > typical_line_height * 1.5:
                rendered.append(RenderLine(text="", indent_pt=0, is_blank=True))

        indent_px = max(0.0, line.x_min - max(left_anchor, region_start_x))
        indent_pt = indent_px * pt_per_px
        max_width_pt = max(50.0, content_width_pt - indent_pt)

        wrapped = _word_wrap(line.text, max_width_pt=max_width_pt, font_size=font_size)
        for segment in wrapped:
            rendered.append(RenderLine(text=segment, indent_pt=indent_pt, is_blank=False))

        prev_bottom = line.y_max

    return rendered


def _build_virtual_pages(db_page, request: ExportPdfRequest, content_width_pt: float) -> List[List[RenderLine]]:
    ordered = sorted(db_page.lines, key=lambda line: ((line.line_order or 10**9), line.id))
    lines = _to_layout_lines(
        ordered,
        normalize_low_double_quote=request.normalize_low_double_quote,
        normalize_long_s=request.normalize_long_s,
        normalize_double_oblique_hyphen=request.normalize_double_oblique_hyphen,
    )
    if not lines:
        return [[]]

    width_px = float(db_page.width or 1)

    if request.spread_mode == "single":
        single = sorted(lines, key=lambda l: (l.y_min, l.x_min))
        return [
            _render_lines_for_region(
                single,
                region_start_x=0.0,
                region_width_px=width_px,
                content_width_pt=content_width_pt,
                font_size=request.font_size,
            )
        ]

    left_lines, right_lines, midpoint = _split_spread(lines, db_page.width)
    half_width = max(1.0, width_px / 2.0)

    left_render = _render_lines_for_region(
        left_lines,
        region_start_x=0.0,
        region_width_px=half_width,
        content_width_pt=content_width_pt,
        font_size=request.font_size,
    )
    right_render = _render_lines_for_region(
        right_lines,
        region_start_x=midpoint,
        region_width_px=half_width,
        content_width_pt=content_width_pt,
        font_size=request.font_size,
    )

    # Preserve book page sequencing even when a side has no text.
    return [left_render, right_render]


def _fit_lines_for_page(
    lines: List[RenderLine],
    *,
    content_width_pt: float,
    content_height_pt: float,
    base_font_size: float,
    line_spacing: float,
    fit_to_page: bool,
) -> Tuple[List[RenderLine], float, float]:
    if not lines:
        return [], base_font_size, base_font_size * line_spacing

    def _effective(font_size: float) -> Tuple[List[RenderLine], float]:
        adjusted: List[RenderLine] = []
        for line in lines:
            if line.is_blank:
                adjusted.append(line)
                continue
            max_width = max(70.0, content_width_pt - line.indent_pt)
            wrapped = _word_wrap(line.text, max_width_pt=max_width, font_size=font_size)
            for segment in wrapped:
                adjusted.append(RenderLine(text=segment, indent_pt=line.indent_pt, is_blank=False))

        line_height = font_size * line_spacing
        return adjusted, len(adjusted) * line_height

    prepared, required_height = _effective(base_font_size)
    if required_height <= content_height_pt or not fit_to_page:
        return prepared, base_font_size, base_font_size * line_spacing

    scale = max(0.55, content_height_pt / max(1.0, required_height))
    shrunk_size = max(6.0, round(base_font_size * scale, 2))
    shrunk, _ = _effective(shrunk_size)
    return shrunk, shrunk_size, shrunk_size * line_spacing


def _export_project_pdf_impl(
    project_id: int,
    request: ExportPdfRequest,
    db: Session,
) -> StreamingResponse:
    if canvas is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "PDF export dependency missing. Install reportlab in the backend environment. "
                f"Import error: {_IMPORT_ERROR}"
            ),
        )

    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    db_pages = crud.list_project_pages(db, project_id=project_id)
    if not db_pages:
        raise HTTPException(status_code=400, detail="No OCR pages available for export")

    page_size = PAGE_SIZES[request.page_size]
    page_width_pt, page_height_pt = page_size
    margin = request.margin_in * 72.0
    content_width = max(120.0, page_width_pt - (margin * 2.0))
    content_height = max(120.0, page_height_pt - (margin * 2.0))

    pdf_buffer = BytesIO()
    pdf = canvas.Canvas(pdf_buffer, pagesize=page_size)

    for db_page in db_pages:
        virtual_pages = _build_virtual_pages(db_page, request, content_width)

        for virtual in virtual_pages:
            laid_out, font_size, leading = _fit_lines_for_page(
                virtual,
                content_width_pt=content_width,
                content_height_pt=content_height,
                base_font_size=request.font_size,
                line_spacing=request.line_spacing,
                fit_to_page=request.fit_text_to_page,
            )

            pdf.setFont(request.font_family, font_size)
            cursor_y = page_height_pt - margin

            for line in laid_out:
                cursor_y -= leading
                if cursor_y < margin:
                    break

                if line.is_blank:
                    continue

                pdf.drawString(margin + line.indent_pt, cursor_y, line.text)

            pdf.showPage()

    pdf.save()
    pdf_buffer.seek(0)

    filename = _pdf_export_filename(project.name)
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/projects/{project_id}/pdf")
def export_project_pdf_post(
    project_id: int,
    request: ExportPdfRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return _export_project_pdf_impl(project_id=project_id, request=request, db=db)


@router.get("/projects/{project_id}/pdf")
def export_project_pdf_get(
    project_id: int,
    request: ExportPdfRequest = Depends(),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return _export_project_pdf_impl(project_id=project_id, request=request, db=db)


@router.get("/projects/{project_id}/training-data")
def export_project_training_data(project_id: int, db: Session = Depends(get_db)) -> StreamingResponse:
    project = crud.get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    db_pages = crud.list_project_pages(db, project_id=project_id)
    if not db_pages:
        raise HTTPException(status_code=400, detail="No OCR pages available for training data export")

    archive_buffer = BytesIO()
    exported_pairs = 0
    project_slug = _slugify(project.name)
    root_dir = f"project_{project_id}_{project_slug}"

    with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for page in db_pages:
            ordered_lines = sorted(page.lines, key=lambda line: ((line.line_order or 10**9), line.id))
            for index, line in enumerate(ordered_lines, start=1):
                image_path_raw = getattr(line, "img_path", None)
                if not image_path_raw:
                    continue

                image_path = Path(image_path_raw)
                if not image_path.exists() or not image_path.is_file():
                    continue

                line_order = line.line_order if isinstance(line.line_order, int) and line.line_order > 0 else index
                line_id_part = _clean_basename(str(getattr(line, "id", "line")))
                base_name = (
                    f"proj{project_id:04d}_"
                    f"p{page.page_number + 1:04d}_"
                    f"l{line_order:04d}_"
                    f"{line_id_part}"
                )

                image_arcname = f"{root_dir}/{base_name}.png"
                text_arcname = f"{root_dir}/{base_name}.gt.txt"

                archive.write(image_path, arcname=image_arcname)
                archive.writestr(text_arcname, _line_training_text(line).encode("utf-8"))
                exported_pairs += 1

    if exported_pairs == 0:
        raise HTTPException(status_code=400, detail="No line image/text pairs available for training data export")

    archive_buffer.seek(0)
    filename = f"project_{project_id}_{project_slug}_training_data.zip"
    return StreamingResponse(
        archive_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
