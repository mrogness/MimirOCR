"""Resolve data, cache, upload, database, and temporary paths from runtime environment
overrides or development defaults."""
import os
from pathlib import Path


_REPO_BACKEND_DIR = Path(__file__).resolve().parents[1]


def _env_path(name: str) -> Path | None:
    """Expand a nonblank path override from the environment, or return None when it is unset."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def get_app_data_dir() -> Path:
    # Persistent app data location (DB, uploads, durable OCR artifacts).
    """Resolve persistent data storage from MIMIR_APP_DATA_DIR or the backend/data development
    directory.
    """
    return _env_path("MIMIR_APP_DATA_DIR") or (_REPO_BACKEND_DIR / "data")


def get_cache_dir() -> Path:
    # Cache/runtime outputs that can be rebuilt.
    """Resolve rebuildable cache storage from MIMIR_CACHE_DIR or the backend/output development
    directory.
    """
    return _env_path("MIMIR_CACHE_DIR") or (_REPO_BACKEND_DIR / "output")


def get_temp_dir() -> Path:
    # Ephemeral working files for in-flight OCR jobs.
    """Resolve per-run working storage from MIMIR_TEMP_DIR or the backend/tmp development
    directory.
    """
    return _env_path("MIMIR_TEMP_DIR") or (_REPO_BACKEND_DIR / "tmp")


def get_uploads_dir() -> Path:
    """Return the uploads subdirectory of persistent application data without creating it."""
    return get_app_data_dir() / "uploads"


def get_output_dir() -> Path:
    """Return the output subdirectory of cache storage without creating it."""
    return get_cache_dir() / "output"


def get_db_path() -> Path:
    """Return the SQLite database path inside persistent application data."""
    return get_app_data_dir() / "app_data.db"


def ensure_runtime_dirs() -> None:
    """Create the configured data, cache, temporary, upload, and output directories if needed."""
    get_app_data_dir().mkdir(parents=True, exist_ok=True)
    get_cache_dir().mkdir(parents=True, exist_ok=True)
    get_temp_dir().mkdir(parents=True, exist_ok=True)
    get_uploads_dir().mkdir(parents=True, exist_ok=True)
    get_output_dir().mkdir(parents=True, exist_ok=True)
