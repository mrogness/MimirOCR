import os
from typing import Callable, List, Optional

from backend.domain.page import Page
from backend.domain.project import Project
from backend.domain.project_config import ProjectConfig


def prepare_pages(
    project: Project,
    config: ProjectConfig,
    on_page_rasterized: Optional[Callable[[int, int], None]] = None,
) -> List[Page]:
    """Serial pre-step: rasterize each PDF page to a PNG and return a list of
    fully-populated Page objects ready for isolated workers."""
    # Import rasterization dependencies lazily so module import remains safe in
    # lightweight test/docs environments that intentionally omit these deps.
    import fitz
    from PIL import Image

    os.makedirs(config.temp_dir, exist_ok=True)

    pages: List[Page] = []
    with fitz.open(project.source_path) as doc:
        total_pages = doc.page_count

        for page_num in range(total_pages):
            fitz_page = doc[page_num]
            pix = fitz_page.get_pixmap(dpi=config.ingestion.dpi)  # type: ignore[union-attr][union-attr]
            pil_image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

            image_path = os.path.join(config.temp_dir, f"{project.id}_page_{page_num}.png")
            pil_image.save(image_path)

            pages.append(Page(
                id=f"{project.id}_page_{page_num}",
                page_number=page_num,
                image_path=image_path,
                width=pix.width,
                height=pix.height,
            ))

            if on_page_rasterized:
                on_page_rasterized(page_num + 1, total_pages)

    return pages
