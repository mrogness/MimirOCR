from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.health import router as health_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(health_router)
    return TestClient(app)


def test_root_endpoint_returns_hello_world() -> None:
    response = _client().get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}


def test_health_endpoint_returns_ok() -> None:
    response = _client().get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
