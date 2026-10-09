"""Source moves must preserve development and bundled resource discovery."""
from pathlib import Path
import sys

from backend.runtime import paths
from backend.workers.recognizer import engine, ij_disambiguation


def test_development_model_path_is_repo_relative_from_another_directory(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    module = root / "backend/workers/recognizer/engine.py"
    module.parent.mkdir(parents=True)
    checkpoint = root / "backend/ml/calamari/test.ckpt"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_text("checkpoint")
    monkeypatch.setattr(engine, "__file__", str(module))
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.chdir(tmp_path)
    assert engine._resolve_model_path("backend/ml/calamari/test.ckpt") == str(checkpoint)


def test_bundled_model_and_lexicon_use_existing_resource_paths(tmp_path, monkeypatch):
    bundle = tmp_path / "_internal"
    checkpoint = bundle / "backend/ml/calamari/test.ckpt"
    lexicon = bundle / "backend/resources/fraktur_ij_lexicon.txt"
    for path in (checkpoint, lexicon):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("resource")
    monkeypatch.setattr(sys, "_MEIPASS", str(bundle), raising=False)
    monkeypatch.chdir(tmp_path)
    assert engine._resolve_model_path("backend/ml/calamari/test.ckpt") == str(checkpoint)
    assert ij_disambiguation._lexicon_path() == lexicon


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
