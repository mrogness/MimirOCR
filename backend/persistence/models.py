"""SQLAlchemy project, page, and line tables backing persisted review data. Domain worker
records and HTTP schemas are defined separately."""
from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime
import datetime as dt


Base = declarative_base()

class Project(Base):
    """Persistent project metadata and aggregate relationships to source pages."""
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
    """A persisted rasterized page and its review lines, owned by one project."""
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
    """Review text, ordering, geometry, and serialized recognition metadata."""
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
