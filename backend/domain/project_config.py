"""Typed run configuration serialized to both isolated worker runtimes."""
from pydantic import BaseModel, Field

DEFAULT_OCR_MODEL_PATH = "backend/ml/calamari/r10.ckpt"

class IngestionConfig(BaseModel):
    """Rasterization resolution in DPI and line-crop binarization threshold."""
    dpi: int = 300
    binarization_threshold: int = 170

class SegmentationConfig(BaseModel):
    """Segmentation options, including the optional geometric reading-order override."""
    seg_raises_error: bool = False
    strict_top_to_bottom: bool = False

class OCRConfig(BaseModel):
    """Calamari checkpoint location and optional lexicon-based I/J correction."""
    model_path: str = DEFAULT_OCR_MODEL_PATH
    disambiguate_ij: bool = True

class ProjectConfig(BaseModel):
    """Paths, concurrency, device selection, and stage settings for one run.

    PipelineRunner copies this object and resolves worker-facing paths. Runtime
    performance profiles supply worker/thread limits before a run is started.
    """
    #general settings
    project_name: str = "default_project"
    project_id: str = "default_project_id"
    input_pdf_path: str = "input.pdf"
    temp_dir: str = "tmp/"
    output_dir: str = "output/"
    num_workers: int = Field(default=4, ge=1)
    device: str = "cpu"

    #ingestion settings
    ingestion: IngestionConfig = Field(default_factory=IngestionConfig)

    #segmentation settings
    segmentation: SegmentationConfig = Field(default_factory=SegmentationConfig)

    #ocr settings
    ocr: OCRConfig = Field(default_factory=OCRConfig)
