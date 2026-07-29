from __future__ import annotations

from dataclasses import asdict, dataclass
import os


PROFILE_NAMES = ("cool", "balanced", "fast")


@dataclass(frozen=True)
class PerformanceLimits:
    profile: str
    logical_cores: int
    segmentation_workers: int
    segmentation_native_threads: int
    ocr_native_threads: int
    tensorflow_interop_threads: int = 1
    page_cooldown_ms: int = 0

    def as_dict(self) -> dict[str, int | str]:
        return asdict(self)


def normalize_profile(value: object) -> str:
    profile = str(value or "").strip().lower()
    return profile if profile in PROFILE_NAMES else "balanced"


def resolve_performance_limits(profile: object, logical_cores: int | None = None) -> PerformanceLimits:
    cores = max(1, int(logical_cores or os.cpu_count() or 1))
    normalized = normalize_profile(profile)

    if normalized == "cool":
        return PerformanceLimits(
            profile=normalized,
            logical_cores=cores,
            segmentation_workers=1,
            segmentation_native_threads=1,
            ocr_native_threads=1,
            page_cooldown_ms=100,
        )

    if normalized == "fast":
        return PerformanceLimits(
            profile=normalized,
            logical_cores=cores,
            segmentation_workers=min(4, cores),
            segmentation_native_threads=1,
            ocr_native_threads=min(4, cores),
        )

    return PerformanceLimits(
        profile="balanced",
        logical_cores=cores,
        segmentation_workers=min(2, cores),
        segmentation_native_threads=1,
        ocr_native_threads=min(2, cores),
    )


def _apply_environment(limits: PerformanceLimits) -> None:
    # These values are process-lifetime settings. They are intentionally applied
    # before the OCR/segmentation modules import their native runtimes.
    native_threads = str(max(limits.segmentation_native_threads, limits.ocr_native_threads))
    os.environ["MIMIR_PERFORMANCE_PROFILE"] = limits.profile
    os.environ["MIMIR_SEGMENTATION_WORKERS"] = str(limits.segmentation_workers)
    os.environ["MIMIR_SEGMENTATION_THREADS"] = str(limits.segmentation_native_threads)
    os.environ["MIMIR_OCR_THREADS"] = str(limits.ocr_native_threads)
    os.environ["MIMIR_PAGE_COOLDOWN_MS"] = str(limits.page_cooldown_ms)

    os.environ["OMP_NUM_THREADS"] = native_threads
    os.environ["OMP_THREAD_LIMIT"] = native_threads
    os.environ["OPENBLAS_NUM_THREADS"] = native_threads
    os.environ["MKL_NUM_THREADS"] = native_threads
    os.environ["VECLIB_MAXIMUM_THREADS"] = native_threads
    os.environ["NUMEXPR_NUM_THREADS"] = native_threads
    os.environ["BLIS_NUM_THREADS"] = native_threads
    os.environ["TF_NUM_INTRAOP_THREADS"] = str(limits.ocr_native_threads)
    os.environ["TF_NUM_INTEROP_THREADS"] = str(limits.tensorflow_interop_threads)
    os.environ["OMP_DYNAMIC"] = "FALSE"
    os.environ["MKL_DYNAMIC"] = "FALSE"
    os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"


ACTIVE_LIMITS = resolve_performance_limits(os.getenv("MIMIR_PERFORMANCE_PROFILE", "balanced"))
_apply_environment(ACTIVE_LIMITS)


def get_active_limits() -> PerformanceLimits:
    return ACTIVE_LIMITS
