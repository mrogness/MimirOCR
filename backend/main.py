'''
The entry point for the backend application. This module initializes the FastAPI app, 
sets up routes, and configures middleware and other necessary components.

Author: Matthew Rogness
'''

from fastapi import FastAPI
from fastapi import Request
from fastapi import Response
import uvicorn

from backend.api.routes import router as api_router
from fastapi.middleware.cors import CORSMiddleware

from backend.database import Base
from backend.database import engine


app = FastAPI()
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def allow_private_network_requests(request: Request, call_next) -> Response:
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network", "").lower() == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.on_event("startup")
def startup_event() -> None:
    # This runs once when the FastAPI process starts
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8080, reload=True, reload_dirs=["backend"])
