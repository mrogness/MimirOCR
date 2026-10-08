"""Normalize Calamari confidence, character positions, and candidate metadata."""
import math
from collections.abc import Iterable as IterableABC
from typing import Any, List, Optional, Tuple

CALAMARI_LINE_SIDE_PADDING_PX = 16.0
MAX_SAVED_CHARACTER_CANDIDATES = 5

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


def _extract_char_positions(outputs: object, codec: Any = None) -> Optional[List[dict]]:
    positions = _read_positions(outputs)
    if not positions:
        return None

    span_domain = _prediction_span_domain(outputs)

    normalized: List[dict] = []
    for index, pos in enumerate(positions):
        chars = _read_chars(pos)
        best_char, best_label, best_prob = _pick_best_char(chars, codec=codec)
        candidates = _extract_char_candidates(chars, codec=codec)

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
        if candidates:
            item["candidates"] = candidates

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


def _pick_best_char(
    chars: List[Any],
    codec: Any = None,
) -> Tuple[Optional[str], Optional[int], Optional[float]]:
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
        char_text = _read_candidate_char(candidate, label, codec)

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


def _extract_char_candidates(chars: List[Any], codec: Any = None) -> List[dict]:
    """Return the strongest distinct non-blank candidates for one position."""
    candidates_by_char: dict[str, dict] = {}

    for candidate in chars:
        probability = _coerce_finite_float(_read_field(candidate, "probability"))
        if probability is None:
            continue

        label_raw = _read_field(candidate, "label")
        label = int(label_raw) if isinstance(label_raw, (int, float)) else None
        char_text = _read_candidate_char(candidate, label, codec)
        if not char_text:
            continue

        existing = candidates_by_char.get(char_text)
        if existing is not None and existing["probability"] >= probability:
            continue

        normalized = {
            "char": char_text,
            "probability": probability,
        }
        if label is not None:
            normalized["label"] = label
            normalized["char_id"] = label
        candidates_by_char[char_text] = normalized

    return sorted(
        candidates_by_char.values(),
        key=lambda candidate: candidate["probability"],
        reverse=True,
    )[:MAX_SAVED_CHARACTER_CANDIDATES]


def _read_predictor_codec(predictor: Any) -> Any:
    data = _read_field(predictor, "data", "_data")
    params = _read_field(data, "params", "_params")
    return _read_field(params, "codec", "_codec")


def _read_candidate_char(candidate: Any, label: Optional[int], codec: Any) -> Optional[str]:
    char_value = _read_field(candidate, "char")
    if isinstance(char_value, str) and char_value != "":
        return char_value

    if label is None or codec is None:
        return char_value if isinstance(char_value, str) else None

    code_to_char = _read_field(codec, "code2char")
    decoded = None
    if isinstance(code_to_char, dict):
        decoded = code_to_char.get(label)
    elif isinstance(code_to_char, (list, tuple)) and 0 <= label < len(code_to_char):
        decoded = code_to_char[label]

    return decoded if isinstance(decoded, str) else None


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
