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

Coverage includes runtime job/restart exclusion, restart expiration and disk
failure recovery, line update/delete/restore routes with a real SQLite database,
restoration validation, page reading order, confidence boundaries, and export
reflow/Fraktur normalization. API tests mount individual production routers and
override only their database dependency; CRUD and response validation are real.

`conftest.py` redirects runtime directories **before collection**, because
`backend.database` creates a database at import time. Never remove that safeguard
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
The editing composable's injected `backendFetch` is mocked at the I/O boundary.
Fake timers make debounce tests deterministic. Shared setup unmounts components
and clears browser storage after each test.

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
tag's commit. Both packaging jobs have `needs: tests`, so a failed test job blocks
both builds and, transitively, their release uploads. There is no independent tag
trigger in `tests.yml`, avoiding duplicate test runs for a release tag. Merge the
workflow changes **before creating the next release tag**; old tags do not acquire
new workflow definitions.

Branch protection/rulesets are a separate repository setting: maintainers can
require the PR test checks after the first successful workflow run. A git patch
cannot change those settings.

## Scope and future additions

## Generated Architecture Documentation

For visual explanations of test topology and OCR job orchestration, see
`docs/testing-architecture.md`. It includes Mermaid diagrams for suite layout,
backend lifecycle transitions, and frontend polling flow.

Coverage reports deliberately include untested application code rather than
claiming whole-app coverage from a narrow selection. There is no arbitrary
global percentage gate yet. Expand the suite with regression tests for bugs and
new behavior before setting a realistic coverage floor.

These tests do not prove segmentation accuracy, Calamari CER, PDF rendering
fidelity, GPU compatibility, signing, or bundled native-library compatibility.
The runtime build runs `scripts/smoke_workers.py` against the packaged API and
real workers on a generated two-page PDF. It verifies launch, inference, and
persistence. Add a licensed Fraktur fixture corpus for accuracy benchmarking. A passing mocked network test is not evidence that
the packaged backend starts or that OCR quality improved.

## Worker and build tests

`test_worker_processes.py` and `test_pipeline_runner.py` launch real subprocesses
with model-free test engines behind the production protocol. They exercise
round trips, model reuse, Unicode/geometry/candidate preservation, failures,
timeouts (including blocked stdin), parent death, and parallel-stage cleanup.
The API integration test also runs the real runner with fake-engine subprocesses.

`yarn test:build` checks engine exclusions, onedir separation, pipe-compatible
Windows builds, and all three Tauri resource mappings. These checks run in CI.
`yarn build:sidecar` runs inference through the packaged API and both real ML
workers. macOS CI repeats that smoke test inside the copied application bundle.
