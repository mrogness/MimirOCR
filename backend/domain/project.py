"""Serializable OCR project aggregates used by the pipeline, not database rows."""
from typing import Any, Iterator
from datetime import datetime

from pydantic import BaseModel, Field

from backend.domain.project_config import ProjectConfig

from backend.domain.page import Page

# 1. The data we expect from Vue.js to CREATE a project
class ProjectCreate(BaseModel):
    """Source PDF and pipeline configuration needed to construct a project."""
    name: str
    source_path: str
    config: ProjectConfig = Field(default_factory=ProjectConfig)
    # Notice: No ID or timestamps here. The frontend doesn't provide them.


class Project(ProjectCreate):
    """An OCR run's project metadata, configuration, and processed pages.

    IDs here are strings for worker serialization. HTTP and database project
    IDs are managed separately by the API/persistence layer.
    """
    id: str
    # name: str
    # source_path: str  # pdf path; TODO: support folders of pdfs
    pages: list[Page] = Field(default_factory=list)

    config: ProjectConfig = Field(default_factory=ProjectConfig)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def add_page(self, page: Page) -> None:
        """Append a page by replacing the page list with a new list."""
        pages = list(self.pages)
        pages.append(page)
        self.pages = pages

    def get_page(self, index: int) -> Page:
        """Return the page at a zero-based list index; normal IndexError behavior applies."""
        return self.pages[index]

    def page_count(self) -> int:
        """Return the number of currently attached domain pages."""
        return len(self.pages)

    def iter_pages(self) -> Iterator[Page]:
        """Iterate attached pages in their current list order without sorting them."""
        return iter(self.pages)

    def to_dict(self) -> dict[str, Any]:
        """Return Pydantic's Python-mode representation, including nested pages."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Project":
        """Validate a mapping and reconstruct its nested domain records."""
        return cls(**data)
