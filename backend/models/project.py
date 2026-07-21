from typing import Any, Iterator
from datetime import datetime

from pydantic import BaseModel, Field

from backend.models.project_config import ProjectConfig

from backend.models.page import Page

# 1. The data we expect from Vue.js to CREATE a project
class ProjectCreate(BaseModel):
    name: str
    source_path: str
    config: ProjectConfig = Field(default_factory=ProjectConfig)
    # Notice: No ID or timestamps here. The frontend doesn't provide them.


class Project(ProjectCreate):
    id: str
    # name: str
    # source_path: str  # pdf path; TODO: support folders of pdfs
    pages: list[Page] = Field(default_factory=list)

    config: ProjectConfig = Field(default_factory=ProjectConfig)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def add_page(self, page: Page) -> None:
        pages = list(self.pages)
        pages.append(page)
        self.pages = pages

    def get_page(self, index: int) -> Page:
        return self.pages[index]

    def page_count(self) -> int:
        return len(self.pages)

    def iter_pages(self) -> Iterator[Page]:
        return iter(self.pages)

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Project":
        return cls(**data)