"""Kraken 7 adapter regressions; no ML libraries or model downloads required."""
from dataclasses import dataclass, field
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

from PIL import Image
import pytest

from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers.protocol import decode, encode
from backend.workers.segmenter import engine


@dataclass
class BaselineLine:
    id: str
    boundary: list
    baseline: list = field(default_factory=list)
    tags: dict = field(default_factory=dict)
    regions: list = field(default_factory=list)


@dataclass
class Region:
    id: str
    boundary: list


@dataclass
class Segmentation:
    lines: list = field(default_factory=list)
    regions: dict = field(default_factory=dict)
    line_orders: list = field(default_factory=list)


def line(identifier, x, y):
    return BaselineLine(
        id=identifier,
        boundary=[(x, y), (x + 20, y), (x + 20, y + 10), (x, y + 10)],
        baseline=[(x, y + 8), (x + 20, y + 8)],
        tags={"type": [{"type": "default"}]},
        regions=["text-region"],
    )


@pytest.fixture
def kraken_api(monkeypatch):
    """Model-free stand-ins for the public APIs used by the engine."""
    modules = {}
    for name in ("kraken", "kraken.configs", "kraken.containers", "kraken.tasks",
                 "kraken.ketos", "kraken.ketos.util", "kraken.lib", "kraken.lib.segmentation"):
        module = ModuleType(name)
        modules[name] = module
        monkeypatch.setitem(sys.modules, name, module)

    modules["kraken.containers"].Segmentation = Segmentation
    modules["kraken.configs"].SegmentationInferenceConfig = SimpleNamespace

    def to_ptl_device(device):
        if device in ("cpu", "mps", "auto"):
            return device, "auto"
        if device.startswith("cuda:"):
            return "gpu", [int(device.split(":")[1])]
        raise ValueError(f"Invalid device: {device}")

    modules["kraken.ketos.util"].to_ptl_device = to_ptl_device
    return modules


@pytest.mark.parametrize("model_path", [None, "/models/test.safetensors"])
def test_load_default_or_explicit_model_once(kraken_api, monkeypatch, model_path):
    loaded = []
    model = object()

    def load_model(path):
        loaded.append(path)
        return model

    kraken_api["kraken.tasks"].SegmentationTaskModel = SimpleNamespace(load_model=load_model)
    monkeypatch.delenv("MIMIR_SEGMENTER_MODEL", raising=False)
    if model_path:
        monkeypatch.setenv("MIMIR_SEGMENTER_MODEL", model_path)
    assert engine.create_segmenter() is model
    assert loaded == [model_path]


def test_neural_order_is_applied_without_mutating_geometry_or_source_order():
    lines = [line("bottom", 10, 50), line("top", 10, 10), line("middle", 10, 30)]
    seg = Segmentation(lines=lines, line_orders=[[0, 1, 2], [1, 2, 0]])
    ordered = engine._ordered_segmentation(seg, strict=False)
    assert ordered.lines == [lines[1], lines[2], lines[0]]
    assert ordered.lines[0] is lines[1]
    assert ordered.line_orders == []
    assert seg.lines is lines
    assert seg.line_orders == [[0, 1, 2], [1, 2, 0]]


@pytest.mark.parametrize("order", [[0], [0, 0], [-1, 0], [0, 2]])
def test_invalid_neural_order_cannot_drop_or_duplicate_lines(order):
    seg = Segmentation(lines=[line("a", 0, 0), line("b", 0, 20)], line_orders=[order])
    with pytest.raises(ValueError, match="every line exactly once"):
        engine._ordered_segmentation(seg, strict=False)


def test_strict_order_handles_region_dataclasses_and_overrides_neural_order():
    lines = [line("left-bottom", 2, 30), line("right-top", 55, 2), line("left-top", 2, 2)]
    seg = Segmentation(
        lines=lines,
        regions={"text": [
            Region("right", [(50, 0), (90, 0), (90, 50), (50, 50)]),
            Region("left", [(0, 0), (40, 0), (40, 50), (0, 50)]),
        ]},
        line_orders=[[1, 0, 2]],
    )
    ordered = engine._ordered_segmentation(seg, strict=True)
    assert [item.id for item in ordered.lines] == ["left-top", "left-bottom", "right-top"]
    assert ordered.line_orders == []
    assert ordered.lines[0] is lines[2]


@pytest.mark.parametrize("lines", [[], [line("a", 0, 20), line("b", 0, 0)]])
def test_no_additional_order_preserves_kraken_order(lines):
    seg = Segmentation(lines=lines)
    assert engine._ordered_segmentation(seg, strict=False) is seg


@pytest.mark.parametrize("device,accelerator,devices", [
    ("cpu", "cpu", "auto"), ("mps", "mps", "auto"),
    ("cuda", "gpu", [0]), ("cuda:2", "gpu", [2]),
])
def test_segment_preserves_crops_geometry_and_metadata_across_ipc(
    kraken_api, monkeypatch, tmp_path, device, accelerator, devices,
):
    source = tmp_path / "page.png"
    Image.new("L", (100, 100), 255).save(source)
    config = ProjectConfig(temp_dir=str(tmp_path / "crops"), device=device)
    config.ingestion.binarization_threshold = 170
    config.segmentation.seg_raises_error = True
    monkeypatch.setenv("MIMIR_SEGMENTATION_THREADS", "3")
    lines = [line("bottom", 10, 40), line("top", 10, 10)]
    seg = Segmentation(lines=lines, line_orders=[[1, 0]])
    seen = []

    def predict(*, im, config):
        seen.append(config)
        assert im.getpixel((0, 0)) == 255
        return seg

    def extract_polygons(im, bounds):
        assert isinstance(bounds, Segmentation)
        assert im.mode == "L" and im.getpixel((0, 0)) == 0
        for item in bounds.lines:
            # Inverted extraction output: threshold boundaries exercise both
            # inversion and line binarization before Calamari receives a crop.
            crop = Image.new("L", (4, 1))
            crop.putdata([255, 86, 85, 0])
            yield crop, item

    kraken_api["kraken.lib.segmentation"].extract_polygons = extract_polygons
    page = Page(id="page-1", page_number=7, image_path=str(source), width=100, height=100)
    result = engine.segment(page, config, SimpleNamespace(predict=predict))
    assert (result.id, result.page_number, result.image_path) == ("page-1", 7, str(source))
    assert len(seen) == 1
    assert (seen[0].accelerator, seen[0].device) == (accelerator, devices)
    assert seen[0].num_threads == 3 and seen[0].raise_on_error is True
    assert [item.id for item in result.lines] == ["page-1_line_1", "page-1_line_2"]
    assert result.lines[0].bbox == {"x_min": 10, "y_min": 10, "x_max": 30, "y_max": 20}
    for index, item in enumerate(result.lines, start=1):
        assert item.baseline_info["source_order"] == index
        assert item.baseline_info["baseline"]
        assert item.baseline_info["tags"] == {"type": [{"type": "default"}]}
        assert item.baseline_info["regions"] == ["text-region"]
        assert Path(item.image_path).name == f"{index:06d}.png"
        with Image.open(item.image_path) as crop:
            assert crop.mode == "1"
            assert [crop.getpixel((x, 0)) for x in range(4)] == [0, 0, 0, 255]
    restored = Page.model_validate(decode(encode({"version": 1, "page": result.model_dump()}))["page"])
    assert restored.lines[0].baseline_info["id"] == "top"
    assert restored.lines[0].baseline_info["boundary"] == [[10, 10], [30, 10], [30, 20], [10, 20]]
    assert [item.id for item in restored.ordered_lines()] == [item.id for item in result.lines]
    assert result.metadata["segmentation"]["line_count"] == 2


def test_empty_page_and_wrong_payload_are_distinguished(kraken_api, tmp_path):
    source = tmp_path / "blank.png"
    Image.new("L", (40, 40), 255).save(source)
    kraken_api["kraken.lib.segmentation"].extract_polygons = lambda im, bounds: iter(())
    config = ProjectConfig(temp_dir=str(tmp_path / "crops"))
    page = Page(id="blank", page_number=0, image_path=str(source))
    result = engine.segment(page, config, SimpleNamespace(predict=lambda **_: Segmentation()))
    assert result.lines == []
    assert result.metadata["segmentation"]["line_count"] == 0
    with pytest.raises(TypeError, match="Kraken 7 must return Segmentation"):
        engine.segment(page, config, SimpleNamespace(predict=lambda **_: {"lines": []}))
