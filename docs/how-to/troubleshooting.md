# Troubleshoot setup, documentation, and OCR

Start with the failing layer. Installed desktop apps contain their runtimes;
source development and documentation builds need local tools.

| Symptom | Check and next step |
| --- | --- |
| Yarn rejects `nopt` on Node 22.19 | Install Node 22.22.2 or later within Node 22, or Node 24.15.0+ within Node 24. A version manager is optional; the official installer works. Rerun `yarn install --frozen-lockfile`. |
| `yarn` is unavailable | With Node 22, run `corepack enable` and `corepack prepare yarn@1.22.22 --activate`. If your Node distribution does not supply Corepack, install Yarn Classic 1.22.22 separately. |
| Docs report missing JSDoc/Vue parsers | Run `yarn install --frozen-lockfile`. A production-only dependency install is insufficient for docs builds. |
| MkDocs or a Python docs plugin is missing | Run `python scripts/setup_backend.py --role backend --docs`, then use the Yarn docs commands to select that environment. |
| Locked Python setup fails | Check the named runtime's manifest and `uv.lock`. Setup uses `uv sync --locked`; update the manifest/lock rather than installing arbitrary versions into an environment. See [dependencies](../maintenance/dependencies.md). |
| Worker runtime is missing | In source development, run `python scripts/setup_backend.py`. Remove stale `MIMIR_SEGMENTER_PYTHON` / `MIMIR_RECOGNIZER_PYTHON` overrides or point them to the correct environments. For installed apps, check the bundled runtimes. |
| OCR submission returns HTTP 409 | Inspect `/system/runtime`. Another job or restart reservation may own the gate; wait or resolve it before resubmitting. |
| Upload token or job returns 404 after restart | These records are in memory. Upload again for a new token. Successfully persisted project pages remain available through project endpoints. |
| A job reaches `failed` | Read its `error` and API/worker stderr tail. Check the reported runtime, model, input, or timeout. Polling a failed job does not restart it. |
| Export reports unsaved corrections | Retry failed line saves first. The review client awaits saves; cancelling timers does not save edits. |
| Complex layout has wrong line order | Compare learned order with the strict geometric ordering option on a separate run. Neither guarantees correct newspaper/marginal layout. Preserve the original project before replacing its PDF. |
| Source reference has no GitHub links | A modified checkout or source archive cannot reliably match GitHub line numbers. Local source paths are shown instead. Commit the patch for revision links; that commit must exist on GitHub for its links to resolve. |

## Reproduce documentation checks

Run from the repository root:

```sh
yarn install --frozen-lockfile
python scripts/setup_backend.py --role backend --docs
yarn docs:generate
node --test scripts/tests/docs.test.mjs
python -m unittest discover -s scripts/tests -p "test_docs.py"
yarn docs:build
```

Generation validates worker examples and refreshes committed HTTP/test artifacts.
The strict build extracts source references and checks site links. Commit changes
under `docs/generated/`. Description tests find missing text; accuracy still needs
review against the implementation.

## Report a reproducible problem

Use [repository issues](https://github.com/mrogness/MimirOCR/issues) for bug reports
and feature requests. Include app version or commit, OS/architecture, the failing
command, and error text. Include Node version for Yarn errors, and run settings
plus a small shareable input for OCR errors. State whether the failure occurs in
source development, native ML tests, or the packaged app.
