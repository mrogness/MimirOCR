# Documentation Automation

Architecture and workflow explanations are maintained manually. Source reference
pages, HTTP API artifacts, and the test inventory are generated automatically.

## Source code reference

Each MkDocs build discovers production Python modules under `backend/` and
JavaScript/Vue files under `src/`. It creates reference pages, symbol inventories,
and hierarchical navigation in memory using `mkdocs-gen-files` and
`mkdocs-literate-nav`. Python descriptions/signatures come from
`mkdocstrings[python]`; frontend symbols come from JSDoc, with Vue interface
metadata from `vue-docgen-api`. A Vue SFC adapter preserves script line positions.

Undocumented symbols remain visible, including named nested functions and
internal helpers. Source files own descriptions; add Python docstrings or JSDoc
comments there. Python extraction disables import-based inspection, so neither
ML environment is needed. Frontend extraction parses source without starting the
application. The existing OpenAPI generator still imports the lightweight API.

These reference pages are **not committed**. Every build starts from the current
source list, so additions and renames update the navigation and deletions leave
no stale pages. `mkdocs serve` also watches backend/frontend source directories.

The documentation tests also audit descriptions on production modules and named
callables. The frontend audit includes component props, events, and slots. Add
descriptions alongside new source interfaces so these checks continue to pass;
anonymous callbacks and test fixtures are outside this coverage requirement.

JSDoc `@example` and `@throws` sections are rendered alongside parameter/return
contracts. Tests establish that descriptions exist and extraction works; review
must still establish that the descriptions match behavior.

## HTTP schemas and worker examples

The HTTP page includes endpoint descriptions, parameters, request bodies, declared
responses, and linked component schemas. Runtime exceptions are not automatically
inferred; maintain [HTTP behavior](../reference/http-behavior.md) and route metadata.
The [worker examples](../contracts/worker-examples.md) render the committed JSON
fixture. Generation validates its envelopes and models without running inference.

## Build provenance

The home page and source-reference pages show the application version and actual
Git revision. `reference/build.json` provides the same metadata for tools.
Clean checkouts link to that exact commit rather than `main`. Modified checkouts
and source archives show local paths without potentially incorrect GitHub links.
Commits must exist on GitHub before their source links can resolve.

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
# Node 22.22.2 or newer within Node 22; Yarn Classic 1.22.22
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile
python -m pip install uv==0.13.4
python scripts/setup_backend.py --role backend --docs
yarn docs:generate
yarn docs:build
```

Or with Yarn scripts:

```sh
yarn docs:generate
yarn docs:build
```

## Regeneration triggers

Run `scripts/generate_docs.py` when:

- backend routes change
- HTTP schema fields or route/model descriptions change
- test files are added/removed/renamed
- test architecture changes in a way that should be reflected in the test inventory docs
- worker example fixtures or their domain/protocol models change

## Extending automation

`scripts/generate_docs.py` owns the committed OpenAPI and test-inventory artifacts.
`scripts/generate_reference.py` and `scripts/docs/` own build-time source reference
generation. Change discovery exclusions there if a new source area should be
included. Node.js and the Yarn development dependencies are needed for both
`docs:build` and `docs:serve`; backend docs dependencies remain in the locked
`docs` group. A missing parser or parse failure fails the build rather than
silently dropping a module.
