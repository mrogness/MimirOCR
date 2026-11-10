# Dependency ownership and security updates

Each Python runtime is an independent uv project. There is no root workspace or
shared constraints file. `pyproject.toml` declares direct dependencies and optional
tool groups; `uv.lock` records the resolved transitive versions, platform markers,
distribution URLs, and hashes. Commit both files when changing dependencies.
Unused historical constraints are removed; upstream engine dependencies remain.

| Project | Managed environment | Production responsibilities |
|---|---|---|
| `requirements/backend/` | `.venvs/backend` | FastAPI, SQLAlchemy, PDF preparation and export |
| `requirements/segmenter/` | `.venvs/segmenter` | Kraken 7.1.1, Torch, line segmentation |
| `requirements/recognizer/` | `.venvs/recognizer` | Calamari `tf-keras` branch, TensorFlow and TF-Keras 2.21, recognition |

The supported desktop targets remain macOS ARM and Windows x64. The API also
supports Linux for model-free tests and documentation. All projects currently
require Python 3.11; the current locks retain the documented ML engine/model versions.
Interpreter requirements live in each manifest. A future interpreter migration
also needs corresponding preflight checks, wheel availability, and native tests.

## Setup and optional tools

Install `uv==0.13.4`, then use the host Python to run setup. The host interpreter
does not have to be Python 3.11: uv selects a compatible installed interpreter or
downloads one. Commands below are identical on Windows and macOS.

```sh
python -m pip install uv==0.13.4
python scripts/setup_backend.py                         # production packages only
python scripts/setup_backend.py --dev                   # API tests, no build tools
python scripts/setup_backend.py --dev --build           # desktop development/build
python scripts/setup_backend.py --role backend --docs   # API + MkDocs only
python scripts/setup_backend.py --role segmenter --build
python scripts/setup_backend.py --dev --build --check   # verify, without syncing
```

Setup always uses `uv sync --locked`: a stale or missing lock is an error, not an
invitation to silently resolve new versions. Sync removes packages outside the
selected groups. Include all tools you want to keep when repeating setup, for
example `--role backend --dev --build --docs`. Other roles are untouched when
`--role` is supplied. Setup targets only the repository's managed `.venvs/` paths;
custom `MIMIR_*_PYTHON` interpreters are not modified.

PyInstaller and its hooks are in each project's optional `build` group, not
production dependencies. The backend alone has `test` and `docs` groups. There
is no need to install an auditor into an ML environment.

Use `node scripts/run_backend.mjs -m pytest` or `yarn docs:generate` to run tools
with the same API interpreter selected by the desktop development scripts.

## Updating one runtime

Edit only that runtime's manifest when changing a direct dependency, then resolve
and inspect its lock. For a transitive security update, use a targeted upgrade:

```sh
uv lock --project requirements/segmenter --upgrade-package aiohttp --upgrade-package yarl
uv lock --project requirements/segmenter --check
python scripts/setup_backend.py --role segmenter
python scripts/setup_backend.py --dev
yarn test:ml
```

For a direct pinned package, change the manifest pin first; a targeted lock upgrade
does not override it. Avoid broad `--upgrade` runs for a single advisory. Inspect
the complete lock diff, including compatible child-package updates. Dependency
metadata compatibility is necessary but does not prove successful inference.

Keep TensorFlow, Keras, Calamari/TFAIP, and the trained checkpoint compatible as a
set. The recognizer pins the Calamari `tf-keras` branch and its companion TFAIP
and `paiargparse` commits from [Calamari PR #378](https://github.com/Calamari-OCR/calamari/pull/378).
TensorFlow installs Keras 3. The worker sets `TF_USE_LEGACY_KERAS=1` before
importing TensorFlow so Calamari uses the separately installed `tf-keras` API.
Audit both Keras distributions as part of the recognizer inventory.

The bundled `r10.ckpt.json` and `r10.ckpt.keras` are a Calamari version 7
checkpoint. Keep the two files together. Calamari loads version 7 models with
`safe_mode=False`, so the worker accepts the bundled checkpoint and a single
optional checkpoint explicitly named by `MIMIR_TRUSTED_OCR_MODEL`. To use a
custom version 7 checkpoint, set that variable to its absolute checkpoint stem
and use the same stem as `ocr_model_path`. Checkpoint conversion is an offline
operation. When converting your own version 6 checkpoint with upstream
Calamari, work on a copy of its metadata and SavedModel directory.

Keep Torch/torchvision compatible in the segmenter. Pillow 13 requires an
interpreter newer than Python 3.10. All three runtimes now lock Pillow 13.0.0;
the segmenter locks filelock 4.2.7, resolving the Python-version blockers for
those security updates. Independent environments permit different shared-library
versions, with JSON contract tests protecting the boundary.

## Sync or upgrade an existing checkout

Stop the application and workers before syncing an existing checkout. If a
managed environment is activated, deactivate it and run setup with a host Python.
uv recreates an environment whose interpreter no longer matches its manifest;
there is no need to delete unrelated environments or install packages with pip.

```sh
uv python install 3.11
python scripts/setup_backend.py --dev --build
node scripts/check_backend_sidecar_env.mjs --build
node scripts/run_backend.mjs -m pytest
node scripts/test_ml_runtimes.mjs
```

On macOS ARM or Windows x64, run the full ML suite before trying the desktop app
with `yarn tauri:dev:auto`. To verify distribution builds as well, run
`yarn package:mac` or `yarn package:windows`. The PR workflows run native
inference and packaging checks for dependency/build changes. Clear or update any
`MIMIR_*_PYTHON` override that still points to an old Python 3.10 environment.

The Python 3.11 migration and targeted Pillow/filelock updates are part of the
current baseline. Run production audits after dependency changes and review
remaining alerts; a compatible lockfile does not establish that every dependency
is free of vulnerabilities.

## Audits and inventories

After syncing production environments, run:

```sh
python scripts/setup_backend.py
python scripts/audit_runtimes.py
python scripts/audit_runtimes.py --role recognizer
```

Each role produces `*-inventory.json`, an exact `*-installed.txt`, `*-audit.json`,
and an audit log under `test-results/dependencies/`, with an aggregate
`summary.json`. The inventory comes from that role's actual interpreter, honoring
the usual interpreter overrides. Optional tools appear in the inventory only
when installed; sync production-only first to measure production dependencies.

The auditor runs in uvx's separate tool environment. It sends installed package
names/versions to the advisory service, does not install or resolve the engines
again, and never applies fixes. It exits nonzero on findings or errors, including
incomplete collection, but still attempts every requested runtime. Read the logs
and summary: a service/interpreter failure is not a clean security report.

CI first audits production-only installations on both native targets. Audit
findings are advisory during this migration because known legacy-stack findings
already exist; reports are always uploaded and no vulnerability is silently
ignored or dismissed. A future policy can make that step blocking after the
backlog is triaged. Local audits already return failure on findings.

An installed-package inventory is not an inventory of a PyInstaller bundle.
Upstream Kraken/Calamari dependency trees include functionality beyond inference,
and the existing engine `--collect-all` packaging remains. Do not dismiss an
alert merely because application source does not import the package directly.

## Dependabot and native validation

`.github/dependabot.yml` tracks each uv project independently, plus npm, Cargo,
and Actions. Every entry sets `open-pull-requests-limit: 0` to disable routine
version-update PRs without blocking security-update PRs. Keep Dependabot alerts
and Dependabot security updates enabled in GitHub's repository settings; this
file does not enable those features. Existing version-update grouping rules are
inactive while version updates are disabled. No updates are auto-merged.
Supersede old PRs against deleted constraints files with PRs against the
appropriate project.

For every PR, real ML checks install locked environments, import the production
APIs, run dependency checks, and perform inference on macOS ARM and Windows x64.
Dependency/build-script PRs additionally run both packaged desktop builds and
their bundled-worker smoke tests. Manual packaging dispatch is also available.
CoreMLTools 9 currently has no Windows wheel, so its upstream source distribution
is built there; other target dependencies can be planned from wheels. This is a
reason to retain real native installation checks.

Release uploads are restricted to tag pushes. The packaging workflow is
path-filtered; do not make its checks globally required on unrelated PRs without
an always-running gate. Branch rules must be configured
in GitHub to require checks; YAML alone cannot enforce approval policy.

Review each advisory for the installed runtime, affected operation, fixed version,
and upgrade compatibility. A passing test suite establishes the exercised behavior;
it does not certify that every vulnerability is unreachable.
