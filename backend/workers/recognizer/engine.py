"""Load a Calamari predictor and recognize page line crops."""
import os
import sys
from itertools import zip_longest
from pathlib import Path
from typing import Any, Iterable

from backend.domain.page import Page
from backend.domain.project_config import DEFAULT_OCR_MODEL_PATH, ProjectConfig
from backend.workers.recognizer.ij_disambiguation import disambiguate_ij_text
from backend.workers.recognizer.predictions import (
    _char_confidence_from_positions, _extract_char_confidence, _extract_char_positions,
    _extract_line_confidence, _read_predictor_codec,
)

def _checkpoint_stem(raw_path: str) -> Path:
    """Accept a Calamari checkpoint stem or either of its two files."""
    path = Path(raw_path).expanduser()
    return path.with_suffix("") if path.suffix in {".json", ".keras"} else path


def _resolve_model_path(raw_path: str) -> str:
    """Resolve the bundled checkpoint or an explicitly trusted local checkpoint."""
    root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[3]
    default = Path(DEFAULT_OCR_MODEL_PATH)
    bundled = (root / default).resolve()
    candidate = _checkpoint_stem(raw_path)
    if candidate == default or candidate.resolve() == bundled:
        return str(bundled)

    trusted = os.environ.get("MIMIR_TRUSTED_OCR_MODEL")
    if trusted:
        trusted_stem = _checkpoint_stem(trusted).resolve()
        if candidate.resolve() == trusted_stem:
            return str(trusted_stem)

    raise ValueError("OCR checkpoint must be the bundled model or match MIMIR_TRUSTED_OCR_MODEL")


def create_predictor(config: ProjectConfig):
    """Load the configured Calamari checkpoint and limit its preprocessing parallelism.

    Use the recognizer runtime's thread setting and translate known TensorFlow operation
    incompatibilities into a checkpoint/runtime mismatch error; other load errors propagate.
    """
    max_threads = int(os.environ["MIMIR_OCR_THREADS"])
    resolved_model_path = _resolve_model_path(config.ocr.model_path)

    # Canonical predictor import path for the current OCR stack.
    from calamari_ocr.ocr.predict.predictor import Predictor, PredictorParams

    try:
        predictor = Predictor.from_checkpoint(
            params=PredictorParams(),
            checkpoint=resolved_model_path,
            auto_update_checkpoints=False,
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
    """Recognize page line crops in place while preserving line identities and order.

    Populate OCR text, line/character scores, positions, and candidate metadata; optionally
    apply lexicon-based I/J disambiguation. Return an empty page unchanged and raise
    RuntimeError if prediction and crop counts differ.
    """
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
    """Yield each ordered line crop as a grayscale NumPy array, opening and closing its image
    file for that sample.
    """
    import PIL.Image as Image
    import numpy as np

    for line in page.lines:
        with Image.open(line.image_path) as img:
            yield np.asarray(img.convert("L"))


def _disable_predictor_parallelism(predictor: object, max_threads: int) -> None:
    """
    Force Calamari/TFAIP preprocessing to stay in-process.
    Keep preprocessing inside the model-owning worker rather than starting
    additional TensorFlow processes for each page. Bound prefetching and nested
    native thread settings using the active recognizer limit.
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
    """Recursively disable TFAIP pipeline process parallelism and apply bounded native thread
    counts where supported.
    """
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
