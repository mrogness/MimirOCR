from typing import Dict

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def root() -> Dict[str, str]:
    return {"message": "Hello World"}


@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}
