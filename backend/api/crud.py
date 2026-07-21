import json
from datetime import datetime
import datetime as dt
from pathlib import Path
import shutil
from typing import Any

from sqlalchemy.orm import Session

from backend.database import Line, Page, Project
from backend.models.page import Page as PipelinePage
from backend.runtime_paths import get_output_dir


def _utcnow():
    return datetime.now(dt.timezone.utc)


def _touch_project(project: Project | None) -> None:
    if project is not None:
        project.date_modified = _utcnow()


def _extract_polygon_points(line: Any) -> list[list[float]] | None:
    meta = line.baseline_info if isinstance(line.baseline_info, dict) else {}
    boundary = meta.get("boundary") if isinstance(meta, dict) else None
    if not isinstance(boundary, list) or len(boundary) < 3:
        return None

    cleaned = []
    for point in boundary:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        x, y = point[0], point[1]
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            cleaned.append([float(x), float(y)])

    return cleaned if len(cleaned) >= 3 else None


def _persist_image_asset(source_path: str | None, destination_path: Path) -> str | None:
    if not source_path:
        return None

    source = Path(source_path)
    if not source.exists() or not source.is_file():
        return source_path

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(source, destination_path)
    except OSError:
        return source_path

    return str(destination_path.resolve())


def create_project(db: Session, name: str) -> Project:
    project = Project(name=name)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def get_project(db: Session, project_id: int) -> Project | None:
    return db.query(Project).filter(Project.id == project_id).first()


def list_projects(db: Session) -> list[Project]:
    return db.query(Project).order_by(Project.date_modified.desc()).all()


def update_project_name(db: Session, project: Project, name: str) -> Project:
    project.name = name
    _touch_project(project)
    db.commit()
    db.refresh(project)
    return project


def update_project_source_pdf(db: Session, project: Project, source_pdf_name: str, source_pdf_path: str) -> Project:
    project.source_pdf_name = source_pdf_name
    project.source_pdf_path = source_pdf_path
    _touch_project(project)
    db.commit()
    db.refresh(project)
    return project


def mark_project_ocr_started(db: Session, project: Project) -> Project:
    project.ocr_run_count = (project.ocr_run_count or 0) + 1
    project.ocr_last_status = "running"
    project.ocr_last_elapsed_seconds = None
    _touch_project(project)
    db.commit()
    db.refresh(project)
    return project


def mark_project_ocr_finished(db: Session, project: Project, status: str, elapsed_seconds: float) -> Project:
    project.ocr_last_status = status
    project.ocr_last_elapsed_seconds = elapsed_seconds
    _touch_project(project)
    db.commit()
    db.refresh(project)
    return project


def replace_project_pages_and_lines(
    db: Session,
    project: Project,
    pages: list[PipelinePage],
    *,
    source_pdf_name: str | None = None,
    source_pdf_path: str | None = None,
) -> None:
    existing_pages = db.query(Page).filter(Page.project_id == project.id).all()
    for existing_page in existing_pages:
        for existing_line in list(existing_page.lines):
            db.delete(existing_line)
        db.delete(existing_page)
    db.flush()

    if source_pdf_name is not None:
        project.source_pdf_name = source_pdf_name
    if source_pdf_path is not None:
        project.source_pdf_path = source_pdf_path
    _touch_project(project)

    assets_root = get_output_dir() / str(project.id) / "assets"
    pages_assets_dir = assets_root / "pages"
    lines_assets_dir = assets_root / "lines"

    for page in sorted(pages, key=lambda p: p.page_number):
        page_filename = f"{page.page_number + 1:04d}.png"
        persisted_page_path = _persist_image_asset(page.image_path, pages_assets_dir / page_filename)

        page_row = Page(
            project_id=project.id,
            page_number=page.page_number,
            img_path=persisted_page_path,
            height=page.height,
            width=page.width,
            rotation=int(page.rotation),
        )
        db.add(page_row)
        db.flush()

        ordered_lines = page.ordered_lines()
        for idx, line in enumerate(ordered_lines, start=1):
            polygon_points = _extract_polygon_points(line)
            line_filename = f"{page.page_number + 1:04d}_{idx:04d}.png"
            persisted_line_path = _persist_image_asset(line.image_path, lines_assets_dir / line_filename)
            db.add(
                Line(
                    page_id=page_row.id,
                    img_path=persisted_line_path,
                    bounding_box=json.dumps(line.bbox) if line.bbox else None,
                    polygon_points=json.dumps(polygon_points) if polygon_points else None,
                    ocr_text=line.ocr_text,
                    corrected_text=line.correct_text,
                    line_confidence=line.confidence,
                    char_confidence=json.dumps(line.char_confidence) if line.char_confidence else None,
                    char_positions=json.dumps(line.char_positions) if line.char_positions else None,
                    line_order=idx,
                )
            )

    db.commit()


def list_project_pages(db: Session, project_id: int) -> list[Page]:
    return (
        db.query(Page)
        .filter(Page.project_id == project_id)
        .order_by(Page.page_number.asc())
        .all()
    )


def get_project_page(db: Session, project_id: int, page_id: int) -> Page | None:
    return (
        db.query(Page)
        .filter(Page.project_id == project_id, Page.id == page_id)
        .first()
    )


def get_line(db: Session, line_id: int) -> Line | None:
    return db.query(Line).filter(Line.id == line_id).first()


def get_line_by_page_and_order(db: Session, page_id: int, line_order: int) -> Line | None:
    return (
        db.query(Line)
        .filter(Line.page_id == page_id, Line.line_order == line_order)
        .first()
    )


def update_line(db: Session, line: Line, corrected_text: str, line_order: int | None = None) -> Line:
    line.corrected_text = corrected_text
    if line_order is not None and line_order > 0:
        line.line_order = line_order

    page = line.page
    _touch_project(page.project if page else None)

    db.commit()
    db.refresh(line)
    return line


def delete_line(db: Session, line: Line) -> None:
    page = line.page
    _touch_project(page.project if page else None)
    db.delete(line)
    db.commit()


def delete_project(db: Session, project: Project) -> None:
    db.delete(project)
    db.commit()
