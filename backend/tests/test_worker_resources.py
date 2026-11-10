"""Source moves must preserve development and bundled resource discovery."""
from pathlib import Path
import sys

import pytest

from backend.domain.project_config import DEFAULT_OCR_MODEL_PATH
from backend.runtime import paths
from backend.workers.recognizer import engine, ij_disambiguation


def test_development_model_path_is_repo_relative_from_another_directory(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    module = root / "backend/workers/recognizer/engine.py"
    module.parent.mkdir(parents=True)
    monkeypatch.setattr(engine, "__file__", str(module))
    monkeypatch.chdir(tmp_path)
    assert engine._resolve_model_path(DEFAULT_OCR_MODEL_PATH) == str(root / DEFAULT_OCR_MODEL_PATH)


def test_bundled_model_and_lexicon_use_existing_resource_paths(tmp_path, monkeypatch):
    bundle = tmp_path / "_internal"
    checkpoint = bundle / DEFAULT_OCR_MODEL_PATH
    lexicon = bundle / "backend/resources/fraktur_ij_lexicon.txt"
    shadow = tmp_path / f"{DEFAULT_OCR_MODEL_PATH}.keras"
    for path in (Path(f"{checkpoint}.keras"), lexicon, shadow):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("resource")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(bundle), raising=False)
    monkeypatch.chdir(tmp_path)
    assert engine._resolve_model_path(DEFAULT_OCR_MODEL_PATH) == str(checkpoint)
    assert ij_disambiguation._lexicon_path() == lexicon


def test_custom_model_must_match_the_locally_trusted_checkpoint(tmp_path, monkeypatch):
    checkpoint = tmp_path / "custom.ckpt"
    monkeypatch.delenv("MIMIR_TRUSTED_OCR_MODEL", raising=False)
    with pytest.raises(ValueError, match="MIMIR_TRUSTED_OCR_MODEL"):
        engine._resolve_model_path(str(checkpoint))

    monkeypatch.setenv("MIMIR_TRUSTED_OCR_MODEL", f"{checkpoint}.json")
    assert engine._resolve_model_path(f"{checkpoint}.keras") == str(checkpoint)
    with pytest.raises(ValueError, match="MIMIR_TRUSTED_OCR_MODEL"):
        engine._resolve_model_path(str(tmp_path / "different.ckpt"))


def test_development_lexicon_remains_available(tmp_path, monkeypatch):
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.chdir(tmp_path)
    lexicon = ij_disambiguation._lexicon_path()
    assert lexicon == Path(__file__).resolve().parents[1] / "resources/fraktur_ij_lexicon.txt"
    assert lexicon.is_file()


def test_default_runtime_directories_remain_under_backend(monkeypatch):
    for name in ("MIMIR_APP_DATA_DIR", "MIMIR_CACHE_DIR", "MIMIR_TEMP_DIR"):
        monkeypatch.delenv(name, raising=False)
    backend = Path(__file__).resolve().parents[1]
    assert paths.get_app_data_dir() == backend / "data"
    assert paths.get_db_path() == backend / "data/app_data.db"
    assert paths.get_cache_dir() == backend / "output"
    assert paths.get_output_dir() == backend / "output/output"
    assert paths.get_temp_dir() == backend / "tmp"
