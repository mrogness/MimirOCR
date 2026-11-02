# Contributing

For desktop development and packaging, start with [isolated runtime setup](architecture/ocr-process-split.md).
For source navigation, see [backend code organization](architecture/backend-organization.md)
and [frontend code organization](architecture/frontend-organization.md).
The [testing guide](testing.md) explains isolation and coverage; the
[test inventory](generated/test-inventory.md) lists the current test files.

## Local setup

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

## PR expectations

- Add or update tests for behavior changes.
- Update worker contract docs when process-boundary JSON payloads or lifecycle behavior
  changes.
- Run docs generation when API routes or tests changes.

For isolated locks, optional tool groups, vulnerability reports, and dependency PR
review, see [dependency management](maintenance/dependencies.md).
