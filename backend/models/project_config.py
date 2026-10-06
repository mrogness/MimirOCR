from pydantic import BaseModel, Field

class IngestionConfig(BaseModel):
    dpi: int = 300
    binarization_threshold: int = 170
    
class SegmentationConfig(BaseModel):
    seg_raises_error: bool = False
    strict_top_to_bottom: bool = False

class OCRConfig(BaseModel):
    model_path: str = "backend/ml/calamari/r10.ckpt"
    disambiguate_ij: bool = True
    
class ProjectConfig(BaseModel):
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
