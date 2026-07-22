import os
import sys
from pathlib import Path
import PIL.Image as Image
import numpy as np
import math
from collections.abc import Iterable as IterableABC
from typing import Any, Callable, Iterable, List, Optional, Tuple

from backend.models.page import Page
from backend.models.project_config import ProjectConfig


CALAMARI_LINE_SIDE_PADDING_PX = 16.0


def _is_macos_frozen_runtime() -> bool:
    return sys.platform == "darwin" and bool(getattr(sys, "frozen", False))


def _resolve_model_path(raw_path: str) -> str:
    candidate = Path(raw_path)
    if candidate.is_absolute() and candidate.exists():
        return str(candidate)

    if candidate.exists():
        return str(candidate)

    meipass = getattr(sys, '_MEIPASS', '')
    if meipass:
        bundled = Path(meipass) / candidate
        if bundled.exists():
            return str(bundled)

    project_root = Path(__file__).resolve().parents[2]
    repo_relative = project_root / candidate
    if repo_relative.exists():
        return str(repo_relative)

    return raw_path


def create_predictor(config: ProjectConfig):
    env_threads = os.getenv("MIMIR_OCR_THREADS")
    max_threads = _safe_worker_count(env_threads if env_threads is not None else config.num_workers)
    _configure_runtime_threads(max_threads)

    # Canonical predictor import path for the current OCR stack.
    from calamari_ocr.ocr.predict.predictor import Predictor, PredictorParams

    resolved_model_path = _resolve_model_path(config.ocr.model_path)
    params = PredictorParams()
    _configure_predictor_params(params, max_threads)

    try:
        predictor = Predictor.from_checkpoint(
            params=params,
            checkpoint=resolved_model_path,
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "DisableCopyOnRead" in message or "Op type not registered" in message:
            raise RuntimeError(
                "OCR model runtime mismatch for "
                f"'{config.ocr.model_path}'. The checkpoint was saved with a different "
                "TensorFlow/Calamari version than the current environment. "
                "Use a checkpoint exported from this runtime stack "
                "or align training and inference TensorFlow versions."
            ) from exc
        raise

    _disable_predictor_parallelism(predictor, max_threads)
    return predictor


def ocr_with_predictor(page: Page, predictor: object) -> Page:
    if not page.lines:
        return page

    # Keep predictions aligned with the original line ordering.
    samples = predictor.predict_raw(_line_generator(page))
    for line, sample in zip(page.lines, samples):
        outputs = sample.outputs
        line.ocr_text = outputs.sentence
        line.confidence = _extract_line_confidence(outputs)
        line.char_positions = _extract_char_positions(outputs)
        line.char_confidence = _extract_char_confidence(outputs)
        if not line.char_confidence and line.char_positions:
            line.char_confidence = _char_confidence_from_positions(line.char_positions)

    return page


def _extract_line_confidence(outputs: object) -> Optional[float]:
    for attr in ("avg_char_probability", "avg_char_confidence", "confidence", "probability", "score"):
        value = getattr(outputs, attr, None)
        numeric = _coerce_finite_float(value)
        if numeric is not None:
            return numeric
    return None


def _extract_char_confidence(outputs: object) -> Optional[List[float]]:
    for attr in (
        "char_confidences",
        "char_probs",
        "character_confidences",
        "char_confidence",
        "char_probability",
        "confidences",
    ):
        value = getattr(outputs, attr, None)
        cleaned = _coerce_confidence_sequence(value)
        if cleaned:
            return cleaned

    # Prediction outputs expose per-character probabilities in
    # prediction.positions[*].chars[*].probability.
    from_positions = _extract_char_confidence_from_positions(outputs)
    if from_positions:
        return from_positions

    nested_prediction = getattr(outputs, "prediction", None)
    from_nested_positions = _extract_char_confidence_from_positions(nested_prediction)
    if from_nested_positions:
        return from_nested_positions

    return None


def _extract_char_confidence_from_positions(prediction: Any) -> Optional[List[float]]:
    if prediction is None:
        return None

    positions = getattr(prediction, "positions", None)
    if positions is None and isinstance(prediction, dict):
        positions = prediction.get("positions")
    if not isinstance(positions, IterableABC) or isinstance(positions, (str, bytes, bytearray)):
        return None

    values: List[float] = []
    for pos in positions:
        chars = getattr(pos, "chars", None)
        if chars is None and isinstance(pos, dict):
            chars = pos.get("chars")

        if not isinstance(chars, IterableABC) or isinstance(chars, (str, bytes, bytearray)):
            continue

        best_prob: Optional[float] = None
        for c in chars:
            prob = getattr(c, "probability", None)
            if prob is None and isinstance(c, dict):
                prob = c.get("probability")

            numeric = _coerce_finite_float(prob)
            if numeric is None:
                continue

            if best_prob is None or numeric > best_prob:
                best_prob = numeric

        if best_prob is not None:
            values.append(best_prob)

    return values if values else None


def _extract_char_positions(outputs: object) -> Optional[List[dict]]:
    positions = _read_positions(outputs)
    if not positions:
        return None

    span_domain = _prediction_span_domain(outputs)

    normalized: List[dict] = []
    for index, pos in enumerate(positions):
        chars = _read_chars(pos)
        best_char, best_label, best_prob = _pick_best_char(chars)

        start, start_key = _pick_position_coordinate(
            pos,
            ("global_start_ext", "global_start", "local_start"),
        )
        end, end_key = _pick_position_coordinate(
            pos,
            ("global_end_ext", "global_end", "local_end"),
        )

        # Calamari line preprocessing introduces horizontal side padding.
        # When we fall back to local_* coordinates, compensate to reduce
        # systematic highlight shifts in the UI.
        start = _adjust_for_line_padding(start, start_key)
        end = _adjust_for_line_padding(end, end_key)
        if start is None and end is None:
            continue

        if start is None:
            start = end
        if end is None:
            end = start
        if start is None or end is None:
            continue
        if end < start:
            start, end = end, start

        item = {
            "index": index,
            "start": start,
            "end": end,
        }
        if span_domain is not None:
            item["domain"] = span_domain
        if best_char is not None:
            item["char"] = best_char
        if best_label is not None:
            item["label"] = best_label
            item["char_id"] = best_label
        if best_prob is not None:
            item["probability"] = best_prob

        normalized.append(item)

    return normalized if normalized else None


def _pick_position_coordinate(pos: Any, keys: Tuple[str, ...]) -> tuple[Optional[float], Optional[str]]:
    candidates: List[tuple[float, str]] = []
    for key in keys:
        numeric = _coerce_finite_float(_read_field(pos, key))
        if numeric is not None:
            candidates.append((numeric, key))

    if not candidates:
        return None, None

    # Prefer non-zero coordinates when available. In some model/runtime combos,
    # global coordinates may stay at 0 while local spans are populated.
    for value, key in candidates:
        if value != 0:
            return value, key

    value, key = candidates[0]
    return value, key


def _adjust_for_line_padding(value: Optional[float], source_key: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    if source_key in {"local_start", "local_end"}:
        return max(0.0, value - CALAMARI_LINE_SIDE_PADDING_PX)
    return value


def _prediction_span_domain(outputs: Any) -> Optional[float]:
    logits = _read_field(outputs, "logits")
    if logits is None:
        nested = _read_field(outputs, "prediction")
        if nested is not outputs:
            logits = _read_field(nested, "logits")

    shape = getattr(logits, "shape", None)
    if shape is not None:
        try:
            dims = list(shape)
        except TypeError:
            dims = []
        if dims:
            domain = _coerce_finite_float(dims[0])
            if domain is not None and domain > 0:
                return domain

    if isinstance(logits, (list, tuple)) and len(logits) > 0:
        domain = _coerce_finite_float(len(logits))
        if domain is not None and domain > 0:
            return domain

    return None


def _char_confidence_from_positions(positions: List[dict]) -> Optional[List[float]]:
    values: List[float] = []
    for pos in positions:
        prob = _coerce_finite_float(pos.get("probability"))
        if prob is not None:
            values.append(prob)
    return values if values else None


def _read_positions(obj: Any) -> Optional[List[Any]]:
    if obj is None:
        return None

    direct = _read_field(obj, "positions")
    if isinstance(direct, IterableABC) and not isinstance(direct, (str, bytes, bytearray)):
        items = list(direct)
        if items:
            return items

    nested = _read_field(obj, "prediction")
    if nested is obj:
        return None
    return _read_positions(nested)


def _read_chars(position: Any) -> List[Any]:
    chars = _read_field(position, "chars")
    if isinstance(chars, IterableABC) and not isinstance(chars, (str, bytes, bytearray)):
        return list(chars)
    return []


def _pick_best_char(chars: List[Any]) -> Tuple[Optional[str], Optional[int], Optional[float]]:
    best_char: Optional[str] = None
    best_label: Optional[int] = None
    best_prob: Optional[float] = None

    best_non_blank_char: Optional[str] = None
    best_non_blank_label: Optional[int] = None
    best_non_blank_prob: Optional[float] = None

    for candidate in chars:
        prob = _coerce_finite_float(_read_field(candidate, "probability"))
        label_raw = _read_field(candidate, "label")
        label = int(label_raw) if isinstance(label_raw, (int, float)) else None
        char_value = _read_field(candidate, "char")
        char_text = char_value if isinstance(char_value, str) else None

        if prob is None:
            continue

        if best_prob is None or prob > best_prob:
            best_prob = prob
            best_char = char_text
            best_label = label

        is_non_blank = isinstance(char_text, str) and char_text != ""
        if is_non_blank and (best_non_blank_prob is None or prob > best_non_blank_prob):
            best_non_blank_prob = prob
            best_non_blank_char = char_text
            best_non_blank_label = label

    if best_non_blank_prob is not None:
        return best_non_blank_char, best_non_blank_label, best_non_blank_prob

    return best_char, best_label, best_prob


def _read_field(obj: Any, *keys: str) -> Any:
    if obj is None:
        return None
    for key in keys:
        if hasattr(obj, key):
            return getattr(obj, key)
        if isinstance(obj, dict) and key in obj:
            return obj.get(key)
    return None


def _coerce_finite_float(value: Any) -> Optional[float]:
    if value is None:
        return None

    # TensorFlow/NumPy scalars often expose item().
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (TypeError, ValueError, AttributeError):
            pass

    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None

    return numeric if math.isfinite(numeric) else None


def _coerce_confidence_sequence(value: Any) -> Optional[List[float]]:
    if value is None or isinstance(value, (str, bytes, bytearray)):
        return None

    if hasattr(value, "tolist"):
        try:
            value = value.tolist()
        except (TypeError, ValueError, AttributeError):
            pass

    if isinstance(value, dict):
        for key in ("confidences", "char_confidences", "probs", "values"):
            nested = value.get(key)
            cleaned = _coerce_confidence_sequence(nested)
            if cleaned:
                return cleaned
        return None

    if not isinstance(value, IterableABC):
        single = _coerce_finite_float(value)
        return [single] if single is not None else None

    cleaned: List[float] = []
    for item in value:
        numeric = _coerce_finite_float(item)
        if numeric is not None:
            cleaned.append(numeric)
            continue

        if isinstance(item, dict):
            for key in ("confidence", "probability", "prob", "value"):
                nested = _coerce_finite_float(item.get(key))
                if nested is not None:
                    cleaned.append(nested)
                    break
            continue

        if isinstance(item, (list, tuple)):
            for sub_item in item:
                nested = _coerce_finite_float(sub_item)
                if nested is not None:
                    cleaned.append(nested)
                    break

    return cleaned if cleaned else None


def ocr(page: Page, config: ProjectConfig) -> Page:
    predictor = create_predictor(config)
    return ocr_with_predictor(page, predictor)


def ocr_pages(
    pages: List[Page],
    config: ProjectConfig,
    on_page_done: Optional[Callable[[int, int], None]] = None,
) -> List[Page]:
    if not pages:
        return pages

    predictor = create_predictor(config)
    total = len(pages)
    output: List[Page] = []
    for idx, page in enumerate(pages, start=1):
        output.append(ocr_with_predictor(page, predictor))
        if on_page_done:
            on_page_done(idx, total)

    return output


def _line_generator(page: Page):
    for line in page.lines:
        with Image.open(line.image_path) as img:
            yield np.asarray(img.convert("L"))


def _disable_predictor_parallelism(predictor: object, max_threads: int) -> None:
    """
    Force Calamari/TFAIP preprocessing to stay in-process.
    Important to maintain custom control over preprocessing and avoid large startup and memeory overhead of spawning separate TF worker processes for each page.
    """
    data = getattr(predictor, "data", None)
    if data is None:
        return

    data_params = getattr(data, "params", None)
    if data_params is None:
        return

    pipeline = getattr(getattr(predictor, "params", None), "pipeline", None)
    if pipeline is not None:
        pipeline.num_processes = 1
        pipeline.prefetch = min(2, max_threads)

    _disable_pipeline_params(getattr(data_params, "pre_proc", None), max_threads)
    _disable_pipeline_params(getattr(data_params, "post_proc", None), max_threads)


def _disable_pipeline_params(params: Any, max_threads: int) -> None:
    if params is None:
        return

    if hasattr(params, "run_parallel"):
        params.run_parallel = False

    if hasattr(params, "num_threads"):
        params.num_threads = max_threads

    nested = getattr(params, "pipelines", None)
    if isinstance(nested, Iterable) and not isinstance(nested, (str, bytes)):
        for child in nested:
            _disable_pipeline_params(child, max_threads)


def _safe_worker_count(value: Any) -> int:
    try:
        workers = int(value)
    except (TypeError, ValueError):
        workers = 1
    return max(1, workers)


def _configure_runtime_threads(max_threads: int) -> None:
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
    os.environ["TF_NUM_INTRAOP_THREADS"] = thread_count
    os.environ["TF_NUM_INTEROP_THREADS"] = "1"
    os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

    try:
        from threadpoolctl import threadpool_limits  # type: ignore

        threadpool_limits(limits=max_threads)
    except ImportError:
        pass

    # In frozen macOS sidecar builds, defer TensorFlow import to Calamari's
    # canonical load path. Early imports can increase native init-order risk.
    if _is_macos_frozen_runtime():
        return

    # If TensorFlow is already imported, apply limits programmatically too.
    try:
        import tensorflow as tf  # type: ignore

        try:
            tf.config.threading.set_intra_op_parallelism_threads(max_threads)
            tf.config.threading.set_inter_op_parallelism_threads(1)
        except RuntimeError:
            # TF runtime may already be initialized and disallow late changes.
            pass
    except ImportError:
        pass


def _configure_predictor_params(params: Any, max_threads: int) -> None:
    pipeline = getattr(params, "pipeline", None)
    if pipeline is not None:
        if hasattr(pipeline, "num_processes"):
            pipeline.num_processes = 1
        if hasattr(pipeline, "prefetch"):
            pipeline.prefetch = min(2, max_threads)
            