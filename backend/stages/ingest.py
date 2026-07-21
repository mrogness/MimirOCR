import os

from PIL import Image

from backend.models.page import Page
from backend.models.project_config import ProjectConfig


def ingest(page: Page, config: ProjectConfig) -> Page:
    # TODO: make these steps optional and configurable
    # page = _deskew(page, config)
    # page = _denoise(page, config)
    #page = _binarize(page, config) # discovered that kraken hates binarized images.
    return page


def _deskew(page: Page, config: ProjectConfig) -> Page:
    ...

def _denoise(page: Page, config: ProjectConfig) -> Page:
    ...

def _binarize(page: Page, config: ProjectConfig) -> Page:
    # Keep this consistent with line_snipping_utils.binarize_img.
    image = Image.open(page.image_path)
    threshold = config.ingestion.binarization_threshold
    binary_image = image.convert("L").point(lambda p: 255 if p > threshold else 0, mode="1")

    # Save preprocessed image and update page path.
    os.makedirs(config.temp_dir, exist_ok=True)
    temp_image_path = f"{config.temp_dir}/{page.id}_preprocessed.png"
    binary_image.save(temp_image_path)
    page.image_path = temp_image_path

    return page

