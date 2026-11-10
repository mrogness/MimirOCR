"""Export results and errors independent of HTTP response construction."""
from dataclasses import dataclass
from io import BytesIO


@dataclass
class ExportArtifact:
    """An in-memory download buffer paired with its attachment filename and media type."""
    buffer: BytesIO
    filename: str
    media_type: str


class ExportError(Exception):
    """An export failure carrying the HTTP status and user-facing detail for route adapters."""
    def __init__(self, status_code: int, detail: str):
        """Store the status and detail while using the detail as the exception message."""
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
