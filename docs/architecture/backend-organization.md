# Backend code organization

The backend is organized by layer and execution boundary:

- API and persistence modules run in the FastAPI sidecar process.
- OCR engines run in separate worker processes (`segmenter` and `recognizer`).
- Shared pipeline/domain modules define cross-process payload and workflow shape.

This separation keeps TensorFlow/Kraken and PyTorch/Calamari dependencies
isolated while preserving a single API surface for the frontend.

## Source map

| Package or module | Responsibility |
|---|---|
| `backend/main.py` | FastAPI app creation, CORS/middleware setup, startup/shutdown hooks |
| `backend/sidecar_main.py` | CLI launcher for packaged backend sidecar |
| `backend/api/router.py` | API router registration |
| `backend/api/routes/` | Route handlers (`projects`, `files`, `ocr`, `lines`, `export`, `system`, `health`) |
| `backend/api/schemas.py` | Request/response schema definitions |
| `backend/api/deps.py` | Dependency wiring for route handlers |
| `backend/domain/` | Domain objects used by pipeline and workers (project/page/line/config) |
| `backend/persistence/models.py` | SQLAlchemy table models |
| `backend/persistence/database.py` | Engine/session setup and schema initialization helpers |
| `backend/persistence/repository.py` | Repository operations for project/page/line persistence |
| `backend/services/ocr_jobs.py` | OCR job orchestration and lifecycle management |
| `backend/services/job_store.py` | In-memory job and upload state |
| `backend/services/pdf_dpi.py` | PDF DPI analysis and related utilities |
| `backend/pipeline/runner.py` | End-to-end OCR pipeline orchestration |
| `backend/pipeline/prepare.py` | Page rasterization and preparation steps |
| `backend/pipeline/dispatch.py` | Worker dispatch/concurrency orchestration |
| `backend/pipeline/artifacts.py` | Generated artifact serialization and output writing |
| `backend/workers/client.py`, `server.py`, `protocol.py` | Worker lifecycle and JSON-lines IPC protocol |
| `backend/workers/segmenter/` | Kraken-backed segmentation and reading-order helpers |
| `backend/workers/recognizer/` | Calamari-backed recognition, predictions, and I/J disambiguation |
| `backend/exporting/` | PDF export, reflow helpers, and training-data archive generation |
| `backend/runtime/` | Runtime gates, paths, performance profiles, and parent watchdog |
| `backend/tests/` | Backend unit/integration tests plus fake worker support |

Model and resource assets used by backend code are stored in `backend/ml/` and
`backend/resources/`.

## Entry points and process boundaries

- FastAPI application entry point: `backend.main:app`
- Sidecar executable entry point: `backend/sidecar_main.py`
- Worker module entry points:
  - `python -m backend.workers.segmenter`
  - `python -m backend.workers.recognizer`

The API process is responsible for HTTP, persistence, job orchestration, and
export assembly. Worker processes are responsible only for ML segmentation and
recognition, and communicate with the API via the shared worker protocol.

## Legacy layout notes

The migration from older module locations is complete. `backend/stages/` and
`backend/models/` are retained only as empty directories (with generated cache
contents) and are not part of the active source layout.

## Validation references

See [testing guide](../testing.md),
[test inventory](../generated/test-inventory.md), and
[OCR process split](ocr-process-split.md) for runtime, packaging, and regression
coverage details.
