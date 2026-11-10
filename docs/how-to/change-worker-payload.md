# Change a worker payload

Use this guide when changing the data exchanged between the API and either ML
worker. The boundary is JSON Lines and disk paths, not HTTP or Python engine objects.
Start with the [segmentation](../contracts/segmentation-worker-contract.md) and
[recognition](../contracts/ocr-worker-contract.md) contracts.

## Trace both sides

| Concern | Source owner |
| --- | --- |
| Envelope version and JSON encoding | `backend/workers/protocol.py` |
| Config, page, line fields | `backend/domain/project_config.py`, `page.py`, `line.py` |
| Spawn, request deadlines, response identity | `backend/workers/client.py` |
| Init/page request dispatch | `backend/workers/server.py` |
| Segmentation output / recognition input | `backend/workers/segmenter/engine.py` |
| Recognition metadata | `backend/workers/recognizer/engine.py` and `predictions.py` |
| Persisted review representation | `backend/persistence/repository.py` and HTTP schemas |

Add the domain field and document its type, units, default, and null behavior.
For geometry, identify page pixels versus line-crop coordinates. Update the producer,
consumer, serialization, and persistence only where the field must travel. A worker
field does not automatically become an HTTP field or a database column.

Preserve page and line identities and define ordering explicitly. Keep images on disk;
send absolute paths. NumPy values must become finite JSON numbers/lists. Never print
diagnostic or model output to the protocol stdout stream.

## Choose version behavior explicitly

The current envelope is version 1; unsupported versions are rejected and there is no
adapter. A defaulted optional field can often keep version 1. For a breaking change,
update `VERSION`, both sides, fixtures, and contract pages together. Rebuild/distribute
all three runtimes as a matched set; do not mix workers from another app build.

## Update examples and checks

Edit [worker-exchanges.json](../contracts/examples/worker-exchanges.json). It contains
complete init/page requests and replies for both roles, with segmentation output fed
into recognition. `yarn docs:generate` validates it against the current protocol and
Pydantic models without loading models or reading the illustrative image paths.

Extend model-free helper and subprocess tests for the new field, its defaults,
round-trip preservation, and malformed replies. If changing real engine output,
also run native inference checks on supported systems:

```sh
python scripts/setup_backend.py --role backend --dev --docs
node scripts/run_backend.mjs -m pytest backend/tests/test_worker_processes.py backend/tests/test_ocr_fake_worker_integration.py
yarn docs:generate
yarn docs:build
# On macOS ARM or Windows x64, after syncing all runtime environments:
python scripts/setup_backend.py
yarn test:ml
```

Model-free tests protect the boundary. Native ML and packaged smoke tests protect
engine compatibility and bundled resources; one does not replace the other.
