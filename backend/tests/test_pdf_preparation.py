"""Exercise real rasterization without importing either inference engine."""
from pathlib import Path

import fitz
from PIL import Image
import pytest

from backend.domain.project import Project
from backend.domain.project_config import ProjectConfig
from backend.pipeline.prepare import prepare_pages


@pytest.mark.parametrize("dpi", [72, 144])
def test_rasterization_preserves_page_order_dimensions_and_progress(tmp_path, dpi):
    source = tmp_path / "source.pdf"
    with fitz.open() as doc:
        doc.new_page(width=144, height=216).insert_text((10, 30), "First page")
        doc.new_page(width=216, height=144).insert_text((10, 30), "Second page")
        doc.save(source)
    config = ProjectConfig(temp_dir=str(tmp_path / "rasterized"))
    config.ingestion.dpi = dpi
    project = Project(id="test", name="Test", source_path=str(source))
    progress = []
    pages = prepare_pages(project, config, lambda done, total: progress.append((done, total)))
    assert [page.page_number for page in pages] == [0, 1]
    assert progress == [(1, 2), (2, 2)]
    scale = dpi // 72
    assert [(page.width, page.height) for page in pages] == [(144 * scale, 216 * scale), (216 * scale, 144 * scale)]
    for page in pages:
        with Image.open(page.image_path) as image:
            assert image.mode == "RGB"
            assert image.size == (page.width, page.height)
    assert source.is_file()


def test_invalid_pdf_is_rejected_without_creating_page_images(tmp_path):
    source = tmp_path / "broken.pdf"
    source.write_bytes(b"not a PDF")
    config = ProjectConfig(temp_dir=str(tmp_path / "rasterized"))
    with pytest.raises(fitz.FileDataError):
        prepare_pages(Project(id="test", name="Test", source_path=str(source)), config)
    assert list(Path(config.temp_dir).glob("*.png")) == []
