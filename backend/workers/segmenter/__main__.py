"""Kraken-only entry point (also used by PyInstaller)."""
from backend.workers.server import serve


def initialize(config):
    import os
    import torch
    from backend.workers.segmenter.engine import create_segmenter, segment

    torch.set_num_threads(int(os.environ["MIMIR_SEGMENTATION_THREADS"]))
    torch.set_num_interop_threads(1)
    model = create_segmenter()
    return lambda page: segment(page, config, model)


if __name__ == "__main__":
    from multiprocessing import freeze_support
    freeze_support()
    serve("segmenter", initialize)
