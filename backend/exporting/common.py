"""Export results and errors independent of HTTP response construction."""
from dataclasses import dataclass
from io import BytesIO


@dataclass
class ExportArtifact:
    buffer: BytesIO
    filename: str
    media_type: str


class ExportError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
