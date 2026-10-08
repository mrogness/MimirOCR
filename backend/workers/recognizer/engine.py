"""Load a Calamari predictor and recognize page line crops."""
import os
import sys
from itertools import zip_longest
from pathlib import Path
from typing import Any, Iterable

from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers.recognizer.ij_disambiguation import disambiguate_ij_text
from backend.workers.recognizer.predictions import (
    _char_confidence_from_positions, _extract_char_confidence, _extract_char_positions,
    _extract_line_confidence, _read_predictor_codec,
)

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

    project_root = Path(__file__).resolve().parents[3]
    repo_relative = project_root / candidate
    if repo_relative.exists():
        return str(repo_relative)

    return raw_path


def create_predictor(config: ProjectConfig):
    max_threads = int(os.environ["MIMIR_OCR_THREADS"])

    # Canonical predictor import path for the current OCR stack.
    from calamari_ocr.ocr.predict.predictor import Predictor, PredictorParams

    resolved_model_path = _resolve_model_path(config.ocr.model_path)

    try:
        predictor = Predictor.from_checkpoint(
            params=PredictorParams(),
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


def ocr_with_predictor(
    page: Page,
    predictor: object,
    *,
    disambiguate_ij: bool = True,
) -> Page:
    if not page.lines:
        return page

    codec = _read_predictor_codec(predictor)

    # Keep predictions aligned with the original line ordering.
    samples = predictor.predict_raw(_line_generator(page))
    for line, sample in zip_longest(page.lines, samples):
        if line is None or sample is None:
            raise RuntimeError("Calamari returned a different number of predictions than line crops")
        outputs = sample.outputs
        raw_text = outputs.sentence
        line.ocr_text = disambiguate_ij_text(raw_text) if disambiguate_ij else raw_text
        line.confidence = _extract_line_confidence(outputs)
        line.char_positions = _extract_char_positions(outputs, codec=codec)
        line.char_confidence = _extract_char_confidence(outputs)
        if not line.char_confidence and line.char_positions:
            line.char_confidence = _char_confidence_from_positions(line.char_positions)

    return page


def _line_generator(page: Page):
    # Import imaging dependencies lazily so helper-only imports in lightweight
    # test/doc environments do not require Pillow/NumPy.
    import PIL.Image as Image
    import numpy as np

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
