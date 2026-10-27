# Testing MimirOCR

The default suite tests application behavior without OCR model weights, network
services, a Tauri window, or installed TensorFlow/PyTorch runtimes. It is not an OCR
accuracy benchmark or a packaged-app end-to-end test.

## Python: unit and API component tests

From the repository root, create a Python 3.10 virtual environment, activate it,
and run:

```sh
python -m pip install -r requirements-test.txt
python -m pytest
python -m pytest --cov=backend --cov-branch --cov-report=term-missing
```

`requirements-test.txt` uses the application's `constraints.txt` as constraints,
not as installation requirements. This tests the same FastAPI/Pydantic/SQLAlchemy
versions without installing the ML stack. `requirements-dev.txt` installs the API plus tests. For all three isolated runtime
environments, use `python scripts/setup_backend.py --dev`.

ReportLab, PyMuPDF and Pillow are included in the model-free test environment to
exercise real PDF exports, source-resolution analysis and rasterization. They use
the existing application pins from `constraints.txt`; no ML dependencies are added.

Coverage includes runtime job/restart exclusion, restart expiration and disk
failure recovery, line update/delete/restore routes with a real SQLite database,
restoration validation, page reading order, confidence boundaries, and export
reflow/Fraktur normalization. API tests mount individual production routers and
override only their database dependency; CRUD and response validation are real.

`conftest.py` redirects runtime directories **before collection**, because
`backend.persistence.database` creates a database at import time. Never remove that safeguard
or point test fixtures at an existing MimirOCR database. Each line API test uses
its own in-memory database. Runtime-gate tests use fresh gates and a fake clock;
they do not sleep for reservation expiry.

Route aggregation lives in `backend/api/router.py`. The `routes` package itself
is intentionally lightweight so importing health/line/system routes does not
also initialize PDF or ML dependencies. `backend/main.py` still loads the full
router with the same routes in the same order.

## Vue: unit and component tests

Use Node 22 and Yarn Classic 1.22.22, matching CI:

```sh
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile
yarn test:unit
yarn test:unit:watch
yarn test:unit:coverage
```

Tests use Vitest, Vue Test Utils, and jsdom. They cover settings isolation and
validation; history snapshots and retention; correction-save debouncing, stale
responses, undo, deletion, and errors; suspicious-character analysis; and actual
rendered review-control interactions. Vue components are mounted, not mocked.
Review geometry tests also cover observed coordinate spans, neighbor-constrained
marker widening, fallback placement, reactive page/scale/toggle changes, and
scaled SVG output and selection events through the real page overlay component.
The editing composable's injected `backendFetch` is mocked at the I/O boundary.
Fake timers make debounce tests deterministic. Shared setup unmounts components
and clears browser storage after each test.

Tests live beside their owning components, composables, or geometry module in
`src/features/<feature>/**/__tests__/`. App-shell tests live in `src/__tests__/`
and shared-service tests in `src/shared/services/__tests__/`. Vitest and coverage
already discover these paths recursively, so their commands and CI configuration
are unchanged. See [frontend code organization](architecture/frontend-organization.md)
for the source map and the [test inventory](generated/test-inventory.md) for
current test paths. To run the review geometry and overlay tests alone:

```sh
yarn test:unit src/features/review/__tests__/geometry.spec.js src/features/review/composables/__tests__/useReviewGeometry.spec.js src/features/review/components/__tests__/PageImageOverlay.spec.js
```

Prefer assertions about visible text, disabled controls, emitted events,
persistence payloads, and state transitions over large HTML snapshots or CSS
class assertions. Clean up timers and restore mocks when introducing new tests.

## Rust/Tauri

With the normal [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

The library tests do not launch the application or Python. They cover profile
parsing, corrupt settings fallback, settings replacement, and restart reservation
validation/single-use consumption. Filesystem tests create and clean up unique
temporary directories, not the installed application's settings directory.
CI runs these on macOS ARM and Windows; Linux needs Tauri's native build libraries
if you want to run them locally.

## GitHub Actions and the release gate

`.github/workflows/tests.yml` runs on pull requests, pushes to `main`, and manual
dispatch. It is also a reusable workflow. Backend tests run on macOS and
Windows; frontend tests and a production frontend build run on Linux; Rust tests
run on macOS and Windows. Coverage and JUnit reports are uploaded even if tests
fail. These checks need no release secrets or model downloads.

The tag-triggered `build-artifacts.yml` calls this exact same workflow from the
tag's commit. Both packaging jobs require the model-free and ML runtime gates,
so a failed test job blocks both builds and, transitively, their release uploads. There is no independent tag
trigger in `tests.yml`, avoiding duplicate test runs for a release tag. Merge the
workflow changes **before creating the next release tag**; old tags do not acquire
new workflow definitions.

Branch protection/rulesets are a separate repository setting: maintainers can
require the PR test checks after the first successful workflow run. A git patch
cannot change those settings.

## Scope and future additions

## Architecture Documentation

For visual explanations of test topology and OCR job orchestration, see
[the testing architecture](testing-architecture.md). It includes Mermaid diagrams for suite layout,
backend lifecycle transitions, and frontend polling flow.

Coverage reports include untested application logic. The frontend excludes test
infrastructure, the bootstrap and declarative route map, and six static help-text
components explicitly listed in `vitest.config.js`. Interactive help, settings,
preview controls, screen orchestration and backend services remain measured.
Python excludes test infrastructure, package initializers and tiny executable
entry points; inference engines, preparation, prediction metadata and runtime
lifecycle code remain measured. These exclusions change the denominator, so
compare results using the same configuration. No ML code is hidden to raise a score.

The frontend emits `coverage/frontend/coverage-summary.json` as well as HTML and
LCOV reports. Use the per-file results to prioritize missing behaviors; aggregate
Vue branch coverage can look high even when a component is never mounted.
Vitest enforces regression floors of 70% lines/statements/functions and 75%
branches. These are suite guardrails, not proof of complete workflow coverage.

These tests do not prove segmentation accuracy, Calamari CER, PDF rendering
fidelity, GPU compatibility, signing, or bundled native-library compatibility.
The runtime build runs `scripts/smoke_workers.py` against the packaged API and
real workers on a generated two-page PDF. It verifies launch, inference, and
persistence. Add a licensed Fraktur fixture corpus for accuracy benchmarking. A passing mocked network test is not evidence that
the packaged backend starts or that OCR quality improved.

## Production dependency and real inference checks

The separate `.github/workflows/ml-runtime-tests.yml` workflow installs all
three production runtime environments on Windows x64 and macOS ARM with Python
3.10.11. It runs for PRs and `main` pushes that change dependencies, backend code,
worker/build scripts, ML tests, bundled fonts, or workflow definitions. It can
also be dispatched manually. Its pip cache stores downloads, not environments;
each runner must actually install the requested packages. Missing platform
wheels and incompatible dependency pins fail before a release is tagged.

Run the same checks locally from the repository root with Python 3.10 and Node
22 (these commands do not build executables or require frontend dependencies):

```sh
python scripts/setup_backend.py --dev
node scripts/test_ml_runtimes.mjs
# Equivalent, if Yarn is available:
yarn test:ml
```

The driver uses the backend environment's pytest and the existing
`MIMIR_SEGMENTER_PYTHON` / `MIMIR_RECOGNIZER_PYTHON` overrides. ML packages are
imported only in their owning runtime processes. Preflight prints each runtime's
interpreter, verifies Kraken 7.1.1, imports the task/configuration/extraction APIs
used by the adapter, and runs `pip check` for every environment. The segmenter
and shared build requirements do not apply the legacy Calamari constraints.

`pytest-ml.ini` keeps the real-model tests out of the default model-free
suite and its coverage report. To select a test after preflight:

```sh
node scripts/test_ml_runtimes.mjs -k recognizer
```

The real-model suite deliberately fails on missing runtimes or weights; it does
not skip tests or substitute fake engines. It covers:

- Kraken on a six-line synthetic Fraktur page in both strict and native reading
  order modes: plausible line count, page-space geometry, top-to-bottom order,
  usable binary crops, and a subsequent blank page in the same worker without
  stale results.
- A fixed two-column Fraktur layout from `tests/ml/fixtures/`, with the strict
  override disabled: detected lines must follow the fixture's left-column then
  right-column ground truth. This compares geometry independently of OCR.
- Calamari on three independently rendered known crops, processed twice by one
  worker: preserved identities/geometry, nonempty predictions, finite confidence,
  character metadata, and character error rate at most 30% on each crop.
- The source API through the existing release smoke scenario: PDF upload,
  asynchronous job completion, real segmentation/OCR workers, and persisted
  two-page results and transcript. `scripts/smoke_workers.py --source` uses the
  current Python as the API interpreter; the default still tests packaged binaries.

Fixtures use the repository's existing `BreitkopfFraktur.ttf` and short synthetic
sentences. No external scans, system fonts, model downloads, or network service
are needed during inference. CER normalizes Unicode composition, whitespace, and
long-s versus s; it does not require identical floating-point scores across OSes.
The deliberately broad threshold detects broken recognition, not publication
accuracy. Use labeled historical scans separately when comparing models.

Workers run on CPU with bounded request timeouts, temporary data directories and
explicit cleanup. Test reports and API diagnostics are written under
`test-results/ml/` and uploaded even when the inference step fails.

The release workflow calls these checks as a reusable gate, independently of
the model-free test gate. Both must pass before either packaging job starts;
the packaged smoke test still runs after bundling. These changes therefore
check source/runtime compatibility early and bundled resources at release time.

The ML workflow uses path filters. If configuring it as a required branch check,
remove those filters or use a repository-level required-check gate that handles
unrelated changes; GitHub does not complete a path-filtered workflow that never
starts. The ordinary model-free checks continue on every PR.

## Worker and build tests

`test_worker_processes.py` and `test_pipeline_runner.py` launch real subprocesses
with model-free test engines behind the production protocol. They exercise
round trips, model reuse, Unicode/geometry/candidate preservation, failures,
timeouts (including blocked stdin), parent death, and parallel-stage cleanup.
The API integration test also runs the real runner with fake-engine subprocesses.

`test_worker_helpers.py` covers confidence/character metadata and reading order
under the owning worker packages. `test_worker_resources.py` protects model and
lexicon discovery and the existing default runtime directories after source moves.
`test_route_imports.py` verifies worker launchers and dependency boundaries, and
that importing ORM definitions alone does not initialize a database.
`test_export_routes.py` exercises real PDF rendering and training ZIP contents
through HTTP with isolated SQLite records. Job route tests also cover release of
the runtime reservation when thread launch fails. See
[backend code organization](architecture/backend-organization.md) for ownership
and the mapping from old internal imports.

`yarn test:build` checks engine exclusions, onedir separation, pipe-compatible
Windows builds, and all three Tauri resource mappings. These checks run in CI.
`yarn build:sidecar` runs inference through the packaged API and both real ML
workers. macOS CI repeats that smoke test inside the copied application bundle.

## Project deletion and artifact isolation

`test_project_routes.py` exercises real project routes, SQLite cascades, file
responses, and isolated job/upload records. `test_project_artifact_cleanup.py`
protects both project deletion and PDF replacement against project-ID prefix
collisions: deleting project `1` must preserve directories for projects `10`
and `100`. Cleanup accepts exact `project_1`/`project1` names or names followed
by an underscore suffix, such as `project_1_run`.

```sh
python -m pytest backend/tests/test_project_routes.py backend/tests/test_project_artifact_cleanup.py
```

`test_file_routes.py` covers upload storage, replacement isolation, MIME and
multipart validation, and the DPI route's analyzer interface. Reading and saving
a replacement happens before clearing the old dataset. Fault-injection tests
verify that read, directory-creation, and write failures preserve corrections,
pages, artifacts, and job/upload records, and that partially written replacement
files are removed. DPI analyzer internals are mocked in the route suite;
`test_pdf_dpi.py` separately uses generated scans with known source resolutions,
vector-only pages, a repeated logo, rotation, encryption and invalid PDFs.

## Frontend workflow and recovery regressions

`ProjectReviewView.spec.js` mounts the real review screen, composables and child
components with an in-memory router. It checks edit/save/remount, immediate export
of pending corrections, overlay-to-row selection, page navigation, keyboard undo,
route changes and empty/error states. `ProjectsView.spec.js` exercises file
selection, upload, job progress, completion, review navigation and upload retry;
only its PDF.js canvas preview is replaced, since that has a dedicated test suite.

Composable/service tests cover reorder persistence and partial rollback, undo
failure, serialized save flushing, terminal-job recovery, slow polls, cleanup,
project-scoped job storage, stale project loads, rename/delete behavior, shared
runtime polling, connection caching/retry, restart reservations and reconnection.
Export tests verify query settings, filenames, object-URL cleanup and failures.
Preview tests run the real grayscale/threshold loops on tiny known pixel arrays;
PDF.js and canvas I/O are mocked to exercise cancellation, caching and stale-load
behavior without browser rendering dependencies. These are deterministic component
and integration tests, not a desktop end-to-end or visual-fidelity test.

`test_pdf_preparation.py` rasterizes real PDFs and checks dimensions/progress.
`test_prediction_metadata.py` and `test_ij_disambiguation.py` use model-shaped
fixtures without loading inference runtimes. PDF route tests parse the generated
PDF to verify corrected text, paper size and spread page counts. The existing
packaged runtime smoke tests remain responsible for real model inference.

The regressions also protect several fixes: terminal recovered jobs no longer
restart polling, periodic OCR status requests do not overlap, cleanup invalidates
late poll responses, and old review/runtime responses cannot overwrite a newer
project or backend restart. PDF and training-data exports flush queued and
in-flight correction saves first and report save failures instead of exporting
older text. Download URLs are released even if the browser download fails.
