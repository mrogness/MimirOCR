# Contributing

For desktop development and packaging, start with [isolated runtime setup](architecture/ocr-process-split.md).
For source navigation, see [backend code organization](architecture/backend-organization.md)
and [frontend code organization](architecture/frontend-organization.md).
The [testing guide](testing.md) explains isolation and coverage; the
[test inventory](generated/test-inventory.md) lists the current test files.

## Local setup

Use Node 22.22.2 or newer within Node 22 and Yarn Classic 1.22.22. For a first
end-to-end run, follow the [OCR walkthrough](tutorials/first-ocr-run.md).

1. Python backend tests

```sh
python -m pip install uv==0.13.4
python scripts/setup_backend.py --role backend --dev
node scripts/run_backend.mjs -m pytest
```

2. Frontend tests

```sh
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile
yarn test:unit
```

3. Rust/Tauri tests

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

## Documentation workflow

1. Install docs dependencies

```sh
yarn install --frozen-lockfile
python scripts/setup_backend.py --role backend --docs
```

2. Regenerate derived docs

```sh
yarn docs:generate
```

3. Build and preview docs

```sh
yarn docs:serve
```

The [source code reference](reference/index.md) is regenerated during builds and
preview reloads. Add descriptions in Python docstrings and JavaScript/Vue JSDoc
comments; new modules are discovered automatically. Run `yarn docs:build` to check
the full reference with strict validation. Node.js and development dependencies
are required for frontend extraction, but the ML runtimes are not.

## PR expectations

Use the [API](how-to/add-api-endpoint.md), [composable](how-to/change-composable.md),
and [worker-payload](how-to/change-worker-payload.md) guides for focused changes.
Report bugs and feature requests through [GitHub issues](https://github.com/mrogness/MimirOCR/issues),
including reproduction steps, platform, version/commit, and relevant errors.

- Add or update tests for behavior changes.
- Update worker contract docs when process-boundary JSON payloads or lifecycle behavior
  changes.
- Run docs generation when API routes or tests changes.

For isolated locks, optional tool groups, vulnerability reports, and dependency PR
review, see [dependency management](maintenance/dependencies.md).
