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
