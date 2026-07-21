import os
from pathlib import Path


_REPO_BACKEND_DIR = Path(__file__).resolve().parent


def _env_path(name: str) -> Path | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def get_app_data_dir() -> Path:
    # Persistent app data location (DB, uploads, durable OCR artifacts).
    return _env_path("MIMIR_APP_DATA_DIR") or (_REPO_BACKEND_DIR / "data")


def get_cache_dir() -> Path:
    # Cache/runtime outputs that can be rebuilt.
    return _env_path("MIMIR_CACHE_DIR") or (_REPO_BACKEND_DIR / "output")


def get_temp_dir() -> Path:
    # Ephemeral working files for in-flight OCR jobs.
    return _env_path("MIMIR_TEMP_DIR") or (_REPO_BACKEND_DIR / "tmp")


def get_uploads_dir() -> Path:
    return get_app_data_dir() / "uploads"


def get_output_dir() -> Path:
    return get_cache_dir() / "output"


def get_db_path() -> Path:
    return get_app_data_dir() / "app_data.db"


def ensure_runtime_dirs() -> None:
    get_app_data_dir().mkdir(parents=True, exist_ok=True)
    get_cache_dir().mkdir(parents=True, exist_ok=True)
    get_temp_dir().mkdir(parents=True, exist_ok=True)
    get_uploads_dir().mkdir(parents=True, exist_ok=True)
    get_output_dir().mkdir(parents=True, exist_ok=True)
