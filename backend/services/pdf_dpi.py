from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from math import ceil, hypot, isfinite
from statistics import median
from typing import Any

import fitz

from backend.api.schemas import PdfDpiAnalysisResponse

_DEFAULT_RECOMMENDED_DPI = 300
_MIN_DOMINANT_IMAGE_COVERAGE = 0.50
_MAX_REPEATED_DECORATION_COVERAGE = 0.25
_MIN_PLAUSIBLE_DPI = 36.0
_MAX_PLAUSIBLE_DPI = 2400.0


class PdfDpiAnalysisError(ValueError):
    """Raised when an uploaded file cannot be analyzed as a PDF."""


@dataclass(frozen=True)
class _ImageCandidate:
    page_number: int
    digest: bytes | None
    coverage: float
    dpi_x: float
    dpi_y: float

    @property
    def effective_dpi(self) -> float:
        return min(self.dpi_x, self.dpi_y)


def analyze_pdf_dpi(pdf_bytes: bytes, filename: str) -> PdfDpiAnalysisResponse:
    """Estimate source scan DPI without rasterizing or persisting the PDF."""
    if not pdf_bytes:
        raise PdfDpiAnalysisError("The uploaded PDF is empty.")

    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as error:
        raise PdfDpiAnalysisError("Unable to open the uploaded file as a PDF.") from error

    try:
        if document.needs_pass:
            raise PdfDpiAnalysisError("Password-protected PDFs cannot be analyzed.")
        if document.page_count < 1:
            raise PdfDpiAnalysisError("The uploaded PDF does not contain any pages.")

        candidates_by_page: dict[int, list[_ImageCandidate]] = defaultdict(list)
        digest_pages: dict[bytes, set[int]] = defaultdict(set)
        pages_analyzed = 0
        page_analysis_errors = 0

        for page_index in range(document.page_count):
            try:
                page = document.load_page(page_index)
                page_candidates = _page_image_candidates(page, page_index + 1)
            except Exception:
                page_analysis_errors += 1
                continue

            pages_analyzed += 1
            candidates_by_page[page_index + 1].extend(page_candidates)
            for candidate in page_candidates:
                if candidate.digest is not None:
                    digest_pages[candidate.digest].add(candidate.page_number)

        repeated_page_threshold = max(2, ceil(document.page_count * 0.50))
        repeated_small_digests = {
            digest
            for digest, pages in digest_pages.items()
            if len(pages) >= repeated_page_threshold
        }

        ignored_probable_watermark_images = 0
        page_dpi_estimates: list[float] = []

        for page_number in range(1, document.page_count + 1):
            usable_candidates: list[_ImageCandidate] = []
            for candidate in candidates_by_page.get(page_number, []):
                is_probable_repeated_decoration = (
                    candidate.digest in repeated_small_digests
                    and candidate.coverage <= _MAX_REPEATED_DECORATION_COVERAGE
                )
                if is_probable_repeated_decoration:
                    ignored_probable_watermark_images += 1
                    continue
                if candidate.coverage >= _MIN_DOMINANT_IMAGE_COVERAGE:
                    usable_candidates.append(candidate)

            if not usable_candidates:
                continue

            dominant = max(usable_candidates, key=lambda candidate: candidate.coverage)
            page_dpi_estimates.append(dominant.effective_dpi)

        warnings = _analysis_warnings(
            page_count=document.page_count,
            pages_analyzed=pages_analyzed,
            page_analysis_errors=page_analysis_errors,
            page_dpi_estimates=page_dpi_estimates,
            ignored_probable_watermark_images=ignored_probable_watermark_images,
        )

        if page_dpi_estimates:
            detected_median_dpi = round(median(page_dpi_estimates))
            detected_min_dpi = round(min(page_dpi_estimates))
            detected_max_dpi = round(max(page_dpi_estimates))
            recommended_dpi = _recommended_dpi(detected_median_dpi)
            confidence = _confidence(len(page_dpi_estimates), document.page_count)
        else:
            detected_median_dpi = None
            detected_min_dpi = None
            detected_max_dpi = None
            recommended_dpi = _DEFAULT_RECOMMENDED_DPI
            confidence = "unavailable"

        return PdfDpiAnalysisResponse(
            filename=filename or "document.pdf",
            page_count=document.page_count,
            pages_analyzed=pages_analyzed,
            pages_with_scan_estimate=len(page_dpi_estimates),
            detected_median_dpi=detected_median_dpi,
            detected_min_dpi=detected_min_dpi,
            detected_max_dpi=detected_max_dpi,
            recommended_dpi=recommended_dpi,
            confidence=confidence,
            ignored_probable_watermark_images=ignored_probable_watermark_images,
            warnings=warnings,
        )
    finally:
        document.close()


def _page_image_candidates(page: fitz.Page, page_number: int) -> list[_ImageCandidate]:
    page_area = float(page.rect.width * page.rect.height)
    if page_area <= 0:
        return []

    candidates: list[_ImageCandidate] = []
    for info in page.get_image_info(hashes=True):
        candidate = _candidate_from_image_info(info, page.rect, page_area, page_number)
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def _candidate_from_image_info(
    info: dict[str, Any],
    page_rect: fitz.Rect,
    page_area: float,
    page_number: int,
) -> _ImageCandidate | None:
    try:
        pixel_width = float(info.get("width", 0))
        pixel_height = float(info.get("height", 0))
        bbox = fitz.Rect(info["bbox"])
    except (KeyError, TypeError, ValueError):
        return None

    if pixel_width <= 0 or pixel_height <= 0 or bbox.is_empty or bbox.is_infinite:
        return None

    displayed_width, displayed_height = _displayed_dimensions(info, bbox)
    if displayed_width <= 0 or displayed_height <= 0:
        return None

    dpi_x = pixel_width * 72.0 / displayed_width
    dpi_y = pixel_height * 72.0 / displayed_height
    if not _is_plausible_dpi(dpi_x) or not _is_plausible_dpi(dpi_y):
        return None

    clipped_bbox = bbox & page_rect
    coverage = max(0.0, min(1.0, float(clipped_bbox.get_area()) / page_area))
    digest_value = info.get("digest")
    digest = bytes(digest_value) if isinstance(digest_value, (bytes, bytearray)) else None

    return _ImageCandidate(
        page_number=page_number,
        digest=digest,
        coverage=coverage,
        dpi_x=dpi_x,
        dpi_y=dpi_y,
    )


def _displayed_dimensions(info: dict[str, Any], bbox: fitz.Rect) -> tuple[float, float]:
    transform = info.get("transform")
    if isinstance(transform, (tuple, list)) and len(transform) >= 4:
        try:
            a, b, c, d = (float(transform[index]) for index in range(4))
            transformed_width = hypot(a, b)
            transformed_height = hypot(c, d)
            if transformed_width > 0 and transformed_height > 0:
                return transformed_width, transformed_height
        except (TypeError, ValueError):
            pass
    return abs(float(bbox.width)), abs(float(bbox.height))


def _is_plausible_dpi(value: float) -> bool:
    return isfinite(value) and _MIN_PLAUSIBLE_DPI <= value <= _MAX_PLAUSIBLE_DPI


def _recommended_dpi(detected_median_dpi: int) -> int:
    if detected_median_dpi < 350:
        return 300
    if detected_median_dpi < 500:
        return 400
    return 600


def _confidence(pages_with_estimate: int, page_count: int) -> str:
    ratio = pages_with_estimate / page_count
    if ratio >= 0.90:
        return "high"
    if ratio >= 0.60:
        return "medium"
    return "low"


def _analysis_warnings(
    *,
    page_count: int,
    pages_analyzed: int,
    page_analysis_errors: int,
    page_dpi_estimates: list[float],
    ignored_probable_watermark_images: int,
) -> list[str]:
    warnings: list[str] = []
    if page_analysis_errors:
        warnings.append(
            f"Unable to inspect image metadata on {page_analysis_errors} of {page_count} pages."
        )
    if not page_dpi_estimates:
        warnings.append(
            "No dominant raster scan image was found; the document may be vector-based, tiled, or mixed-content."
        )
    elif len(page_dpi_estimates) < pages_analyzed:
        warnings.append(
            f"A scan DPI estimate was available for {len(page_dpi_estimates)} of {pages_analyzed} analyzed pages."
        )
    if ignored_probable_watermark_images:
        warnings.append(
            f"Ignored {ignored_probable_watermark_images} small repeated image occurrences that may be watermarks or logos."
        )
    if page_dpi_estimates and max(page_dpi_estimates) / min(page_dpi_estimates) >= 1.50:
        warnings.append("Estimated scan resolution varies substantially between pages.")
    if page_dpi_estimates and median(page_dpi_estimates) < 225:
        warnings.append("The source scan appears to be low resolution; increasing processing DPI cannot restore missing detail.")
    return warnings
