import os
import subprocess
import sys


def test_individual_routes_do_not_load_ocr_or_pdf_runtimes():
    # A fresh interpreter ensures another test's imports cannot hide a regression.
    result = subprocess.run([
        sys.executable, "-c",
        "import sys; "
        "import backend.api.routes.health, backend.api.routes.system, backend.api.routes.lines; "
        "forbidden = {'torch', 'tensorflow', 'kraken', 'calamari_ocr', 'coremltools', 'reportlab', 'fitz'}; "
        "assert not forbidden.intersection(sys.modules), forbidden.intersection(sys.modules)",
    ], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_api_and_worker_entrypoints_import_without_ml():
    for module in ("backend.main", "backend.workers.segmenter.__main__", "backend.workers.recognizer.__main__"):
        result = subprocess.run([
            sys.executable, "-c",
            f"import {module}; import sys; "
            "forbidden = {'torch', 'tensorflow', 'kraken', 'calamari_ocr', 'coremltools'}; "
            "assert not forbidden.intersection(sys.modules), forbidden.intersection(sys.modules)",
        ], capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr


def test_worker_implementations_do_not_import_api_or_persistence():
    result = subprocess.run([
        sys.executable, "-c",
        "import backend.workers.segmenter.engine, backend.workers.recognizer.engine; "
        "import sys; "
        "forbidden = {'fastapi', 'sqlalchemy', 'torch', 'tensorflow', 'kraken', 'calamari_ocr'}; "
        "assert not forbidden.intersection(sys.modules), forbidden.intersection(sys.modules)",
    ], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_orm_model_import_does_not_initialize_database(tmp_path):
    result = subprocess.run([
        sys.executable, "-c",
        "import backend.persistence.models; import sys; "
        "assert 'backend.persistence.database' not in sys.modules",
    ], capture_output=True, text=True, timeout=30,
        env={**os.environ, "MIMIR_APP_DATA_DIR": str(tmp_path / "data")})
    assert result.returncode == 0, result.stderr
    assert not (tmp_path / "data").exists()


def test_worker_module_launchers_support_help_without_ml():
    for role in ("segmenter", "recognizer"):
        result = subprocess.run([
            sys.executable, "-m", f"backend.workers.{role}", "--help",
        ], capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        assert f"Mimir {role} worker" in result.stdout
