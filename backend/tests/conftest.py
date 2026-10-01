"""Keep even import-time database initialization away from real user data."""
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest


def pytest_configure(config):
    # Fixtures run too late: database.py initializes its database during collection.
    temporary = TemporaryDirectory(prefix="mimir-tests-")
    patch = pytest.MonkeyPatch()
    for name, directory in (
        ("MIMIR_APP_DATA_DIR", "data"),
        ("MIMIR_CACHE_DIR", "cache"),
        ("MIMIR_TEMP_DIR", "tmp"),
    ):
        patch.setenv(name, str(Path(temporary.name) / directory))
    config._mimir_test_runtime = (temporary, patch)


def pytest_unconfigure(config):
    runtime = getattr(config, "_mimir_test_runtime", None)
    if runtime is not None:
        database = sys.modules.get("backend.database")
        if database is not None:
            database.engine.dispose()  # Release SQLite handles before Windows cleanup.
        temporary, patch = runtime
        patch.undo()
        temporary.cleanup()


@pytest.fixture
def line_client():
    """Real routes, validation and CRUD; a fresh SQLite database per test."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from backend.api.deps import get_db
    from backend.api.routes.lines import router
    from backend.database import Base, Line, Page, Project

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.add(Project(id=1, name="Test book"))
        db.add_all([Page(id=10, project_id=1, page_number=0), Page(id=20, project_id=1, page_number=1)])
        db.add_all([
            Line(id=101, page_id=10, line_order=1, ocr_text="Første linje"),
            Line(id=102, page_id=10, line_order=2, ocr_text="Anden linje"),
            Line(id=201, page_id=20, line_order=1, ocr_text="Other page"),
        ])
        db.commit()

    def override_db():
        with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client, sessions
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
