"""SQLite setup and schema initialization for the API runtime."""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.persistence.models import Base
from backend.runtime.paths import ensure_runtime_dirs, get_db_path

ensure_runtime_dirs()
db_path = get_db_path()
engine = create_engine(
    f"sqlite:///{db_path}",
    connect_args={"check_same_thread": False},
)
Base.metadata.create_all(engine)


def _has_column(connection, table_name: str, column_name: str) -> bool:
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return any(row[1] == column_name for row in rows)


def _ensure_column(connection, table_name: str, column_name: str, column_type: str) -> None:
    if _has_column(connection, table_name, column_name):
        return
    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))


def ensure_schema() -> None:
    with engine.begin() as connection:
        _ensure_column(connection, "projects", "source_pdf_path", "VARCHAR")
        _ensure_column(connection, "projects", "source_pdf_name", "VARCHAR")
        _ensure_column(connection, "projects", "ocr_run_count", "INTEGER")
        _ensure_column(connection, "projects", "ocr_last_status", "VARCHAR")
        _ensure_column(connection, "projects", "ocr_last_elapsed_seconds", "FLOAT")
        _ensure_column(connection, "lines", "line_order", "INTEGER")
        _ensure_column(connection, "lines", "polygon_points", "VARCHAR")
        _ensure_column(connection, "lines", "char_positions", "VARCHAR")
        connection.execute(text("UPDATE projects SET ocr_run_count = 0 WHERE ocr_run_count IS NULL"))
        connection.execute(text("UPDATE projects SET date_created = CURRENT_TIMESTAMP WHERE date_created IS NULL"))
        connection.execute(text("UPDATE projects SET date_modified = CURRENT_TIMESTAMP WHERE date_modified IS NULL"))


ensure_schema()
Session = sessionmaker(bind=engine)
