"""Aggregated API router composed from route modules."""

from fastapi import APIRouter

from backend.api.routes.export import router as export_router
from backend.api.routes.files import router as files_router
from backend.api.routes.health import router as health_router
from backend.api.routes.lines import router as lines_router
from backend.api.routes.ocr import router as ocr_router
from backend.api.routes.projects import router as projects_router
from backend.api.routes.system import router as system_router

router = APIRouter()
router.include_router(health_router)
router.include_router(export_router)
router.include_router(projects_router)
router.include_router(files_router)
router.include_router(ocr_router)
router.include_router(lines_router)
router.include_router(system_router)
