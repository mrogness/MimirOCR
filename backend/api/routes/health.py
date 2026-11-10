"""Expose the lightweight backend health endpoint used during startup checks."""
from typing import Dict

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def root() -> Dict[str, str]:
    """Return the minimal root response used to identify the API service."""
    return {"message": "Hello World"}


@router.get("/health")
def health() -> Dict[str, str]:
    """Report that the HTTP API is responsive without loading either ML runtime."""
    return {"status": "ok"}
