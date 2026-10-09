# Documentation Automation

This project uses a mixed docs workflow: generated artifacts plus hand-written
architecture/runbook content.

## What updates automatically in CI

The docs workflow at .github/workflows/docs.yml runs on pull requests and pushes
to main.

It performs these steps:

1. Regenerates derived docs with scripts/generate_docs.py.
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

Run scripts/generate_docs.py when:

- backend route surface changes
- test files are added/removed/renamed
- test architecture changes in a way that should be reflected in inventory docs

## Extending automation

To include additional generated references over time, extend
scripts/generate_docs.py and add resulting outputs under docs/generated.
