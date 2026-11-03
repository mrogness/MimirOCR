# Segmentation worker contract

Transport is UTF-8 JSON Lines over stdin/stdout. Each request and response carries
integer `version: 1` and an incrementing integer `id`. Unsupported versions fail;
there is no backward-compatibility adapter. Only one request is outstanding per
worker. stderr is for diagnostics.

See [complete worker exchanges](worker-examples.md) for valid, schema-checked JSON
and the downloadable fixture. First send an `init` request with `version: 1`,
`id: 1`, and `config` containing the JSON representation of `ProjectConfig`.
The worker loads its model once and replies
`{"version":1,"id":1,"type":"ready","role":"segmenter"}`.

Then send a `page` request with `version: 1`, `id: 2`, and `page` containing a
`Page` with ID, page number, absolute image path, dimensions, and metadata. The
response has `version: 1`, matching `id`, `type: "result"`, and a `page`. The returned
page keeps its ID/number and contains `Line` records with IDs, bounding boxes,
absolute crop paths, and baseline metadata including `source_order`.

Images never travel through the pipe. NumPy geometry values are converted to
JSON numbers/lists at serialization. The API validates returned page identity
and restores page order across parallel workers.

An engine exception returns `type: "error"` with an `error` string, then exits
nonzero. A native abort may produce no response; EOF is an error. Malformed JSON,
wrong IDs/types, crashes and per-request deadlines fail the job and stop sibling
workers. Worker lifetime and timeout details are in
[the runtime architecture](../architecture/ocr-process-split.md).
