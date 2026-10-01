import pytest

from backend.performance import normalize_profile, resolve_performance_limits


def test_normalize_profile_falls_back_to_balanced() -> None:
    assert normalize_profile("unknown") == "balanced"


def test_resolve_performance_limits_balanced_defaults() -> None:
    limits = resolve_performance_limits("balanced", logical_cores=8)

    assert limits.profile == "balanced"
    assert limits.segmentation_workers == 2
    assert limits.ocr_native_threads == 2


def test_resolve_performance_limits_fast_mode_caps_workers() -> None:
    limits = resolve_performance_limits("fast", logical_cores=32)

    assert limits.profile == "fast"
    assert limits.segmentation_workers == 4
    assert limits.ocr_native_threads == 4


@pytest.mark.parametrize("profile,cap,cooldown", [("cool", 1, 100), ("balanced", 2, 0), ("fast", 4, 0)])
@pytest.mark.parametrize("cores", [1, 2, 8, 64])
def test_profiles_respect_cpu_and_thread_limits(profile, cap, cooldown, cores):
    limits = resolve_performance_limits(profile, logical_cores=cores)
    assert limits.segmentation_workers == min(cap, cores)
    assert limits.ocr_native_threads == min(cap, cores)
    assert limits.segmentation_native_threads == 1
    assert limits.tensorflow_interop_threads == 1
    assert limits.page_cooldown_ms == cooldown


@pytest.mark.parametrize("raw,expected", [(None, "balanced"), (" FAST ", "fast"), ("", "balanced"), ("CoOl", "cool")])
def test_profile_normalization(raw, expected):
    assert normalize_profile(raw) == expected
