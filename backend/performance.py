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


def worker_environment(role: str) -> dict[str, str]:
    """Set native limits before a worker imports any numerical libraries."""
    limits = ACTIVE_LIMITS
    threads = (limits.segmentation_native_threads if role == "segmenter"
               else limits.ocr_native_threads)
    environment = {name: str(threads) for name in (
        "OMP_NUM_THREADS", "OMP_THREAD_LIMIT", "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "BLIS_NUM_THREADS",
    )}
    environment.update({
        "MIMIR_SEGMENTATION_THREADS": str(limits.segmentation_native_threads),
        "MIMIR_OCR_THREADS": str(limits.ocr_native_threads),
        "TF_NUM_INTRAOP_THREADS": str(limits.ocr_native_threads),
        "TF_NUM_INTEROP_THREADS": str(limits.tensorflow_interop_threads),
        "OMP_DYNAMIC": "FALSE", "MKL_DYNAMIC": "FALSE", "TF_ENABLE_ONEDNN_OPTS": "0",
    })
    return environment


ACTIVE_LIMITS = resolve_performance_limits(os.getenv("MIMIR_PERFORMANCE_PROFILE", "balanced"))


def get_active_limits() -> PerformanceLimits:
    return ACTIVE_LIMITS
