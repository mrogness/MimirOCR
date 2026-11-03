# Follow one document through MimirOCR

This walkthrough connects the desktop workflow to the functions that implement it.
Use a small PDF containing Dano-Norwegian Fraktur. The result is a saved project,
reviewable OCR text, one correction, and an exported PDF. Accuracy depends on the
scan and model; successful processing does not mean the transcription is correct.

## 1. Prepare and launch

On macOS ARM or Windows x64, follow [development setup](../architecture/ocr-process-split.md).
You need Node 22.22.2 or newer within Node 22, Yarn Classic 1.22.22, uv 0.13.4,
and the Tauri system prerequisites. Setup selects Python 3.11 for each runtime.

From the repository root:

```sh
python -m pip install uv==0.13.4
python scripts/setup_backend.py --dev --build
yarn install --frozen-lockfile
yarn tauri:dev:auto
```

The first setup installs the ML environments and can take time. When the dashboard
appears, Tauri has started the API sidecar; the ML workers are launched for OCR.
See [troubleshooting](../how-to/troubleshooting.md) if setup or startup fails.

## 2. Create a project and select the PDF

Create a project named `Documentation walkthrough`, open it, and select your PDF.
Start with the default 300 DPI and threshold 170. These control PDF rasterization
and line-crop binarization; they do not change the original PDF. The optional DPI
analysis recommends a rasterization resolution rather than measuring OCR quality.

`ProjectsView.vue` assembles the project screen. Its `useUploadActions()` composable
owns file selection feedback, settings, upload, and job submission.

## 3. Start OCR and follow progress

Start processing. The client first sends multipart `file` data to
`POST /files/projects/{project_id}/upload-pdf`. The response contains an
`upload_id`; it is not an OCR job ID. A successful replacement upload clears the
previous dataset, so use a new project when you need to preserve an earlier run.

The client then sends the token to `POST /ocr/projects/{project_id}/jobs`:

```json
{
  "upload_id": "replace-with-the-upload-response-token",
  "config": {
    "dpi": 300,
    "binarization_threshold": 170,
    "device": "cpu",
    "strict_top_to_bottom": false,
    "disambiguate_ij": true
  }
}
```

The API returns a job snapshot. Admission can fail with HTTP 409 while another
job or restart reservation owns the runtime. Once admitted, later processing
errors appear in a job with `status: "failed"` and an `error` message.

`useOcrPolling()` polls `GET /ocr/jobs/{job_id}` without overlapping requests.
Watch the preparing, segmenting, OCR, and exporting phases. The worker chain is:

| Step | Owner | Observable result |
| --- | --- | --- |
| Admit | `backend/services/ocr_jobs.py:start_job` | Runtime reservation and job ID |
| Rasterize | `backend/pipeline/prepare.py` | Page images and dimensions |
| Segment | `backend/workers/segmenter/engine.py` | Ordered line crops and geometry |
| Recognize | `backend/workers/recognizer/engine.py` | Text and confidence metadata |
| Persist | `backend/services/ocr_jobs.py:run_ocr_job` and repository | SQLite pages/lines and finished job |

Only proceed to review after `succeeded`. A failed job is not fixed by repeatedly
polling it. Job/upload records belong to the current API process and are not durable;
the project and successfully persisted review data are stored in SQLite.

## 4. Review and correct one line

Open review, select a line, and correct a recognizable word. Wait for the save
indicator to finish, then leave and reopen review. The correction should remain.

`useProjectReviewData()` loads `GET /projects/{project_id}/pages`.
`useLineEditing()` updates the local line and debounces the write for 350 ms:

```http
PATCH /lines/42
Content-Type: application/json

{"corrected_text":"A corrected transcription"}
```

Replace `42` with the persisted line ID from your page response. HTTP line IDs are
integers; they are different from the string IDs used inside the worker protocol.
The route calls repository code and returns the committed line in a `line` envelope.
Character confidences describe model output, not confidence in your manual edit.

## 5. Export and check the result

Open PDF export and choose a layout. The review client awaits queued text saves
before requesting the download; a save failure must be resolved before exporting.
`POST /export/projects/{project_id}/pdf` accepts the export settings and streams
the generated PDF. Open the download and locate the word you corrected.

At this point you have verified upload, both workers, persistence, correction, and
export on your machine. This is a manual workflow check, not an accuracy benchmark.
For automated checks, see [testing](../testing.md). For exact fields and defaults,
see the [HTTP reference](../generated/backend-openapi.md).

## Continue into the code

Browse the [source reference](../reference/index.md), then try a focused guide:
[add an endpoint](../how-to/add-api-endpoint.md),
[change a composable](../how-to/change-composable.md), or
[change a worker payload](../how-to/change-worker-payload.md).
