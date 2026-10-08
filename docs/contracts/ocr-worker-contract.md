# OCR worker contract

The recognizer uses the same JSON Lines envelope, version, request IDs and error
handling as the [segmentation worker](segmentation-worker-contract.md).

- `op: "init"` supplies JSON `ProjectConfig`, loads the Calamari model once, and
  returns `type: "ready", role: "recognizer"`.
- `op: "page"` supplies a `Page` with ordered line IDs, crop paths and geometry.
- `type: "result"` returns the page with OCR text, line confidence,
  per-character confidence and positions/candidates. Geometry and ordering stay
  attached to the original line records. Existing I/J processing is preserved.
- The API verifies page identity and the exact sequence of line IDs. The engine
  rejects a prediction count that differs from the number of crops.

The predictor is reused across pages in one job. Empty pages return without
inference. Crop images stay on disk and are loaded in the recognizer environment;
no TensorFlow objects or pickles cross the process boundary. There is no HTTP API,
worker-owned database connection, or independent job store.
