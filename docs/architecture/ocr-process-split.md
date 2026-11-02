# Isolated OCR runtimes

The API owns jobs, PDF rasterization, progress, database writes and exports.
Kraken and Calamari run only in child processes, never inside FastAPI. They do
not run HTTP servers. All processing remains local.

The source packages follow these runtime boundaries. Each worker's launcher,
engine implementation, and engine-specific helpers live together under
`backend/workers/segmenter/` or `backend/workers/recognizer/`. Shared JSON payload
objects live under `backend/domain/`; the API owns `backend/persistence/` and
`backend/services/ocr_jobs.py`. See [backend code organization](backend-organization.md)
for the full source map and refactor notes.

| Runtime | Environment | Packaged onedir directory |
|---|---|---|
| API | `.venvs/backend` | `backend-runtime/` |
| Segmentation | `.venvs/segmenter` | `mimir-segmenter/` |
| Recognition | `.venvs/recognizer` | `mimir-recognizer/` |

These three directories are siblings in Tauri's resources. Each has its own
executable and `_internal` directory. Do not merge their libraries. PyInstaller
builds each entry point with that role's interpreter and explicitly excludes
the other engines. The API discovers workers relative to its executable, so
installed apps do not depend on Python, a working directory, or shell activation.

## Development and packaging

Install uv, Node 22, Yarn 1.22.22, and the usual Tauri prerequisites.
Each runtime project selects Python 3.11; uv can download it when absent.
From the repository root:

```sh
python -m pip install uv==0.13.4
python scripts/setup_backend.py --dev --build
node scripts/check_backend_sidecar_env.mjs --build
yarn install --frozen-lockfile
yarn tauri:dev:auto
```

Setup syncs each role from its own committed lockfile. `--dev` adds backend tests;
`--build` adds PyInstaller to each role. Without these flags only production
packages are installed. Sync removes packages outside the selected groups,
including packages left in older environments. See
[dependency management](../maintenance/dependencies.md) before changing versions.

Development runs the API and workers from source using their respective
interpreters. `yarn tauri dev` also discovers the default API environment.
Optional absolute interpreter overrides are `MIMIR_PYTHON`,
`MIMIR_SEGMENTER_PYTHON`, and `MIMIR_RECOGNIZER_PYTHON`. The packaged API always
uses bundled executables, ignoring those development overrides.

The worker source commands remain `python -m backend.workers.segmenter` and
`python -m backend.workers.recognizer` using each role's interpreter. PyInstaller
now builds their package `__main__.py` files. Bundle directory names and model
asset destinations are unchanged.

```sh
yarn sidecar:preflight
yarn build:sidecar
yarn package:mac        # or yarn package:windows
```

`build:sidecar` builds all three onedir runtimes and runs a two-page PDF through
the packaged API and both real engines. Packaging scripts also run this gate.
Local and CI packaging share `scripts/package_desktop.mjs`. On macOS it restores
the TensorFlow library alias after Tauri copies resources, re-signs with the
existing ad-hoc identity, smoke-tests the copied app, and creates the ZIP/DMG
with symlinks preserved.

Windows executables use console builds so pipes exist; Tauri and the API launch
them with `CREATE_NO_WINDOW`. Native stdout and Python prints are redirected to
stderr inside workers; only JSON responses use the reserved protocol pipe.

## Dependencies

Each runtime owns `requirements/<role>/pyproject.toml` and `uv.lock`. These are
independent uv projects, not members of a shared workspace. API, segmentation,
and recognition versions can therefore evolve independently. There is no shared
constraints file and no combined ML environment. The recognizer's TensorFlow 2.15,
Keras 2.15, NumPy 1.23, and Windows-specific transitive versions remain locked
separately from Kraken 7's Torch/NumPy stack.

Run `python scripts/setup_backend.py --role segmenter --build` to sync just the
segmenter. Setup manages only `.venvs/<role>`; it never clears a custom interpreter
override. Remove obsolete `MIMIR_*_PYTHON` overrides to use the managed environments.
Preflight verifies the Kraken version and imports the adapter's task/configuration APIs.

## Execution and ownership

- One document job runs at a time, under the existing runtime gate.
- The API rasterizes pages, then dispatches pages to a bounded set of segmenter
  processes. CPU profiles retain 1/2/4 workers, capped by page count and cores;
  non-CPU devices use one segmenter to avoid duplicating GPU models.
- Each segmenter loads the existing default BLLA model once. Idle segmenters take
  the next page, preserving throughput on uneven pages.
- Segmenters exit before recognition starts. One recognizer loads the Calamari
  predictor once and reuses it across all pages. No nested ML process pools.
- Each worker receives native thread limits before importing numerical libraries.
  Results are ordered by page number; line order, geometry, confidence and
  character candidates survive JSON transfer.
- Images remain on disk; the protocol carries paths and metadata. The API keeps
  temporary files until workers have exited and results have been persisted.
- Workers exist for a stage of one job, not indefinitely. The next job gets fresh
  workers and models. The frontend's API and polling behavior remain the same.

## Failure and shutdown

Every initialization/page exchange has a 600-second deadline, including blocked
writes. Set `MIMIR_WORKER_TIMEOUT_SECONDS` before launching for unusually large
pages. Invalid JSON, incompatible protocol versions, mismatched IDs, engine
exceptions, crashes, and timeouts fail the job. There is no silent in-process
fallback or retry. Failures retain the last 8 KB of worker stderr in the job error.
Other workers are terminated and reaped before dispatch threads return, then the
existing job-finally path removes temporary files and releases the runtime gate.

Closing/restarting the app terminates the backend process tree. API shutdown also
stops registered workers. Each worker watches its parent during inference and
exits if the API dies. There is no new user-facing cancellation endpoint.

When spawning independently bundled workers, the API resets inherited PyInstaller
state and library-search paths (including the Windows DLL directory) so workers
load their own libraries.

## Validation

Model-free tests use actual subprocesses with a fake engine behind the production
worker protocol. They test reuse, Unicode, geometry, character data, native log
redirection, crashes, hung reads/writes, parent death, parallel ordering and cleanup.
The existing unit/API tests still gate release builds. Packaged smoke tests run
real segmentation and OCR, with a temporary database and generated PDF; they check
nonempty results and durable page/line images, not transcription accuracy.
