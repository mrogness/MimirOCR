"""Calamari-only entry point (also used by PyInstaller)."""
from backend.workers.server import serve


def initialize(config):
    import os
    import tensorflow as tf
    from backend.workers.recognizer.engine import create_predictor, ocr_with_predictor

    tf.config.threading.set_intra_op_parallelism_threads(int(os.environ["MIMIR_OCR_THREADS"]))
    tf.config.threading.set_inter_op_parallelism_threads(1)
    predictor = create_predictor(config)
    return lambda page: ocr_with_predictor(page, predictor, disambiguate_ij=config.ocr.disambiguate_ij)


if __name__ == "__main__":
    from multiprocessing import freeze_support
    freeze_support()
    serve("recognizer", initialize)
