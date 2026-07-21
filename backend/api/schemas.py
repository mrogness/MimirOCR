from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectBase(BaseModel):
    name: str


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date_created: datetime
    date_modified: datetime
    source_pdf_path: str | None = None
    source_pdf_name: str | None = None
    ocr_run_count: int = 0
    ocr_last_status: str | None = None
    ocr_last_elapsed_seconds: float | None = None


class ProjectsListResponse(BaseModel):
    projects: list[ProjectRead]


class ProjectLineRead(BaseModel):
    id: int
    page_id: int | None = None
    line_order: int | None = None
    img_path: str | None = None
    bounding_box: dict[str, int] | None = None
    polygon_points: list[list[float]] | None = None
    ocr_text: str | None = None
    corrected_text: str | None = None
    line_confidence: float | None = None
    char_confidence: str | None = None
    char_positions: list[dict[str, Any]] | None = None


class LineUpdateRequest(BaseModel):
    corrected_text: str
    page_id: int | None = None
    line_order: int | None = None


class LineUpdateResponse(BaseModel):
    line: ProjectLineRead


class ProjectPageRead(BaseModel):
    id: int
    page_number: int
    img_path: str | None = None
    width: int | None = None
    height: int | None = None
    rotation: int | None = None
    lines: list[ProjectLineRead]


class ProjectPagesResponse(BaseModel):
    project_id: int
    pages: list[ProjectPageRead]


class UploadedPdfResponse(BaseModel):
    upload_id: str
    project_id: int
    filename: str
    message: str


class OCRConfigOverride(BaseModel):
    dpi: int | None = None
    binarization_threshold: int | None = None
    num_workers: int | None = None
    device: str | None = None
    ocr_model_path: str | None = None
    strict_top_to_bottom: bool | None = None


class OcrJobStartRequest(BaseModel):
    upload_id: str
    config: OCRConfigOverride = Field(default_factory=OCRConfigOverride)


class OcrJobResponse(BaseModel):
    job_id: str
    project_id: int
    upload_id: str
    status: str
    phase: str
    progress: int
    message: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    transcript_path: str | None = None
    project_json_path: str | None = None
    total_pages: int | None = None
    rasterized_pages: int | None = None
    segmented_pages: int | None = None
    ocr_pages: int | None = None


class OcrJobsListResponse(BaseModel):
    jobs: list[OcrJobResponse]


class ExportPdfRequest(BaseModel):
    font_family: Literal["Times-Roman", "Helvetica", "Courier"] = "Times-Roman"
    font_size: float = 12.0
    line_spacing: float = 1.35
    margin_in: float = 0.8
    spread_mode: Literal["single", "split-spread"] = "split-spread"
    normalize_low_double_quote: bool = False
    normalize_long_s: bool = False
    normalize_double_oblique_hyphen: bool = False
    fit_text_to_page: bool = True
    page_size: Literal["letter", "a4"] = "letter"
