# System Overview

The application is split into three code areas that run as one desktop product:

- Vue frontend (`src/`) for UI workflows and local API calls.
- FastAPI backend (`backend/`) for persistence, OCR orchestration, and exports.
- Tauri host (`src-tauri/`) for desktop packaging and backend process lifecycle.

At runtime, the frontend talks to the local FastAPI sidecar launched by Tauri.
The API owns database access, job state, rasterization, and export generation.
It launches isolated Kraken segmentation and Calamari recognition workers and
exchanges JSON metadata and image paths with them.

In `src-tauri/src/backend/`, command and process modules expose backend status
and restart commands to the frontend while managing backend launch/shutdown.

See [isolated OCR runtimes](ocr-process-split.md) for development, packaging,
process lifetime and failure handling, and the worker contracts for IPC details.

See [backend code organization](backend-organization.md) for package ownership,
entry points, and the relationship between domain objects and database models.

See [frontend code organization](frontend-organization.md) for feature ownership,
shared services, and the separation between review geometry and overlay rendering.
