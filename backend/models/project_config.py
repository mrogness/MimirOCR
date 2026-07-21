from typing import Union
from typing import Any

from pydantic import BaseModel

class IngestionConfig(BaseModel):
    dpi: int = 300
    binarization_threshold: int = 170
    
class SegmentationConfig(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    seg_raises_error: bool = False
    strict_top_to_bottom: bool = False
    mask: Union[Any, None] = None  # numpy ndarray region mask for kraken; not JSON-serialisable

class OCRConfig(BaseModel):
    model_path: str = "backend/ml/calamari/r10.ckpt"
    
class ProjectConfig(BaseModel):
    #general settings
    project_name: str = "default_project"
    project_id: str = "default_project_id"
    input_pdf_path: str = "input.pdf"
    temp_dir: str = "tmp/"
    output_dir: str = "output/"
    num_workers: int = 4
    device: str = "cpu"
    logger: Union[Any, None] = None
    
    #ingestion settings
    ingestion: IngestionConfig = IngestionConfig()
    
    #segmentation settings
    segmentation: SegmentationConfig = SegmentationConfig()
    
    #ocr settings
    ocr: OCRConfig = OCRConfig()
    
    