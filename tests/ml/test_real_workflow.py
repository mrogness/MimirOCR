"""CPU integration tests using the actual, separately installed ML workers.

Run through `yarn test:ml` after `python scripts/setup_backend.py --dev`.
These tests deliberately fail if a dependency or model is missing.
"""
import math
from pathlib import Path
import subprocess
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont
import pytest

from backend.domain.line import Line
from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers.client import WorkerClient

ROOT = Path(__file__).resolve().parents[2]
TEXT = (
    "Norske Eventyr og Fortællinger.",
    "Den gamle Mand gik til Byen.",
    "Et lille Barn sad ved Vinduet.",
    "Der var Lys i det gamle Hus.",
    "Alle Børnene kom tilbage.",
    "Nu begyndte den lange Reise.",
)
# A generous smoke-test limit for synthetic text, not a historical-page benchmark.
MAX_CER = 0.30


@pytest.fixture
def config(tmp_path, monkeypatch):
    work = tmp_path / "ML prøve with spaces"
    work.mkdir()
    for name, child in (("MIMIR_APP_DATA_DIR", "data"), ("MIMIR_CACHE_DIR", "cache"),
                        ("MIMIR_TEMP_DIR", "tmp")):
        monkeypatch.setenv(name, str(work / child))
    # TFAIP counts comma-separated entries; "-1" incorrectly selects one GPU.
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "")
    return ProjectConfig(
        project_name="Real worker test", project_id="ml-test", device="cpu", num_workers=1,
        temp_dir=str(work / "tmp"), output_dir=str(work / "output"),
        segmentation={"strict_top_to_bottom": True},
        ocr={"model_path": str(ROOT / "backend/ml/calamari/r10.ckpt"), "disambiguate_ij": False},
    )


def font(size):
    # Use an existing bundled font with a fixed layout engine on all runners.
    return ImageFont.truetype(str(ROOT / "public/fonts/BreitkopfFraktur.ttf"), size,
                              layout_engine=ImageFont.Layout.BASIC)


def character_error_rate(expected, actual):
    def normalize(text):
        return " ".join(unicodedata.normalize("NFC", text).replace("ſ", "s").split())

    expected, actual = normalize(expected), normalize(actual)
    previous = list(range(len(actual) + 1))
    for i, left in enumerate(expected, 1):
        current = [i]
        for j, right in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (left != right)))
        previous = current
    return previous[-1] / len(expected)


def test_real_segmenter_geometry_crops_reading_order_and_blank_page(config, tmp_path):
    image = Image.new("L", (1600, 1000), 255)
    draw = ImageDraw.Draw(image)
    for row, text in enumerate(TEXT):
        draw.text((100, 100 + row * 110), text, font=font(48), fill=0)
    image_path = tmp_path / "Fraktur prøve.png"
    image.save(image_path)
    page = Page(id="printed-page", page_number=0, image_path=str(image_path),
                width=image.width, height=image.height)

    with WorkerClient("segmenter", timeout=180) as worker:
        worker.initialize(config)
        pid = worker.process.pid
        result = worker.process_page(page)
        assert len(TEXT) - 1 <= len(result.lines) <= len(TEXT) + 1, result.model_dump()
        assert result.metadata["segmentation"]["line_count"] == len(result.lines)
        assert len({line.id for line in result.lines}) == len(result.lines)
        centers = []
        crop_root = Path(config.temp_dir).resolve()
        for order, line in enumerate(result.lines, 1):
            box = line.bbox
            assert 0 <= box["x_min"] < box["x_max"] <= image.width, box
            assert 0 <= box["y_min"] < box["y_max"] <= image.height, box
            centers.append((box["y_min"] + box["y_max"]) / 2)
            assert line.baseline_info["source_order"] == order
            assert Path(line.image_path).resolve().is_relative_to(crop_root)
            with Image.open(line.image_path) as crop:
                assert crop.width > 5 and crop.height > 2
                assert crop.mode == "1"
                assert crop.getextrema() == (0, 255), "Line crop must contain ink and background"
        assert centers == sorted(centers), centers
        assert max(centers) - min(centers) > 400, centers

        blank_path = tmp_path / "blank.png"
        Image.new("L", image.size, 255).save(blank_path)
        blank = worker.process_page(Page(id="blank-page", page_number=1,
                                         image_path=str(blank_path), width=image.width, height=image.height))
        assert blank.lines == []
        assert blank.metadata["segmentation"]["line_count"] == 0
        assert worker.process.pid == pid and worker.process.poll() is None
    assert worker.process.poll() is not None


def test_real_recognizer_known_crops_accuracy_metadata_and_reuse(config, tmp_path):
    # Independent crops ensure a segmentation regression cannot mask an OCR failure.
    lines = []
    for index, text in enumerate(TEXT[:3]):
        face = font(64)
        left, top, right, bottom = face.getbbox(text)
        image = Image.new("L", (right - left + 40, bottom - top + 32), 255)
        ImageDraw.Draw(image).text((20 - left, 16 - top), text, font=face, fill=0)
        image_path = tmp_path / f"known-line-{index}.png"
        image.point(lambda value: 255 if value > 170 else 0, mode="1").save(image_path)
        lines.append(Line(id=f"known-{index}", image_path=str(image_path),
                          bbox={"x_min": 0, "y_min": 0, "x_max": image.width, "y_max": image.height}))

    with WorkerClient("recognizer", timeout=180) as worker:
        worker.initialize(config)
        pid = worker.process.pid
        for number in range(2):
            result = worker.process_page(Page(id=f"known-page-{number}", page_number=number, lines=lines))
            assert [line.id for line in result.lines] == [line.id for line in lines]
            for expected, source, recognized in zip(TEXT, lines, result.lines):
                assert recognized.bbox == source.bbox
                assert recognized.image_path == source.image_path
                assert recognized.ocr_text and recognized.ocr_text.strip()
                cer = character_error_rate(expected, recognized.ocr_text)
                assert cer <= MAX_CER, f"CER {cer:.1%}: expected {expected!r}, got {recognized.ocr_text!r}"
                assert recognized.confidence is not None
                assert math.isfinite(recognized.confidence) and 0 <= recognized.confidence <= 1
                assert recognized.char_positions, "Character metadata was lost across the worker protocol"
            assert worker.process.pid == pid and worker.process.poll() is None
    assert worker.process.poll() is not None


def test_source_api_segmentation_ocr_and_persistence(config):
    # Reuse the release smoke scenario, including upload/job polling/saved results.
    report = ROOT / "test-results/ml/source-workflow.log"
    report.parent.mkdir(parents=True, exist_ok=True)
    with report.open("w", encoding="utf-8") as log:
        try:
            result = subprocess.run([sys.executable, "scripts/smoke_workers.py", "--source"],
                                    cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=720)
        except subprocess.TimeoutExpired:
            pytest.fail(f"Source API workflow timed out. See {report}")
    assert result.returncode == 0, report.read_text(encoding="utf-8", errors="replace")[-40000:]
