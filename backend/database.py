from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, ForeignKey, text
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime
import datetime as dt

from backend.runtime_paths import ensure_runtime_dirs, get_db_path

Base = declarative_base()

class Project(Base):
    __tablename__ = 'projects'
    
    id = Column(Integer, primary_key=True)
    name = Column(String)
    date_created = Column(DateTime, default=lambda: datetime.now(dt.timezone.utc))
    date_modified = Column(
        DateTime,
        default=lambda: datetime.now(dt.timezone.utc),
        onupdate=lambda: datetime.now(dt.timezone.utc),
    )
    source_pdf_path = Column(String, nullable=True)
    source_pdf_name = Column(String, nullable=True)
    ocr_run_count = Column(Integer, default=0)
    ocr_last_status = Column(String, nullable=True)
    ocr_last_elapsed_seconds = Column(Float, nullable=True)
    
    # Relationship to Pages
    pages = relationship("Page", back_populates="project", cascade="all, delete-orphan")

class Page(Base):
    __tablename__ = 'pages'
    
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id'))
    page_number = Column(Integer)
    img_path = Column(String)
    height = Column(Integer)
    width = Column(Integer)
    rotation = Column(Integer)
    
    # Relationships
    project = relationship("Project", back_populates="pages")
    lines = relationship("Line", back_populates="page", cascade="all, delete-orphan")

class Line(Base):
    __tablename__ = 'lines'
    
    id = Column(Integer, primary_key=True)
    page_id = Column(Integer, ForeignKey('pages.id'))
    img_path = Column(String)
    bounding_box = Column(String) # Consider storing as JSON string if complex
    ocr_text = Column(String)
    corrected_text = Column(String)
    line_confidence = Column(Float)
    char_confidence = Column(String)
    char_positions = Column(String)
    line_order = Column(Integer)
    polygon_points = Column(String)
    
    # Relationship
    page = relationship("Page", back_populates="lines")

# Database Setup
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


ensure_schema()
Session = sessionmaker(bind=engine)