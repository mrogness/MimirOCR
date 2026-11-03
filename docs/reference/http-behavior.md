# HTTP behavior and errors

The [generated HTTP reference](../generated/backend-openapi.md) renders the request,
parameter, response, and data schemas declared by FastAPI. Raised exceptions and
streamed media types are not always inferred into OpenAPI. This page records those
application behaviors explicitly; update it when route behavior changes.

## Connection and response conventions

The desktop frontend obtains the local API URL through Tauri; use `backendFetch`
rather than hardcoding port 8080. A standalone source API launched with
`node scripts/run_backend.mjs -m backend.sidecar_main` defaults to
`http://127.0.0.1:8080`. Its `/docs` and `/openapi.json` expose the live reference.
Full OCR additionally needs the segmenter and recognizer environments.

Ordinary JSON errors use `{"detail": ...}`. Detail can be a string, a structured
object (for example the busy-runtime error), or a validation-error list. Inspect
status and detail rather than assuming every error has a `message` field.

## Errors callers should handle

| Operation | Expected application errors |
| --- | --- |
| Project read/update/delete and page listing | 404 for an unknown project |
| PDF upload | 404 for an unknown project; 400 for rejected PDF MIME type; multipart validation may return 422 |
| DPI analysis | 400 for rejected MIME type or invalid/unreadable PDF |
| Start OCR | 404 for missing project/upload; 400 for another project's token; 409 when the runtime is reserved |
| Get job / list project jobs | 404 for unknown job/project; jobs do not survive API restart |
| Job transcript | 409 until success; 404 for unknown job or unavailable transcript artifact |
| Update/delete line | 404 for an unknown line |
| Restore line | 404 for missing page; 409 if the line ID exists; 400 for other invalid restoration state |
| PDF export | 404 for unknown project; 400 for absent pages or no usable reading-layout text; 500 if the PDF dependency is unavailable |
| Training-data export | 404 for unknown project; 400 for absent pages or no eligible image/text pairs |
| Prepare/cancel restart | 409 for rejected admission/reservation conditions; prepare can return 500 if reservation writing fails |

Typed input validation can return 422. Unexpected server/I/O failures can return
500; the table describes known application errors rather than every possible failure.

Job admission success does not guarantee successful OCR. Later worker errors appear
in HTTP 200 polling responses with `status: "failed"` and an `error` field. Check
terminal job status as well as HTTP status.

## Downloads and persistence

PDF export streams `application/pdf`; training export streams `application/zip`.
Both use `Content-Disposition: attachment` with a filename. They are binary
downloads. The transcript endpoint returns JSON with `job_id` and `transcript`.

Project pages and review corrections are durable SQLite records. Upload tokens,
job snapshots, and runtime gate state are in memory; restart handoff also uses a
short-lived reservation file. Upload tokens are consumed during admission, so a
failed/rejected attempt may require another upload. Successful replacement upload
clears the previous dataset.

Domain lines have string IDs and `correct_text`; HTTP lines have integer IDs and
`corrected_text`. Domain `char_confidence` is an array, while its current HTTP field
is a persisted JSON string. Worker records are not interchangeable with HTTP models.
