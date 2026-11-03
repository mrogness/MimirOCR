"""Geometry and reading-order helpers for Kraken segmentation metadata."""
from typing import Any

def _line_boundary(line: dict[str, Any]) -> list[list[float] | tuple[float, float]]:
    """Return a line's list-valued polygon boundary, or an empty list when it is unavailable."""
    boundary = line.get("boundary")
    if isinstance(boundary, list):
        return boundary
    return []


def _line_sort_key(line: dict[str, Any]) -> tuple[float, float]:
    """Return the minimum boundary y/x coordinates as a geometric sorting key; empty boundaries sort last.
    """
    boundary = _line_boundary(line)
    if not boundary:
        return (float('inf'), float('inf'))
    min_y = min(pt[1] for pt in boundary)
    min_x = min(pt[0] for pt in boundary)
    return (min_y, min_x)


def _line_anchor(line: dict[str, Any]) -> tuple[float, float] | None:
    """Return the mean of the boundary vertices as a line anchor, or None for an empty boundary.
    """

    boundary = _line_boundary(line)
    if not boundary:
        return None
    xs = [pt[0] for pt in boundary]
    ys = [pt[1] for pt in boundary]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _line_region_index(line: dict[str, Any], region_polygons: list[list[list[float] | tuple[float, float]]]) -> int | None:
    """Return the first region polygon containing the line anchor, or None when no region matches.
    """
    anchor = _line_anchor(line)
    if anchor is None:
        return None
    x, y = anchor
    for idx, polygon in enumerate(region_polygons):
        if polygon and _point_in_polygon(x, y, polygon):
            return idx
    return None


def _point_in_polygon(x: float, y: float, polygon: list[list[float] | tuple[float, float]]) -> bool:
    """Test point inclusion with horizontal ray casting; polygons with fewer than three vertices are outside.
    """

    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersects = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside


def _bbox_from_meta(meta: object) -> dict[str, int] | None:
    """Extract integer bounding-box coordinates from a metadata mapping or object.

    Prefer an explicit four-value bbox sequence, otherwise use polygon extrema; return None when neither representation exists.
    """
    boundary: Any = None
    if isinstance(meta, dict):
        boundary = meta.get('boundary')
        bbox = meta.get('bbox')
    else:
        boundary = getattr(meta, 'boundary', None)
        bbox = getattr(meta, 'bbox', None)

    # BBox line payloads may directly expose a bbox tuple/list.
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        return {
            'x_min': int(bbox[0]),
            'y_min': int(bbox[1]),
            'x_max': int(bbox[2]),
            'y_max': int(bbox[3]),
        }

    if not boundary:
        return None

    xs = [pt[0] for pt in boundary]
    ys = [pt[1] for pt in boundary]
    return {
        'x_min': int(min(xs)),
        'y_min': int(min(ys)),
        'x_max': int(max(xs)),
        'y_max': int(max(ys)),
    }


def _sort_lines_within_regions(seg: dict[str, Any]) -> list[dict[str, Any]]:
    """Order region blocks top-to-bottom/left-to-right, then order their lines by geometric position.

    Assign a line to the first polygon containing its mean-vertex anchor. Append unmatched lines after all regions, and sort the full batch geometrically when no text regions exist.
    """
    lines_raw = seg.get("lines")
    lines: list[dict[str, Any]] = lines_raw if isinstance(lines_raw, list) else []
    regions = seg.get("regions", {})
    text_regions = regions.get('text', []) if isinstance(regions, dict) else []
    region_polygons: list[list[list[float] | tuple[float, float]]] = []
    for region in text_regions:
        boundary = region.get('boundary') if isinstance(region, dict) else None
        if isinstance(boundary, list):
            region_polygons.append(boundary)

    if not region_polygons:
        return sorted(lines, key=_line_sort_key)

    grouped: dict[int, list[dict[str, Any]]] = {idx: [] for idx in range(len(region_polygons))}
    unmatched: list[dict[str, Any]] = []

    for line in lines:
        region_idx = _line_region_index(line, region_polygons)
        if region_idx is None:
            unmatched.append(line)
        else:
            grouped[region_idx].append(line)

    # Kraken does not guarantee reading-order for regions, so explicitly
    # sort region blocks from top-to-bottom (and left-to-right as tie-breaker).
    region_order = sorted(range(len(region_polygons)), key=lambda idx: _region_sort_key(region_polygons[idx]))

    ordered: list[dict[str, Any]] = []
    for idx in region_order:
        ordered.extend(sorted(grouped[idx], key=_line_sort_key))
    ordered.extend(sorted(unmatched, key=_line_sort_key))
    return ordered


def _region_sort_key(region_polygon: list[list[float] | tuple[float, float]]) -> tuple[float, float]:
    """Sort a region by its minimum usable y/x coordinates, placing empty or unusable regions
    last.
    """
    if not region_polygon:
        return (float('inf'), float('inf'))

    ys = [pt[1] for pt in region_polygon if isinstance(pt, (list, tuple)) and len(pt) >= 2]
    xs = [pt[0] for pt in region_polygon if isinstance(pt, (list, tuple)) and len(pt) >= 2]
    if not ys or not xs:
        return (float('inf'), float('inf'))

    return (min(ys), min(xs))
