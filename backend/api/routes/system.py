from typing import Dict
import os

from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/cpu")
def get_cpu_info() -> Dict[str, int]:
    total_cores = os.cpu_count() or 1
    default_worker_count = 1
    return {
        "total_cores": total_cores,
        "default_worker_count": default_worker_count,
    }
