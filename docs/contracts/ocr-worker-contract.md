# OCR worker contract

The recognizer uses the same JSON Lines envelope, version, request IDs and error
handling as the [segmentation worker](segmentation-worker-contract.md).

- `op: "init"` supplies JSON `ProjectConfig`, loads the Calamari model once, and
  returns `type: "ready", role: "recognizer"`.
- `op: "page"` supplies a `Page` with ordered line IDs, crop paths and geometry.
- `type: "result"` returns the page with OCR text, line confidence,
  per-character confidence and positions/candidates. Geometry and ordering stay
  attached to the original line records.
- The API verifies page identity and the exact sequence of line IDs. The engine
  rejects a prediction count that differs from the number of crops.

See [complete worker exchanges](worker-examples.md) for init/page requests and
responses. I/J processing replaces capital `I` with an I/J spelling only when
exactly one variant matches the case-folded lexicon. Words without a unique match,
or with more than eight ambiguous glyphs, remain unchanged. Confidence and candidate
metadata still describe the original model output, independently of this text change.

The predictor is reused across pages in one job. Empty pages return without
inference. Crop images stay on disk and are loaded in the recognizer environment;
no TensorFlow objects or pickles cross the process boundary. There is no HTTP API,
worker-owned database connection, or independent job store.
