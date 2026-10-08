# Contributing

For desktop development and packaging, start with [isolated runtime setup](architecture/ocr-process-split.md).
For source navigation, see [backend code organization](architecture/backend-organization.md).
The [testing guide](testing.md) explains isolation and coverage; the
[test inventory](generated/test-inventory.md) lists the current test files.

## Local setup

1. Python backend tests

```sh
python -m pip install -r requirements-test.txt
python -m pytest
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
python -m pip install -r requirements-docs.txt
```

2. Regenerate derived docs

```sh
python scripts/generate_docs.py
```

3. Build and preview docs

```sh
mkdocs serve
```

## PR expectations

- Add or update tests for behavior changes.
- Update contract docs when process-boundary payloads or lifecycle behavior
  changes.
- Run docs generation when API route surface or test topology changes.
