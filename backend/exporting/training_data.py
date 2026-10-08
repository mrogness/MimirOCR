"""Training-data ZIP generation independent of database queries and HTTP."""
import re
from io import BytesIO
from pathlib import Path
import zipfile

from backend.exporting.common import ExportArtifact, ExportError

def _slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower())
    text = text.strip("-")
    return text or "project"


def _clean_basename(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "_", (value or "").strip())
    text = text.strip("_")
    return text or "line"


def _line_training_text(line) -> str:
    corrected = getattr(line, "corrected_text", None)
    predicted = getattr(line, "ocr_text", None)
    value = corrected if corrected not in (None, "") else predicted
    return "" if value is None else str(value)


def build_training_data(project_id: int, project_name: str, db_pages: list) -> ExportArtifact:
    """Write the existing PNG/ground-truth pairs into a training archive."""
    if not db_pages:
        raise ExportError(status_code=400, detail="No OCR pages available for training data export")

    archive_buffer = BytesIO()
    exported_pairs = 0
    project_slug = _slugify(project_name)
    root_dir = f"project_{project_id}_{project_slug}"

    with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for page in db_pages:
            ordered_lines = sorted(page.lines, key=lambda line: ((line.line_order or 10**9), line.id))
            for index, line in enumerate(ordered_lines, start=1):
                image_path_raw = getattr(line, "img_path", None)
                if not image_path_raw:
                    continue

                image_path = Path(image_path_raw)
                if not image_path.exists() or not image_path.is_file():
                    continue

                line_order = line.line_order if isinstance(line.line_order, int) and line.line_order > 0 else index
                line_id_part = _clean_basename(str(getattr(line, "id", "line")))
                base_name = (
                    f"proj{project_id:04d}_"
                    f"p{page.page_number + 1:04d}_"
                    f"l{line_order:04d}_"
                    f"{line_id_part}"
                )

                image_arcname = f"{root_dir}/{base_name}.png"
                text_arcname = f"{root_dir}/{base_name}.gt.txt"

                archive.write(image_path, arcname=image_arcname)
                archive.writestr(text_arcname, _line_training_text(line).encode("utf-8"))
                exported_pairs += 1

    if exported_pairs == 0:
        raise ExportError(status_code=400, detail="No line image/text pairs available for training data export")

    archive_buffer.seek(0)
    filename = f"project_{project_id}_{project_slug}_training_data.zip"
    return ExportArtifact(archive_buffer, filename, "application/zip")
