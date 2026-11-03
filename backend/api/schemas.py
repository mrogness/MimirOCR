"""HTTP request and response models for projects, review, jobs, and exports.

These Pydantic models define the frontend/backend boundary. They are distinct
from the domain records serialized to workers and from SQLAlchemy rows.
"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectBase(BaseModel):
    """Shared project name field used by creation, update, and read schemas."""
    name: str


class ProjectCreate(ProjectBase):
    """JSON body containing the display name for a new persistent project."""
    pass


class ProjectUpdate(BaseModel):
    """Replacement project name accepted by the project update endpoint."""
    name: str


class ProjectRead(ProjectBase):
    """Persistent project metadata, source-file information, and most recent OCR-run summary."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    date_created: datetime | None = None
    date_modified: datetime | None = None
    source_pdf_path: str | None = None
    source_pdf_name: str | None = None
    ocr_run_count: int = 0
    ocr_last_status: str | None = None
    ocr_last_elapsed_seconds: float | None = None


class ProjectsListResponse(BaseModel):
    """Collection envelope for project metadata returned by the dashboard endpoint."""
    projects: list[ProjectRead]


class ProjectLineRead(BaseModel):
    """Persisted review line with text, geometry, and recognition metadata."""
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
    """Corrected transcription and optional page/order identifiers for a review-line write."""
    corrected_text: str
    page_id: int | None = None
    line_order: int | None = None


class LineUpdateResponse(BaseModel):
    """Envelope containing the committed line returned after a review edit."""
    line: ProjectLineRead


class LineOrderSnapshot(BaseModel):
    """Saved line ID and order used to restore a page's arrangement during undo."""
    id: int
    line_order: int


class DeletedLineSnapshot(BaseModel):
    """Serializable review-line contents needed to restore a deletion, including recognition
    metadata.
    """
    id: int
    page_id: int
    line_order: int | None = None
    img_path: str | None = None
    bounding_box: dict[str, Any] | None = None
    polygon_points: list[list[float]] | None = None
    ocr_text: str | None = None
    corrected_text: str | None = None
    line_confidence: float | None = None
    char_confidence: Any | None = None
    char_positions: list[dict[str, Any]] | None = None


class LineRestoreRequest(BaseModel):
    """Deleted line snapshot and page-order snapshot submitted by the undo workflow."""
    line: DeletedLineSnapshot
    line_orders: list[LineOrderSnapshot]


class LineRestoreResponse(BaseModel):
    """Envelope containing the restored persistent line and its review metadata."""
    line: ProjectLineRead


class ProjectPageRead(BaseModel):
    """Persisted page dimensions, image location, and review lines returned to the frontend."""
    id: int
    page_number: int
    img_path: str | None = None
    width: int | None = None
    height: int | None = None
    rotation: int | None = None
    lines: list[ProjectLineRead]


class ProjectPagesResponse(BaseModel):
    """Project-scoped page collection consumed by the review workspace."""
    project_id: int
    pages: list[ProjectPageRead]


class UploadedPdfResponse(BaseModel):
    """Upload token and stored-file metadata returned before OCR job submission."""
    upload_id: str
    project_id: int
    filename: str
    message: str


class PdfDpiAnalysisResponse(BaseModel):
    """Estimated scan resolution, recommended ingestion DPI, confidence, and analysis warnings."""
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1)
    page_count: int = Field(ge=1)
    pages_analyzed: int = Field(ge=0)
    pages_with_scan_estimate: int = Field(ge=0)
    detected_median_dpi: int | None = Field(default=None, ge=1)
    detected_min_dpi: int | None = Field(default=None, ge=1)
    detected_max_dpi: int | None = Field(default=None, ge=1)
    recommended_dpi: int = Field(ge=1)
    confidence: Literal["high", "medium", "low", "unavailable"]
    ignored_probable_watermark_images: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)


class OCRConfigOverride(BaseModel):
    """Optional per-run values overriding the backend's project defaults."""
    dpi: int | None = Field(default=None, ge=1)
    binarization_threshold: int | None = Field(default=None, ge=1, le=256)
    device: str | None = None
    ocr_model_path: str | None = None
    strict_top_to_bottom: bool | None = None
    disambiguate_ij: bool | None = None


class OcrJobStartRequest(BaseModel):
    """Stored upload token and optional configuration overrides for a new OCR run."""
    upload_id: str
    config: OCRConfigOverride = Field(default_factory=OCRConfigOverride)


class OcrJobResponse(BaseModel):
    """Polling snapshot with lifecycle status, phase, progress, and page counts."""
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
    """Collection envelope for the retained OCR jobs belonging to a project."""
    jobs: list[OcrJobResponse]


class ExportPdfRequest(BaseModel):
    """PDF layout and normalization choices sent by the export settings sheet.

    Font sizes are points, margins are inches, and line_spacing is a font-size
    multiplier. Export code owns the rendering rules for each layout mode.
    """
    layout_mode: Literal["source-lines", "reading"] = "source-lines"
    font_family: Literal["Times-Roman", "Helvetica", "Courier"] = "Times-Roman"
    font_size: float = 12.0
    line_spacing: float = 1.35
    margin_in: float = 0.8
    spread_mode: Literal["single", "split-spread"] = "split-spread"
    join_historical_line_breaks: bool = True
    normalize_low_double_quote: bool = False
    normalize_long_s: bool = False
    normalize_double_oblique_hyphen: bool = False
    fit_text_to_page: bool = True
    page_size: Literal["letter", "a4"] = "letter"
