# Documentation Automation

Much of the documentation in this project is manually maintained, but select pieces are automatically generated.

## What updates automatically in CI

The docs workflow at .github/workflows/docs.yml runs on pull requests and pushes
to main.

It performs these steps:

1. Regenerates generated docs with `scripts/generate_docs.py`.
2. Fails the workflow if docs/generated output changed but was not committed.
3. Builds the MkDocs site in strict mode.
4. Deploys the built site to GitHub Pages on pushes to main.

## What contributors should run locally

```sh
python -m pip install -r requirements-docs.txt
python scripts/generate_docs.py
mkdocs build --strict
```

Or with Yarn scripts:

```sh
yarn docs:generate
yarn docs:build
```

## Regeneration triggers

Run `scripts/generate_docs.py` when:

- backend routes change
- test files are added/removed/renamed
- test architecture changes in a way that should be reflected in the test inventory docs

## Extending automation

To include additional generated references over time, extend
`scripts/generate_docs.py` and add resulting outputs under docs/generated.
