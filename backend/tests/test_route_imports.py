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
