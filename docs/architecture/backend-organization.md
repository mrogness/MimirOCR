# Backend code organization

The backend is organized by ownership. The API coordinates document jobs and
owns persistence and exports. Kraken and Calamari implementations belong to their
respective worker packages. Each engine retains its own environment and bundled
executable.

## Source map

| Package or module | Responsibility |
|---|---|
| `backend/api/` | HTTP routers, request/response schemas, and database dependencies |
| `backend/domain/` | Shared Pydantic project, page, line, and pipeline configuration objects |
| `backend/persistence/models.py` | SQLAlchemy table definitions and relationships |
| `backend/persistence/database.py` | API database engine, sessions, and existing schema initialization |
| `backend/persistence/repository.py` | Database operations and durable image persistence |
| `backend/services/ocr_jobs.py` | Job reservation, thread launch, processing, persistence, and cleanup |
| `backend/services/job_store.py` | In-memory upload and job records |
| `backend/services/pdf_dpi.py` | PDF scan-resolution analysis |
| `backend/pipeline/runner.py` | Document preparation, segmentation, recognition, and artifact sequence |
| `backend/pipeline/dispatch.py` | Bounded page dispatch to worker subprocesses |
| `backend/pipeline/prepare.py` | PDF rasterization |
| `backend/pipeline/artifacts.py` | Pipeline transcript and project JSON writing |
| `backend/workers/client.py`, `server.py`, `protocol.py` | Process launch and shared JSON Lines communication |
| `backend/workers/segmenter/` | Kraken launcher, segmentation/cropping engine, and reading-order/geometry helpers |
| `backend/workers/recognizer/` | Calamari launcher, inference engine, prediction metadata, and I/J disambiguation |
| `backend/exporting/` | PDF generation, reading-mode reflow, and training-data ZIP generation |
| `backend/runtime/` | Data/cache/temp paths, performance limits, runtime gate, and parent watchdog |
| `backend/tests/` | Model-free tests and the fake subprocess engine |

`domain` describes application concepts without database connections or native
ML dependencies. A domain `Page` is the processing/IPC object; a persistence
`Page` is a SQLAlchemy row. Use aliases such as `DbPage` where both appear.

Model assets remain in `backend/ml/calamari/`; the lexicon remains in
`backend/resources/`. Kraken's default BLLA model is still sourced from the
installed Kraken package. This refactor leaves the Vue frontend, model assets,
dependency versions, and requirements-directory organization unchanged.

## Entry points and boundaries

- FastAPI application: `backend.main:app`.
- Bundled API launcher: `backend/sidecar_main.py`.
- Worker source commands: `python -m backend.workers.segmenter` and
  `python -m backend.workers.recognizer`, using each role's interpreter.
- Worker PyInstaller entry files: each package's `__main__.py`.

Package initializers remain lightweight. Worker implementations must not import
FastAPI, SQLAlchemy, or database setup. Native ML imports remain lazy inside
worker initialization/inference. The API build excludes both engine packages;
each worker build excludes the other engine package. The three onedir bundles
retain their existing names and resource destinations.

Export builders receive already-loaded pages and return an `ExportArtifact`
containing bytes, a filename, and a media type. They report `ExportError`; routes
translate it into the existing HTTP status and detail. The OCR job service uses
`JobStartError` in the same way. Routes retain HTTP validation and response
construction.

## Location changes

| Previous location | New location |
|---|---|
| `backend/models/` | `backend/domain/` |
| `backend/database.py` | `backend/persistence/models.py` and `database.py` |
| `backend/api/crud.py` | `backend/persistence/repository.py` |
| `backend/pipeline/workers.py` | `backend/pipeline/dispatch.py` |
| `backend/pipeline/jobs.py` | `backend/services/job_store.py` |
| `backend/stages/prepare.py` | `backend/pipeline/prepare.py` |
| `backend/stages/export.py` | `backend/pipeline/artifacts.py` |
| `backend/stages/ocr.py` | Recognizer `engine.py` and `predictions.py` |
| `backend/stages/segment.py` | Segmenter `engine.py` and `reading_order.py` |
| `backend/services/ij_disambiguation.py` | Recognizer `ij_disambiguation.py` |
| Export implementation in `api/routes/export.py` | `backend/exporting/pdf.py` and `training_data.py` |
| Job execution and launch in `api/routes/ocr.py` | `backend/services/ocr_jobs.py` |
| Top-level runtime support modules | `backend/runtime/` |

Old internal import paths are removed rather than maintained through aliases.
Update any local scripts that import them. The old `stages/` and `models/` source
folders are no longer needed.

## Behavior and validation

There are no intended changes to OCR output, segmentation/cropping, reading
order, confidence/candidates, I/J processing, API routes or schemas, export
filenames/layout, database tables, job scheduling, progress, timeouts, cleanup,
performance profiles, or persisted resource paths. Relative-path calculations
were adjusted to preserve existing model, lexicon, and runtime locations at
their new source depths.

One intentional internal behavior change is that importing
`backend.persistence.models` alone does not create a database or runtime
directories. Initialization remains in `backend.persistence.database`, which
the API imports as before. Error tracebacks show the new module locations;
service errors translate back to the same HTTP status/detail at route boundaries.

The [testing guide](../testing.md) and [test inventory](../generated/test-inventory.md)
cover the current suite. Regression checks cover worker launchers and import
isolation, development/bundled resource lookup, runtime directories, real PDF
exports and training ZIP contents, thread-launch failure cleanup, and existing
fake-worker processing/persistence flows.

Development commands remain the same. Existing packaged executables contain old
sources until rebuilt: use `yarn build:sidecar` before testing a packaged app.
Real-model smoke tests remain part of [the packaging workflow](ocr-process-split.md);
model-free tests do not establish native-library compatibility or OCR accuracy.
