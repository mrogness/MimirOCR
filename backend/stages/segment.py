# segment.py
import os
import sys
import types
from typing import Any, Iterable
from PIL import Image, ImageOps

from backend.models.line import Line
from backend.models.page import Page
from backend.models.project_config import ProjectConfig


def _install_coremltools_proto_stub() -> None:
    """
    Provide a lightweight coremltools stub for Kraken inference paths.

    Kraken imports CoreML symbols (`coremltools.proto`, `coremltools.models`,
    and `coremltools.models.neural_network`) at module import time even when
    running segmentation/inference only. In packaged runtime scenarios,
    importing full coremltools can trigger protobuf descriptor collisions with
    TensorFlow. The inference path only needs these symbols to exist, not full
    CoreML conversion functionality.
    """
    if os.getenv("MIMIR_USE_REAL_COREMLTOOLS", "0") == "1":
        return

    if "coremltools" in sys.modules:
        return

    coremltools_mod = types.ModuleType("coremltools")
    coremltools_mod.__path__ = []

    proto_mod = types.ModuleType("coremltools.proto")
    proto_mod.__path__ = []

    pb2_mod = types.ModuleType("coremltools.proto.NeuralNetwork_pb2")
    models_mod = types.ModuleType("coremltools.models")
    models_mod.__path__ = []
    nn_models_mod = types.ModuleType("coremltools.models.neural_network")

    class _ProtoParamValue:
        def __init__(self) -> None:
            self.intValue = 0
            self.doubleValue = 0.0
            self.stringValue = ""

    class _ProtoParamMap(dict):
        def __missing__(self, key):
            value = _ProtoParamValue()
            self[key] = value
            return value

    class CustomLayerParams:
        def __init__(self) -> None:
            self.className = ""
            self.description = ""
            self.parameters = _ProtoParamMap()

    class MLModel:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

    class _DataTypes:
        @staticmethod
        def Array(*shape):
            return tuple(shape)

        @staticmethod
        def String():
            return "string"

    class NeuralNetworkBuilder:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

        def __getattr__(self, _name):
            # Conversion helpers are not used in inference path; keep method
            # calls no-op when import-time references exist.
            def _noop(*_args, **_kwargs):
                return None
            return _noop

    pb2_mod.CustomLayerParams = CustomLayerParams
    proto_mod.NeuralNetwork_pb2 = pb2_mod
    models_mod.MLModel = MLModel
    models_mod.datatypes = _DataTypes()
    nn_models_mod.NeuralNetworkBuilder = NeuralNetworkBuilder
    models_mod.neural_network = nn_models_mod

    coremltools_mod.proto = proto_mod
    coremltools_mod.models = models_mod

    sys.modules["coremltools"] = coremltools_mod
    sys.modules["coremltools.proto"] = proto_mod
    sys.modules["coremltools.proto.NeuralNetwork_pb2"] = pb2_mod
    sys.modules["coremltools.models"] = models_mod
    sys.modules["coremltools.models.neural_network"] = nn_models_mod


def _safe_thread_count(value: object, fallback: int = 1) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(1, parsed)


def _configure_segmentation_threads(config: ProjectConfig) -> None:
    env_threads = os.getenv("MIMIR_SEGMENTATION_THREADS")
    max_threads = _safe_thread_count(env_threads, fallback=config.num_workers)
    thread_count = str(max_threads)

    os.environ["OMP_NUM_THREADS"] = thread_count
    os.environ["OMP_THREAD_LIMIT"] = thread_count
    os.environ["OPENBLAS_NUM_THREADS"] = thread_count
    os.environ["MKL_NUM_THREADS"] = thread_count
    os.environ["VECLIB_MAXIMUM_THREADS"] = thread_count
    os.environ["NUMEXPR_NUM_THREADS"] = thread_count
    os.environ["BLIS_NUM_THREADS"] = thread_count
    os.environ["OMP_DYNAMIC"] = "FALSE"
    os.environ["MKL_DYNAMIC"] = "FALSE"

    try:
        from threadpoolctl import threadpool_limits  # type: ignore

        threadpool_limits(limits=max_threads)
    except ImportError:
        pass

    # Avoid runtime torch thread-pool reconfiguration here.
    # PyTorch can abort if interop/intraop pools are reconfigured after work starts.

def segment(page: Page, config: ProjectConfig) -> Page:
    """Run BLLA segmentation and filter lines via dynamically scaled GUI coordinates."""
    _install_coremltools_proto_stub()
    from kraken.blla import segment as segment_blla
    from kraken.lib.segmentation import extract_polygons

    _configure_segmentation_threads(config)
    image = Image.open(page.image_path)
    
    seg_payload = segment_blla(
        image,
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

    # If the payload contains GUI mask parameters and UI sizing info
    if config.segmentation.mask and lines_payload:
        # Pull your UI canvas size from the configuration layer
        ui_w = config.segmentation.ui_canvas_width
        ui_h = config.segmentation.ui_canvas_height
        
        # Calculate scaling ratios
        scale_x = image.width / ui_w
        scale_y = image.height / ui_h
        
        # Scale the boxes before passing them to the geometry engine
        scaled_boxes = [
            (
                int(box["x_min"] * scale_x),
                int(box["y_min"] * scale_y),
                int(box["x_max"] * scale_x),
                int(box["y_max"] * scale_y)
            )
            for box in config.segmentation.mask
        ]
        
        seg["lines"] = _filter_user_ignored_lines(lines_payload, scaled_boxes)
        lines_payload = seg.get("lines")
        if not isinstance(lines_payload, list):
            lines_payload = []
        
    # 4. Sort columns cleanly if requested
    if config.segmentation.strict_top_to_bottom and lines_payload:
        seg["lines"] = _sort_lines_within_regions(seg)

    # Convert to grayscale and invert strictly for Kraken's extraction mapping requirements
    inv_img = ImageOps.invert(image.convert("L"))
    polygons = list(extract_polygons(inv_img, seg))

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
    items = list(polygons)
    line_count = len(items)
    pad = max(3, len(str(line_count)))

    lines: list[Line] = []
    for idx, (line_img, meta) in enumerate(items, start=1):
        filename = f"{idx:0{pad}d}.png"
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

def _line_boundary(line: dict[str, Any]) -> list[list[float] | tuple[float, float]]:
    boundary = line.get("boundary")
    if isinstance(boundary, list):
        return boundary
    return []


def _filter_user_ignored_lines(lines: list[dict[str, Any]], ignore_boxes: list[tuple[int, int, int, int]]) -> list[dict[str, Any]]:
    """Filters out lines whose anchors land inside user-drawn GUI boxes."""
    clean_lines = []
    for line in lines:
        anchor = _line_anchor(line)
        if anchor is None:
            clean_lines.append(line)
            continue
        
        ax, ay = anchor
        ignored = False
        for (x_min, y_min, x_max, y_max) in ignore_boxes:
            if x_min <= ax <= x_max and y_min <= ay <= y_max:
                ignored = True
                break
        if not ignored:
            clean_lines.append(line)
    return clean_lines

def _line_sort_key(line: dict[str, Any]) -> tuple[float, float]:
    ''' 
        Computes a sorting key for a line based on the minimum y-coordinate of its boundary, and then by the minimum x-coordinate as a tiebreaker. Lines with missing or invalid boundaries are sorted at the end.
        Args:
            line (dict): A dictionary representing a line, expected to have a 'boundary' key with a list of coordinate pairs.
        Returns:
            tuple: A tuple (min_y, min_x) where min_y is the minimum y-coordinate of the line's boundary and min_x is the minimum x-coordinate. Lines with missing or invalid boundaries will return (float('inf'), float('inf')) to ensure they are sorted at the end.
    '''
    boundary = _line_boundary(line)
    if not boundary:
        return (float('inf'), float('inf'))
    min_y = min(pt[1] for pt in boundary)
    min_x = min(pt[0] for pt in boundary)
    return (min_y, min_x)

def _line_anchor(line: dict[str, Any]) -> tuple[float, float] | None:
    '''
        Calculates the anchor point of a line, which is the average of its boundary coordinates.
        Args:
            line (dict): A dictionary representing a line, expected to have a 'boundary' key with a list of coordinate pairs.
        Returns:
            tuple or None: The (x, y) coordinates of the anchor point, or None if the line does not have a valid boundary.
    '''
    
    boundary = _line_boundary(line)
    if not boundary:
        return None
    xs = [pt[0] for pt in boundary]
    ys = [pt[1] for pt in boundary]
    return (sum(xs) / len(xs), sum(ys) / len(ys))



def _line_region_index(line: dict[str, Any], region_polygons: list[list[list[float] | tuple[float, float]]]) -> int | None:
    '''
        Determines the index of the text region polygon that contains the line's anchor point. The anchor point is calculated as the average of the line's boundary coordinates. If the line does not have a valid boundary or if the anchor point does not fall within any of the region polygons, returns None.
        Args:
            line (dict): A dictionary representing a line, expected to have a 'boundary' key with a list of coordinate pairs.
            region_polygons (list): A list of polygons, where each polygon is a list of coordinate pairs representing the vertices of the polygon.
        Returns:
            int or None: The index of the region polygon that contains the line's anchor point, or None if the line does not have a valid boundary or if the anchor point does not fall within any of the region polygons.
    '''
    anchor = _line_anchor(line)
    if anchor is None:
        return None
    x, y = anchor
    for idx, polygon in enumerate(region_polygons):
        if polygon and _point_in_polygon(x, y, polygon):
            return idx
    return None

def _point_in_polygon(x: float, y: float, polygon: list[list[float] | tuple[float, float]]) -> bool:
    '''
        Determines if a point (x, y) is inside a polygon defined by a list of vertices. Uses the ray-casting algorithm to count how many times a horizontal ray from the point intersects with the edges of the polygon. If the number of intersections is odd, the point is inside; if even, it's outside.
        Args:
            x (float): The x-coordinate of the point to test.
            y (float): The y-coordinate of the point to test.
            polygon (list): A list of tuples representing the vertices of the polygon, where each tuple is (x, y).
        Returns:
            bool: True if the point is inside the polygon, False otherwise.
    '''
    
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
    '''
        Extracts a bounding box from the metadata dictionary, if available. The bounding box is represented as a dictionary with keys 'x_min', 'y_min', 'x_max', and 'y_max'. If the metadata does not contain a valid boundary, returns None.
        Args:
            meta (dict): A dictionary containing metadata, expected to have a 'boundary' key with a list of coordinate pairs.
        Returns:
            dict or None: A dictionary with keys 'x_min', 'y_min', 'x_max', 'y_max' representing the bounding box, or None if the metadata does not contain a valid boundary.
    '''
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
    '''
        Sorts lines within their identified text regions based on their top-most boundary coordinate. Lines that do not belong to any region are sorted at the end based on their top-most boundary coordinate.
        Args:
            seg (dict): A dictionary containing the segmentation results, expected to have a 'lines' key with a list of line dictionaries and a 'regions' key with a dictionary of region types and their corresponding polygons.
        Returns:
            list: A list of line dictionaries sorted within their respective regions and with unmatched lines at the end.
    '''
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
    if not region_polygon:
        return (float('inf'), float('inf'))

    ys = [pt[1] for pt in region_polygon if isinstance(pt, (list, tuple)) and len(pt) >= 2]
    xs = [pt[0] for pt in region_polygon if isinstance(pt, (list, tuple)) and len(pt) >= 2]
    if not ys or not xs:
        return (float('inf'), float('inf'))

    return (min(ys), min(xs))