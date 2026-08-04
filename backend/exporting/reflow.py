from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum, auto
from statistics import median
from typing import Iterable, Sequence

HISTORICAL_JOIN_MARK_RE = re.compile(r"\s*[⸗⸺⸻]\s*$")
HISTORICAL_HYPHEN_RE = re.compile(r"[⸗⸺⸻]")

LARGE_GAP_MULTIPLIER = 1.7
SHORT_LINE_FILL_RATIO = 0.80
INDENT_HEIGHT_MULTIPLIER = 0.4

MIN_INDENT_PX = 5.0
MAX_INDENT_RATIO = 0.15
MIN_REGION_WIDTH = 1.0
DEFAULT_MEDIAN_HEIGHT = 14.0
DEFAULT_MEDIAN_GAP = 8.0
MAX_SPACE_BEFORE_LINES = 3.0
BLOCK_SPACE_BEFORE_LINES = 1.0

TERMINAL_PUNCTUATION = (".", "!", "?", ":", ";", "\u201d", '"', "\u2019", "'")


@dataclass(frozen=True)
class SourceLine:
    line_id: int
    text: str
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    source_page_number: int
    source_region_index: int
    source_order: int

    @property
    def width(self) -> float:
        return max(0.0, self.x_max - self.x_min)

    @property
    def height(self) -> float:
        return max(0.0, self.y_max - self.y_min)


@dataclass(frozen=True)
class RegionStats:
    left_edge: float
    right_edge: float
    median_line_height: float
    median_vertical_gap: float
    indent_threshold: float


class BoundaryKind(Enum):
    JOIN_WITH_SPACE = auto()
    JOIN_WITHOUT_SPACE = auto()
    PARAGRAPH = auto()
    BLOCK = auto()


@dataclass(frozen=True)
class SourceRegion:
    source_page_number: int
    source_region_index: int
    lines: list[SourceLine]
    stats: RegionStats


@dataclass
class ReflowParagraph:
    text: str
    source_line_ids: list[int]
    source_page_numbers: list[int]
    first_line_indent_ratio: float = 0.0
    left_indent_ratio: float = 0.0
    space_before_lines: float = 0.0


@dataclass(frozen=True)
class BoundaryDecision:
    kind: BoundaryKind
    vertical_gap: float


def normalize_for_reflow(
    raw_text: str | None,
    *,
    normalize_low_double_quote: bool,
    normalize_long_s: bool,
) -> str:
    text = (raw_text or "").strip()
    if normalize_low_double_quote:
        text = text.replace("\u201e", '"')
    if normalize_long_s:
        text = text.replace("ſ", "s").replace("ẛ", "s")
    return text


def normalize_remaining_historical_hyphens(text: str, *, enabled: bool) -> str:
    if not enabled:
        return text
    return HISTORICAL_HYPHEN_RE.sub("-", text)


def has_trailing_historical_join_mark(text: str) -> bool:
    return HISTORICAL_JOIN_MARK_RE.search(text or "") is not None


def strip_trailing_historical_join_mark(text: str) -> str:
    return HISTORICAL_JOIN_MARK_RE.sub("", text or "")


def build_source_regions(
    db_pages: Iterable,
    *,
    spread_mode: str,
    normalize_low_double_quote: bool,
    normalize_long_s: bool,
) -> list[SourceRegion]:
    """Create ordered source regions from OCR lines.

    This preserves source sequencing and spread-side ordering while keeping geometry
    rich enough (x/y min/max) for paragraph reflow heuristics.
    """
    regions: list[SourceRegion] = []

    for db_page in db_pages:
        ordered_lines = sorted(db_page.lines, key=lambda line: ((line.line_order or 10**9), line.id))
        source_lines: list[SourceLine] = []

        for fallback_order, db_line in enumerate(ordered_lines, start=1):
            text = normalize_for_reflow(
                getattr(db_line, "corrected_text", None) or getattr(db_line, "ocr_text", None),
                normalize_low_double_quote=normalize_low_double_quote,
                normalize_long_s=normalize_long_s,
            )
            if not text:
                continue

            bbox = _extract_bbox(getattr(db_line, "bounding_box", None))
            if bbox is None:
                continue

            x_min, y_min, x_max, y_max = bbox
            if x_max <= x_min or y_max <= y_min:
                continue

            source_lines.append(
                SourceLine(
                    line_id=int(getattr(db_line, "id")),
                    text=text,
                    x_min=x_min,
                    y_min=y_min,
                    x_max=x_max,
                    y_max=y_max,
                    source_page_number=int(getattr(db_page, "page_number", 0)),
                    source_region_index=0,
                    source_order=(db_line.line_order if isinstance(db_line.line_order, int) else 10**9) + fallback_order,
                )
            )

        if not source_lines:
            continue

        if spread_mode == "single":
            sorted_lines = sorted(source_lines, key=_line_sort_key)
            regions.append(
                SourceRegion(
                    source_page_number=int(getattr(db_page, "page_number", 0)),
                    source_region_index=0,
                    lines=sorted_lines,
                    stats=compute_region_stats(sorted_lines),
                )
            )
            continue

        left_lines, right_lines = _split_spread_lines(source_lines, getattr(db_page, "width", None))
        if left_lines:
            regions.append(
                SourceRegion(
                    source_page_number=int(getattr(db_page, "page_number", 0)),
                    source_region_index=0,
                    lines=left_lines,
                    stats=compute_region_stats(left_lines),
                )
            )
        if right_lines:
            regions.append(
                SourceRegion(
                    source_page_number=int(getattr(db_page, "page_number", 0)),
                    source_region_index=1,
                    lines=right_lines,
                    stats=compute_region_stats(right_lines),
                )
            )

    return regions


def compute_region_stats(lines: Sequence[SourceLine]) -> RegionStats:
    if not lines:
        return RegionStats(
            left_edge=0.0,
            right_edge=MIN_REGION_WIDTH,
            median_line_height=DEFAULT_MEDIAN_HEIGHT,
            median_vertical_gap=DEFAULT_MEDIAN_GAP,
            indent_threshold=MIN_INDENT_PX,
        )

    x_mins = [line.x_min for line in lines]
    x_maxs = [line.x_max for line in lines]
    line_heights = [line.height for line in lines if line.height > 0]
    line_widths = [line.width for line in lines if line.width > 0]

    left_candidates = _trim_outliers(x_mins, lower=0.10, upper=0.90)
    left_edge = _safe_median(left_candidates, fallback=_safe_median(x_mins, fallback=0.0))

    median_width = _safe_median(line_widths, fallback=0.0)
    fill_candidates = [line.x_max for line in lines if line.width >= max(1.0, median_width * 0.60)]
    if not fill_candidates:
        fill_candidates = list(x_maxs)
    upper_cutoff = _quantile(fill_candidates, 0.60)
    right_candidates = [value for value in fill_candidates if value >= upper_cutoff]
    right_edge = _safe_median(right_candidates, fallback=_safe_median(fill_candidates, fallback=left_edge + MIN_REGION_WIDTH))

    if right_edge <= left_edge:
        right_edge = left_edge + max(MIN_REGION_WIDTH, _safe_median(line_widths, fallback=MIN_REGION_WIDTH))

    median_height = _safe_median(line_heights, fallback=DEFAULT_MEDIAN_HEIGHT)

    sorted_lines = sorted(lines, key=lambda line: (line.y_min, line.x_min, line.source_order, line.line_id))
    gaps = [max(0.0, current.y_min - previous.y_max) for previous, current in zip(sorted_lines, sorted_lines[1:])]
    positive_gaps = [gap for gap in gaps if gap > 0]
    typical_gap_cap = max(DEFAULT_MEDIAN_GAP, median_height * 1.8)
    typical_gaps = [gap for gap in positive_gaps if gap <= typical_gap_cap]
    if typical_gaps:
        median_gap = _safe_median(typical_gaps, fallback=max(DEFAULT_MEDIAN_GAP, median_height * 0.6))
    else:
        median_gap = max(DEFAULT_MEDIAN_GAP, median_height * 0.6)

    indent_threshold = max(MIN_INDENT_PX, median_height * INDENT_HEIGHT_MULTIPLIER)

    return RegionStats(
        left_edge=left_edge,
        right_edge=right_edge,
        median_line_height=median_height,
        median_vertical_gap=median_gap,
        indent_threshold=indent_threshold,
    )


def classify_boundary(
    previous: SourceLine,
    current: SourceLine,
    *,
    previous_stats: RegionStats,
    join_historical_line_breaks: bool,
) -> BoundaryDecision:
    same_region = (
        previous.source_page_number == current.source_page_number
        and previous.source_region_index == current.source_region_index
    )

    vertical_gap = max(0.0, current.y_min - previous.y_max)

    if not same_region:
        if join_historical_line_breaks and has_trailing_historical_join_mark(previous.text):
            return BoundaryDecision(kind=BoundaryKind.JOIN_WITHOUT_SPACE, vertical_gap=vertical_gap)
        return BoundaryDecision(kind=BoundaryKind.BLOCK, vertical_gap=vertical_gap)

    large_gap_threshold = max(
        previous_stats.median_line_height,
        previous_stats.median_vertical_gap * LARGE_GAP_MULTIPLIER,
    )
    if vertical_gap > large_gap_threshold:
        return BoundaryDecision(kind=BoundaryKind.PARAGRAPH, vertical_gap=vertical_gap)

    if join_historical_line_breaks and has_trailing_historical_join_mark(previous.text):
        return BoundaryDecision(kind=BoundaryKind.JOIN_WITHOUT_SPACE, vertical_gap=vertical_gap)

    region_width = max(MIN_REGION_WIDTH, previous_stats.right_edge - previous_stats.left_edge)
    current_indent = current.x_min - previous_stats.left_edge
    previous_fill_ratio = _clamp((previous.x_max - previous_stats.left_edge) / region_width, 0.0, 2.0)

    noticeable_indent = current_indent > max(
        previous_stats.indent_threshold,
        previous_stats.median_line_height * INDENT_HEIGHT_MULTIPLIER,
    )
    previous_short = previous_fill_ratio < SHORT_LINE_FILL_RATIO
    previous_terminal = ends_with_terminal_punctuation(previous.text)

    if noticeable_indent and (previous_short or previous_terminal):
        return BoundaryDecision(kind=BoundaryKind.PARAGRAPH, vertical_gap=vertical_gap)

    return BoundaryDecision(kind=BoundaryKind.JOIN_WITH_SPACE, vertical_gap=vertical_gap)


def infer_reflow_paragraphs(
    regions: Sequence[SourceRegion],
    *,
    join_historical_line_breaks: bool,
    normalize_double_oblique_hyphen: bool,
) -> list[ReflowParagraph]:
    """Infer reading paragraphs from source OCR lines.

    This is a geometry-driven heuristic pass that combines adjacent lines into
    paragraph text while preserving approximate paragraph indentation.
    """
    if not regions:
        return []

    entries: list[tuple[SourceLine, RegionStats]] = []
    for region in regions:
        for line in region.lines:
            entries.append((line, region.stats))

    if not entries:
        return []

    paragraphs: list[ReflowParagraph] = []
    current_text = entries[0][0].text
    current_lines: list[SourceLine] = [entries[0][0]]
    current_space_before = 0.0

    def finalize_paragraph(text: str, source_lines: Sequence[SourceLine], space_before_lines: float) -> None:
        normalized_text = normalize_remaining_historical_hyphens(text.strip(), enabled=normalize_double_oblique_hyphen)
        if not normalized_text:
            return

        first_indent, left_indent = infer_paragraph_indentation(source_lines)
        paragraphs.append(
            ReflowParagraph(
                text=normalized_text,
                source_line_ids=[line.line_id for line in source_lines],
                source_page_numbers=sorted({line.source_page_number for line in source_lines}),
                first_line_indent_ratio=first_indent,
                left_indent_ratio=left_indent,
                space_before_lines=max(0.0, space_before_lines),
            )
        )

    for (previous_line, previous_stats), (current_line, _current_stats) in zip(entries, entries[1:]):
        decision = classify_boundary(
            previous_line,
            current_line,
            previous_stats=previous_stats,
            join_historical_line_breaks=join_historical_line_breaks,
        )

        if decision.kind == BoundaryKind.JOIN_WITHOUT_SPACE:
            current_text = strip_trailing_historical_join_mark(current_text)
            current_text = f"{current_text}{current_line.text.lstrip()}"
            current_lines.append(current_line)
            continue

        if decision.kind == BoundaryKind.JOIN_WITH_SPACE:
            current_text = current_text.rstrip()
            next_text = current_line.text.strip()
            if current_text and next_text:
                current_text = f"{current_text} {next_text}"
            elif next_text:
                current_text = next_text
            current_lines.append(current_line)
            continue

        finalize_paragraph(current_text, current_lines, current_space_before)
        current_space_before = _space_before_for_boundary(decision, previous_stats)
        current_text = current_line.text
        current_lines = [current_line]

    finalize_paragraph(current_text, current_lines, current_space_before)
    return paragraphs


def infer_paragraph_indentation(lines: Sequence[SourceLine]) -> tuple[float, float]:
    if len(lines) < 2:
        return (0.0, 0.0)

    stats = compute_region_stats(lines)
    later_starts = [line.x_min for line in lines[1:]]
    if not later_starts:
        return (0.0, 0.0)

    later_typical_x = _safe_median(later_starts, fallback=lines[0].x_min)
    delta = lines[0].x_min - later_typical_x
    if abs(delta) <= stats.indent_threshold:
        return (0.0, 0.0)

    region_width = max(MIN_REGION_WIDTH, stats.right_edge - stats.left_edge)
    indent_ratio = min(MAX_INDENT_RATIO, abs(delta) / region_width)
    if delta > 0:
        return (indent_ratio, 0.0)
    return (0.0, indent_ratio)


def _extract_bbox(raw_bbox: str | None) -> tuple[float, float, float, float] | None:
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
    if not all(isinstance(value, (int, float)) for value in (x_min, y_min, x_max, y_max)):
        return None

    return (float(x_min), float(y_min), float(x_max), float(y_max))


def _split_spread_lines(lines: Sequence[SourceLine], page_width: int | None) -> tuple[list[SourceLine], list[SourceLine]]:
    if not lines:
        return ([], [])

    if isinstance(page_width, int) and page_width > 0:
        midpoint = page_width / 2.0
    else:
        x_values = [line.x_min for line in lines]
        midpoint = (min(x_values) + max(x_values)) / 2.0

    left: list[SourceLine] = []
    right: list[SourceLine] = []
    for line in lines:
        region_index = 0 if line.x_min < midpoint else 1
        updated = SourceLine(
            line_id=line.line_id,
            text=line.text,
            x_min=line.x_min,
            y_min=line.y_min,
            x_max=line.x_max,
            y_max=line.y_max,
            source_page_number=line.source_page_number,
            source_region_index=region_index,
            source_order=line.source_order,
        )
        if region_index == 0:
            left.append(updated)
        else:
            right.append(updated)

    left = sorted(left, key=_line_sort_key)
    right = sorted(right, key=_line_sort_key)
    return (left, right)


def _line_sort_key(line: SourceLine) -> tuple[float, int, float, int]:
    return (line.y_min, line.source_order, line.x_min, line.line_id)


def _space_before_for_boundary(decision: BoundaryDecision, stats: RegionStats) -> float:
    if decision.kind == BoundaryKind.BLOCK:
        return BLOCK_SPACE_BEFORE_LINES
    if decision.kind != BoundaryKind.PARAGRAPH:
        return 0.0

    excess = max(0.0, decision.vertical_gap - stats.median_vertical_gap)
    units = excess / max(1.0, stats.median_line_height)
    return _clamp(max(0.4, units), 0.0, MAX_SPACE_BEFORE_LINES)


def ends_with_terminal_punctuation(text: str) -> bool:
    stripped = (text or "").rstrip()
    if not stripped:
        return False
    return stripped.endswith(TERMINAL_PUNCTUATION)


def _safe_median(values: Sequence[float], *, fallback: float) -> float:
    cleaned = [float(value) for value in values if isinstance(value, (int, float))]
    if not cleaned:
        return fallback
    return float(median(cleaned))


def _trim_outliers(values: Sequence[float], *, lower: float, upper: float) -> list[float]:
    if not values:
        return []
    low = _quantile(values, lower)
    high = _quantile(values, upper)
    if high < low:
        return list(values)
    return [value for value in values if low <= value <= high]


def _quantile(values: Sequence[float], q: float) -> float:
    cleaned = sorted(float(value) for value in values if isinstance(value, (int, float)))
    if not cleaned:
        return 0.0
    if len(cleaned) == 1:
        return cleaned[0]

    q = _clamp(q, 0.0, 1.0)
    position = (len(cleaned) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(cleaned) - 1)
    weight = position - lower
    return cleaned[lower] * (1.0 - weight) + cleaned[upper] * weight


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))
