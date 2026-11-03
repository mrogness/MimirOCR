# Backend HTTP API reference

Generated from the current FastAPI OpenAPI schema. Edit route metadata, request/response
models, or the generator, then run `yarn docs:generate`; do not edit this page.

See [HTTP behavior and errors](../reference/http-behavior.md) for streamed downloads,
job failure semantics, and runtime errors that FastAPI does not infer from exceptions.

| Method | Path | Summary | Tags |
|---|---|---|---|
| GET | [`/`](#get) | Root |  |
| GET | [`/export/projects/{project_id}/pdf`](#get-export-projects-project-id-pdf) | Export Project Pdf Get | export |
| POST | [`/export/projects/{project_id}/pdf`](#post-export-projects-project-id-pdf) | Export Project Pdf Post | export |
| GET | [`/export/projects/{project_id}/training-data`](#get-export-projects-project-id-training-data) | Export Project Training Data | export |
| POST | [`/files/analyze-pdf-dpi`](#post-files-analyze-pdf-dpi) | Analyze Uploaded Pdf Dpi | files |
| POST | [`/files/projects/{project_id}/upload-pdf`](#post-files-projects-project-id-upload-pdf) | Upload Pdf For Project | files |
| GET | [`/health`](#get-health) | Health |  |
| POST | [`/lines/restore`](#post-lines-restore) | Restore Line | lines |
| DELETE | [`/lines/{line_id}`](#delete-lines-line-id) | Delete Line | lines |
| PATCH | [`/lines/{line_id}`](#patch-lines-line-id) | Update Line | lines |
| GET | [`/ocr/jobs/{job_id}`](#get-ocr-jobs-job-id) | Get Ocr Job | ocr |
| GET | [`/ocr/jobs/{job_id}/transcript`](#get-ocr-jobs-job-id-transcript) | Get Ocr Job Transcript | ocr |
| GET | [`/ocr/projects/{project_id}/jobs`](#get-ocr-projects-project-id-jobs) | List Project Ocr Jobs | ocr |
| POST | [`/ocr/projects/{project_id}/jobs`](#post-ocr-projects-project-id-jobs) | Start Ocr Job | ocr |
| GET | [`/projects/`](#get-projects) | List Projects | projects |
| POST | [`/projects/`](#post-projects) | Create Project | projects |
| DELETE | [`/projects/{project_id}`](#delete-projects-project-id) | Delete Project | projects |
| GET | [`/projects/{project_id}`](#get-projects-project-id) | Read Project | projects |
| PUT | [`/projects/{project_id}`](#put-projects-project-id) | Update Project | projects |
| GET | [`/projects/{project_id}/pages`](#get-projects-project-id-pages) | List Project Pages | projects |
| GET | [`/projects/{project_id}/pages/{page_id}/image`](#get-projects-project-id-pages-page-id-image) | Get Project Page Image | projects |
| GET | [`/projects/{project_id}/source-pdf`](#get-projects-project-id-source-pdf) | Get Project Source Pdf | projects |
| GET | [`/system/cpu`](#get-system-cpu) | Get Cpu Info | system |
| POST | [`/system/restart/cancel`](#post-system-restart-cancel) | Cancel Backend Restart | system |
| POST | [`/system/restart/prepare`](#post-system-restart-prepare) | Prepare Backend Restart | system |
| GET | [`/system/runtime`](#get-system-runtime) | Get Runtime Info | system |

## GET `/` { #get }

Return the minimal root response used to identify the API service.

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |

## GET `/export/projects/{project_id}/pdf` { #get-export-projects-project-id-pdf }

Download a project PDF using export options supplied as query parameters.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |
| `layout_mode` | query | False | `string` | default: `"source-lines"`; enum: `["source-lines", "reading"]` |
| `font_family` | query | False | `string` | default: `"Times-Roman"`; enum: `["Times-Roman", "Helvetica", "Courier"]` |
| `font_size` | query | False | `number` | default: `12.0` |
| `line_spacing` | query | False | `number` | default: `1.35` |
| `margin_in` | query | False | `number` | default: `0.8` |
| `spread_mode` | query | False | `string` | default: `"split-spread"`; enum: `["single", "split-spread"]` |
| `join_historical_line_breaks` | query | False | `boolean` | default: `true` |
| `normalize_low_double_quote` | query | False | `boolean` | default: `false` |
| `normalize_long_s` | query | False | `boolean` | default: `false` |
| `normalize_double_oblique_hyphen` | query | False | `boolean` | default: `false` |
| `fit_text_to_page` | query | False | `boolean` | default: `true` |
| `page_size` | query | False | `string` | default: `"letter"`; enum: `["letter", "a4"]` |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## POST `/export/projects/{project_id}/pdf` { #post-export-projects-project-id-pdf }

Download a project PDF using layout and normalization options from the JSON request
body.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Request body

Required: **True**.

Content type: `application/json`. Schema: [ExportPdfRequest](#schema-exportpdfrequest).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/export/projects/{project_id}/training-data` { #get-export-projects-project-id-training-data }

Download a ZIP of eligible line crops and transcriptions.

Return HTTP 404 for a missing project and translate archive-generation failures into
their declared HTTP status.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## POST `/files/analyze-pdf-dpi` { #post-files-analyze-pdf-dpi }

Estimate scan resolution from an uploaded PDF without persisting the file.

Reject non-PDF content types and invalid PDF data with HTTP 400. Run the CPU-bound
analysis in a thread so it does not block the async request loop.

### Request body

Required: **True**.

Content type: `multipart/form-data`. Schema: [Body_analyze_uploaded_pdf_dpi_files_analyze_pdf_dpi_post](#schema-body-analyze-uploaded-pdf-dpi-files-analyze-pdf-dpi-post).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [PdfDpiAnalysisResponse](#schema-pdfdpianalysisresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## POST `/files/projects/{project_id}/upload-pdf` { #post-files-projects-project-id-upload-pdf }

Store a replacement PDF, clear the previous OCR dataset, and return an upload token.

Read and write the replacement before clearing persisted pages, job records, and old
artifacts. A read or file-write failure preserves the previous dataset; errors later in
the replacement sequence can still propagate. The token identifies the stored file for a
subsequent OCR job.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Request body

Required: **True**.

Content type: `multipart/form-data`. Schema: [Body_upload_pdf_for_project_files_projects__project_id__upload_pdf_post](#schema-body-upload-pdf-for-project-files-projects-project-id-upload-pdf-post).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [UploadedPdfResponse](#schema-uploadedpdfresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/health` { #get-health }

Report that the HTTP API is responsive without loading either ML runtime.

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |

## POST `/lines/restore` { #post-lines-restore }

Restore a deleted review line and its saved page ordering.

Map a missing page to HTTP 404, an occupied line ID to 409, and an invalid restoration
snapshot to 400.

### Request body

Required: **True**.

Content type: `application/json`. Schema: [LineRestoreRequest](#schema-linerestorerequest).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [LineRestoreResponse](#schema-linerestoreresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## DELETE `/lines/{line_id}` { #delete-lines-line-id }

Delete a persisted review line and return an empty HTTP 204 response; an unknown ID
produces 404.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `line_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 204 | Successful Response | — | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## PATCH `/lines/{line_id}` { #patch-lines-line-id }

Persist corrected text and optional ordering, returning the refreshed review line.

When the supplied line ID is absent, optionally locate the line by page ID and order.
Return HTTP 404 when neither lookup finds a line.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `line_id` | path | True | `integer` |  |

### Request body

Required: **True**.

Content type: `application/json`. Schema: [LineUpdateRequest](#schema-lineupdaterequest).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [LineUpdateResponse](#schema-lineupdateresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/ocr/jobs/{job_id}` { #get-ocr-jobs-job-id }

Return one retained job snapshot, or HTTP 404 when its ID is unknown to this API
process.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `job_id` | path | True | `string` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [OcrJobResponse](#schema-ocrjobresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/ocr/jobs/{job_id}/transcript` { #get-ocr-jobs-job-id-transcript }

Read the completed job's UTF-8 transcript from disk.

Return HTTP 409 until the job has succeeded, and 404 for an unknown job, absent artifact
path, or missing transcript file.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `job_id` | path | True | `string` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/ocr/projects/{project_id}/jobs` { #get-ocr-projects-project-id-jobs }

List retained job snapshots newest first after verifying that the project exists.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [OcrJobsListResponse](#schema-ocrjobslistresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## POST `/ocr/projects/{project_id}/jobs` { #post-ocr-projects-project-id-jobs }

Admit and start an OCR job for an existing project and upload token.

The job service reserves the runtime and starts background execution. Translate
admission and validation errors to HTTP responses and return the initial polling
snapshot.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Request body

Required: **True**.

Content type: `application/json`. Schema: [OcrJobStartRequest](#schema-ocrjobstartrequest).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [OcrJobResponse](#schema-ocrjobresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/projects/` { #get-projects }

Return the repository's project listing in the HTTP collection envelope.

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [ProjectsListResponse](#schema-projectslistresponse) |

## POST `/projects/` { #post-projects }

Create and commit a project with the requested name, returning its persistent metadata.

### Request body

Required: **True**.

Content type: `application/json`. Schema: [ProjectCreate](#schema-projectcreate).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 201 | Successful Response | application/json | [ProjectRead](#schema-projectread) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## DELETE `/projects/{project_id}` { #delete-projects-project-id }

Remove project job records, filesystem artifacts, and database rows, then return HTTP
204.

The route reports an unknown project as 404. Filesystem cleanup occurs before the
repository commits the row deletion.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 204 | Successful Response | — | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/projects/{project_id}` { #get-projects-project-id }

Return persistent project metadata, or HTTP 404 for an unknown project ID.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [ProjectRead](#schema-projectread) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## PUT `/projects/{project_id}` { #put-projects-project-id }

Rename an existing project and return the committed metadata; unknown IDs produce HTTP
404.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Request body

Required: **True**.

Content type: `application/json`. Schema: [ProjectUpdate](#schema-projectupdate).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [ProjectRead](#schema-projectread) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/projects/{project_id}/pages` { #get-projects-project-id-pages }

Return stored pages with ordered lines and decoded review geometry.

Sort each page's lines by persisted order, using line ID as a tie-breaker, and decode
polygon and character-position JSON for the frontend.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | [ProjectPagesResponse](#schema-projectpagesresponse) |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/projects/{project_id}/pages/{page_id}/image` { #get-projects-project-id-pages-page-id-image }

Serve a persisted page image after checking project ownership and file availability.

Disable browser caching so a rerun can replace the image without showing obsolete page
content. Missing records or files produce HTTP 404.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |
| `page_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/projects/{project_id}/source-pdf` { #get-projects-project-id-source-pdf }

Serve the project's stored source PDF as an attachment with caching disabled.

Require project metadata, an original filename, and an existing file; missing
prerequisites produce HTTP 404.

### Parameters

| Name | Location | Required | Schema | Details |
|---|---|---|---|---|
| `project_id` | path | True | `integer` |  |

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | Not declared |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/system/cpu` { #get-system-cpu }

Report logical CPU count and the active profile's default segmentation worker count.

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |

## POST `/system/restart/cancel` { #post-system-restart-cancel }

Cancel the matching unexpired restart token and remove its reservation file.

Return HTTP 409 when the token is missing, expired, or does not match the pending
reservation.

### Request body

Required: **True**.

Content type: `application/json`. Schema: [RestartCancelRequest](#schema-restartcancelrequest).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## POST `/system/restart/prepare` { #post-system-restart-prepare }

Reserve an idle backend for restart and write the token the desktop host must present.

Return HTTP 409 while a job or another restart is reserved. If writing the reservation
fails, release the gate and return HTTP 500.

### Request body

Required: **True**.

Content type: `application/json`. Schema: [RestartPrepareRequest](#schema-restartpreparerequest).

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |
| 422 | Validation Error | application/json | [HTTPValidationError](#schema-httpvalidationerror) |

## GET `/system/runtime` { #get-system-runtime }

Combine the runtime gate's public job/restart snapshot with resolved performance limits.

### Declared responses

| Status | Description | Content type | Schema |
|---|---|---|---|
| 200 | Successful Response | application/json | `object` |

## Data schemas

Required means the field must be present; nullable means its value may be `null`.
A default is not a validation limit. Expand the JSON definition for the exact schema.

### Body_analyze_uploaded_pdf_dpi_files_analyze_pdf_dpi_post { #schema-body-analyze-uploaded-pdf-dpi-files-analyze-pdf-dpi-post }

| Field | Required | Schema | Details |
|---|---|---|---|
| `file` | True | `string` | A PDF file to analyze without storing |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "file": {
      "type": "string",
      "contentMediaType": "application/octet-stream",
      "title": "File",
      "description": "A PDF file to analyze without storing"
    }
  },
  "type": "object",
  "required": [
    "file"
  ],
  "title": "Body_analyze_uploaded_pdf_dpi_files_analyze_pdf_dpi_post"
}
```

</details>

### Body_upload_pdf_for_project_files_projects__project_id__upload_pdf_post { #schema-body-upload-pdf-for-project-files-projects-project-id-upload-pdf-post }

| Field | Required | Schema | Details |
|---|---|---|---|
| `file` | True | `string` | A PDF file |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "file": {
      "type": "string",
      "contentMediaType": "application/octet-stream",
      "title": "File",
      "description": "A PDF file"
    }
  },
  "type": "object",
  "required": [
    "file"
  ],
  "title": "Body_upload_pdf_for_project_files_projects__project_id__upload_pdf_post"
}
```

</details>

### DeletedLineSnapshot { #schema-deletedlinesnapshot }

Serializable review-line contents needed to restore a deletion, including recognition
metadata.

| Field | Required | Schema | Details |
|---|---|---|---|
| `id` | True | `integer` |  |
| `page_id` | True | `integer` |  |
| `line_order` | False | `integer` or `null` |  |
| `img_path` | False | `string` or `null` |  |
| `bounding_box` | False | `object` or `null` |  |
| `polygon_points` | False | array of array of `number` or `null` |  |
| `ocr_text` | False | `string` or `null` |  |
| `corrected_text` | False | `string` or `null` |  |
| `line_confidence` | False | `number` or `null` |  |
| `char_confidence` | False | `unspecified` or `null` |  |
| `char_positions` | False | array of `object` or `null` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "id": {
      "type": "integer",
      "title": "Id"
    },
    "page_id": {
      "type": "integer",
      "title": "Page Id"
    },
    "line_order": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Line Order"
    },
    "img_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Img Path"
    },
    "bounding_box": {
      "anyOf": [
        {
          "additionalProperties": true,
          "type": "object"
        },
        {
          "type": "null"
        }
      ],
      "title": "Bounding Box"
    },
    "polygon_points": {
      "anyOf": [
        {
          "items": {
            "items": {
              "type": "number"
            },
            "type": "array"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "title": "Polygon Points"
    },
    "ocr_text": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Ocr Text"
    },
    "corrected_text": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Corrected Text"
    },
    "line_confidence": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ],
      "title": "Line Confidence"
    },
    "char_confidence": {
      "anyOf": [
        {},
        {
          "type": "null"
        }
      ],
      "title": "Char Confidence"
    },
    "char_positions": {
      "anyOf": [
        {
          "items": {
            "additionalProperties": true,
            "type": "object"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "title": "Char Positions"
    }
  },
  "type": "object",
  "required": [
    "id",
    "page_id"
  ],
  "title": "DeletedLineSnapshot",
  "description": "Serializable review-line contents needed to restore a deletion, including recognition\nmetadata."
}
```

</details>

### ExportPdfRequest { #schema-exportpdfrequest }

PDF layout and normalization choices sent by the export settings sheet.

Font sizes are points, margins are inches, and line_spacing is a font-size
multiplier. Export code owns the rendering rules for each layout mode.

| Field | Required | Schema | Details |
|---|---|---|---|
| `layout_mode` | False | `string` | default: `"source-lines"`; enum: `["source-lines", "reading"]` |
| `font_family` | False | `string` | default: `"Times-Roman"`; enum: `["Times-Roman", "Helvetica", "Courier"]` |
| `font_size` | False | `number` | default: `12.0` |
| `line_spacing` | False | `number` | default: `1.35` |
| `margin_in` | False | `number` | default: `0.8` |
| `spread_mode` | False | `string` | default: `"split-spread"`; enum: `["single", "split-spread"]` |
| `join_historical_line_breaks` | False | `boolean` | default: `true` |
| `normalize_low_double_quote` | False | `boolean` | default: `false` |
| `normalize_long_s` | False | `boolean` | default: `false` |
| `normalize_double_oblique_hyphen` | False | `boolean` | default: `false` |
| `fit_text_to_page` | False | `boolean` | default: `true` |
| `page_size` | False | `string` | default: `"letter"`; enum: `["letter", "a4"]` |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "layout_mode": {
      "type": "string",
      "enum": [
        "source-lines",
        "reading"
      ],
      "title": "Layout Mode",
      "default": "source-lines"
    },
    "font_family": {
      "type": "string",
      "enum": [
        "Times-Roman",
        "Helvetica",
        "Courier"
      ],
      "title": "Font Family",
      "default": "Times-Roman"
    },
    "font_size": {
      "type": "number",
      "title": "Font Size",
      "default": 12.0
    },
    "line_spacing": {
      "type": "number",
      "title": "Line Spacing",
      "default": 1.35
    },
    "margin_in": {
      "type": "number",
      "title": "Margin In",
      "default": 0.8
    },
    "spread_mode": {
      "type": "string",
      "enum": [
        "single",
        "split-spread"
      ],
      "title": "Spread Mode",
      "default": "split-spread"
    },
    "join_historical_line_breaks": {
      "type": "boolean",
      "title": "Join Historical Line Breaks",
      "default": true
    },
    "normalize_low_double_quote": {
      "type": "boolean",
      "title": "Normalize Low Double Quote",
      "default": false
    },
    "normalize_long_s": {
      "type": "boolean",
      "title": "Normalize Long S",
      "default": false
    },
    "normalize_double_oblique_hyphen": {
      "type": "boolean",
      "title": "Normalize Double Oblique Hyphen",
      "default": false
    },
    "fit_text_to_page": {
      "type": "boolean",
      "title": "Fit Text To Page",
      "default": true
    },
    "page_size": {
      "type": "string",
      "enum": [
        "letter",
        "a4"
      ],
      "title": "Page Size",
      "default": "letter"
    }
  },
  "type": "object",
  "title": "ExportPdfRequest",
  "description": "PDF layout and normalization choices sent by the export settings sheet.\n\nFont sizes are points, margins are inches, and line_spacing is a font-size\nmultiplier. Export code owns the rendering rules for each layout mode."
}
```

</details>

### HTTPValidationError { #schema-httpvalidationerror }

| Field | Required | Schema | Details |
|---|---|---|---|
| `detail` | False | array of [ValidationError](#schema-validationerror) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "detail": {
      "items": {
        "$ref": "#/components/schemas/ValidationError"
      },
      "type": "array",
      "title": "Detail"
    }
  },
  "type": "object",
  "title": "HTTPValidationError"
}
```

</details>

### LineOrderSnapshot { #schema-lineordersnapshot }

Saved line ID and order used to restore a page's arrangement during undo.

| Field | Required | Schema | Details |
|---|---|---|---|
| `id` | True | `integer` |  |
| `line_order` | True | `integer` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "id": {
      "type": "integer",
      "title": "Id"
    },
    "line_order": {
      "type": "integer",
      "title": "Line Order"
    }
  },
  "type": "object",
  "required": [
    "id",
    "line_order"
  ],
  "title": "LineOrderSnapshot",
  "description": "Saved line ID and order used to restore a page's arrangement during undo."
}
```

</details>

### LineRestoreRequest { #schema-linerestorerequest }

Deleted line snapshot and page-order snapshot submitted by the undo workflow.

| Field | Required | Schema | Details |
|---|---|---|---|
| `line` | True | [DeletedLineSnapshot](#schema-deletedlinesnapshot) |  |
| `line_orders` | True | array of [LineOrderSnapshot](#schema-lineordersnapshot) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "line": {
      "$ref": "#/components/schemas/DeletedLineSnapshot"
    },
    "line_orders": {
      "items": {
        "$ref": "#/components/schemas/LineOrderSnapshot"
      },
      "type": "array",
      "title": "Line Orders"
    }
  },
  "type": "object",
  "required": [
    "line",
    "line_orders"
  ],
  "title": "LineRestoreRequest",
  "description": "Deleted line snapshot and page-order snapshot submitted by the undo workflow."
}
```

</details>

### LineRestoreResponse { #schema-linerestoreresponse }

Envelope containing the restored persistent line and its review metadata.

| Field | Required | Schema | Details |
|---|---|---|---|
| `line` | True | [ProjectLineRead](#schema-projectlineread) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "line": {
      "$ref": "#/components/schemas/ProjectLineRead"
    }
  },
  "type": "object",
  "required": [
    "line"
  ],
  "title": "LineRestoreResponse",
  "description": "Envelope containing the restored persistent line and its review metadata."
}
```

</details>

### LineUpdateRequest { #schema-lineupdaterequest }

Corrected transcription and optional page/order identifiers for a review-line write.

| Field | Required | Schema | Details |
|---|---|---|---|
| `corrected_text` | True | `string` |  |
| `page_id` | False | `integer` or `null` |  |
| `line_order` | False | `integer` or `null` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "corrected_text": {
      "type": "string",
      "title": "Corrected Text"
    },
    "page_id": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Page Id"
    },
    "line_order": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Line Order"
    }
  },
  "type": "object",
  "required": [
    "corrected_text"
  ],
  "title": "LineUpdateRequest",
  "description": "Corrected transcription and optional page/order identifiers for a review-line write."
}
```

</details>

### LineUpdateResponse { #schema-lineupdateresponse }

Envelope containing the committed line returned after a review edit.

| Field | Required | Schema | Details |
|---|---|---|---|
| `line` | True | [ProjectLineRead](#schema-projectlineread) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "line": {
      "$ref": "#/components/schemas/ProjectLineRead"
    }
  },
  "type": "object",
  "required": [
    "line"
  ],
  "title": "LineUpdateResponse",
  "description": "Envelope containing the committed line returned after a review edit."
}
```

</details>

### OCRConfigOverride { #schema-ocrconfigoverride }

Optional per-run values overriding the backend's project defaults.

| Field | Required | Schema | Details |
|---|---|---|---|
| `dpi` | False | `integer` or `null` |  |
| `binarization_threshold` | False | `integer` or `null` |  |
| `device` | False | `string` or `null` |  |
| `ocr_model_path` | False | `string` or `null` |  |
| `strict_top_to_bottom` | False | `boolean` or `null` |  |
| `disambiguate_ij` | False | `boolean` or `null` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "dpi": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1.0
        },
        {
          "type": "null"
        }
      ],
      "title": "Dpi"
    },
    "binarization_threshold": {
      "anyOf": [
        {
          "type": "integer",
          "maximum": 256.0,
          "minimum": 1.0
        },
        {
          "type": "null"
        }
      ],
      "title": "Binarization Threshold"
    },
    "device": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Device"
    },
    "ocr_model_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Ocr Model Path"
    },
    "strict_top_to_bottom": {
      "anyOf": [
        {
          "type": "boolean"
        },
        {
          "type": "null"
        }
      ],
      "title": "Strict Top To Bottom"
    },
    "disambiguate_ij": {
      "anyOf": [
        {
          "type": "boolean"
        },
        {
          "type": "null"
        }
      ],
      "title": "Disambiguate Ij"
    }
  },
  "type": "object",
  "title": "OCRConfigOverride",
  "description": "Optional per-run values overriding the backend's project defaults."
}
```

</details>

### OcrJobResponse { #schema-ocrjobresponse }

Polling snapshot with lifecycle status, phase, progress, and page counts.

| Field | Required | Schema | Details |
|---|---|---|---|
| `job_id` | True | `string` |  |
| `project_id` | True | `integer` |  |
| `upload_id` | True | `string` |  |
| `status` | True | `string` |  |
| `phase` | True | `string` |  |
| `progress` | True | `integer` |  |
| `message` | True | `string` |  |
| `created_at` | True | `string` (date-time) |  |
| `started_at` | False | `string` (date-time) or `null` |  |
| `finished_at` | False | `string` (date-time) or `null` |  |
| `error` | False | `string` or `null` |  |
| `transcript_path` | False | `string` or `null` |  |
| `project_json_path` | False | `string` or `null` |  |
| `total_pages` | False | `integer` or `null` |  |
| `rasterized_pages` | False | `integer` or `null` |  |
| `segmented_pages` | False | `integer` or `null` |  |
| `ocr_pages` | False | `integer` or `null` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "job_id": {
      "type": "string",
      "title": "Job Id"
    },
    "project_id": {
      "type": "integer",
      "title": "Project Id"
    },
    "upload_id": {
      "type": "string",
      "title": "Upload Id"
    },
    "status": {
      "type": "string",
      "title": "Status"
    },
    "phase": {
      "type": "string",
      "title": "Phase"
    },
    "progress": {
      "type": "integer",
      "title": "Progress"
    },
    "message": {
      "type": "string",
      "title": "Message"
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "title": "Created At"
    },
    "started_at": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ],
      "title": "Started At"
    },
    "finished_at": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ],
      "title": "Finished At"
    },
    "error": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Error"
    },
    "transcript_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Transcript Path"
    },
    "project_json_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Project Json Path"
    },
    "total_pages": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Total Pages"
    },
    "rasterized_pages": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Rasterized Pages"
    },
    "segmented_pages": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Segmented Pages"
    },
    "ocr_pages": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Ocr Pages"
    }
  },
  "type": "object",
  "required": [
    "job_id",
    "project_id",
    "upload_id",
    "status",
    "phase",
    "progress",
    "message",
    "created_at"
  ],
  "title": "OcrJobResponse",
  "description": "Polling snapshot with lifecycle status, phase, progress, and page counts."
}
```

</details>

### OcrJobStartRequest { #schema-ocrjobstartrequest }

Stored upload token and optional configuration overrides for a new OCR run.

| Field | Required | Schema | Details |
|---|---|---|---|
| `upload_id` | True | `string` |  |
| `config` | False | [OCRConfigOverride](#schema-ocrconfigoverride) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "upload_id": {
      "type": "string",
      "title": "Upload Id"
    },
    "config": {
      "$ref": "#/components/schemas/OCRConfigOverride"
    }
  },
  "type": "object",
  "required": [
    "upload_id"
  ],
  "title": "OcrJobStartRequest",
  "description": "Stored upload token and optional configuration overrides for a new OCR run."
}
```

</details>

### OcrJobsListResponse { #schema-ocrjobslistresponse }

Collection envelope for the retained OCR jobs belonging to a project.

| Field | Required | Schema | Details |
|---|---|---|---|
| `jobs` | True | array of [OcrJobResponse](#schema-ocrjobresponse) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "jobs": {
      "items": {
        "$ref": "#/components/schemas/OcrJobResponse"
      },
      "type": "array",
      "title": "Jobs"
    }
  },
  "type": "object",
  "required": [
    "jobs"
  ],
  "title": "OcrJobsListResponse",
  "description": "Collection envelope for the retained OCR jobs belonging to a project."
}
```

</details>

### PdfDpiAnalysisResponse { #schema-pdfdpianalysisresponse }

Estimated scan resolution, recommended ingestion DPI, confidence, and analysis warnings.

| Field | Required | Schema | Details |
|---|---|---|---|
| `filename` | True | `string` | minLength: `1` |
| `page_count` | True | `integer` | minimum: `1.0` |
| `pages_analyzed` | True | `integer` | minimum: `0.0` |
| `pages_with_scan_estimate` | True | `integer` | minimum: `0.0` |
| `detected_median_dpi` | False | `integer` or `null` |  |
| `detected_min_dpi` | False | `integer` or `null` |  |
| `detected_max_dpi` | False | `integer` or `null` |  |
| `recommended_dpi` | True | `integer` | minimum: `1.0` |
| `confidence` | True | `string` | enum: `["high", "medium", "low", "unavailable"]` |
| `ignored_probable_watermark_images` | True | `integer` | minimum: `0.0` |
| `warnings` | False | array of `string` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "filename": {
      "type": "string",
      "minLength": 1,
      "title": "Filename"
    },
    "page_count": {
      "type": "integer",
      "minimum": 1.0,
      "title": "Page Count"
    },
    "pages_analyzed": {
      "type": "integer",
      "minimum": 0.0,
      "title": "Pages Analyzed"
    },
    "pages_with_scan_estimate": {
      "type": "integer",
      "minimum": 0.0,
      "title": "Pages With Scan Estimate"
    },
    "detected_median_dpi": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1.0
        },
        {
          "type": "null"
        }
      ],
      "title": "Detected Median Dpi"
    },
    "detected_min_dpi": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1.0
        },
        {
          "type": "null"
        }
      ],
      "title": "Detected Min Dpi"
    },
    "detected_max_dpi": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1.0
        },
        {
          "type": "null"
        }
      ],
      "title": "Detected Max Dpi"
    },
    "recommended_dpi": {
      "type": "integer",
      "minimum": 1.0,
      "title": "Recommended Dpi"
    },
    "confidence": {
      "type": "string",
      "enum": [
        "high",
        "medium",
        "low",
        "unavailable"
      ],
      "title": "Confidence"
    },
    "ignored_probable_watermark_images": {
      "type": "integer",
      "minimum": 0.0,
      "title": "Ignored Probable Watermark Images"
    },
    "warnings": {
      "items": {
        "type": "string"
      },
      "type": "array",
      "title": "Warnings"
    }
  },
  "additionalProperties": false,
  "type": "object",
  "required": [
    "filename",
    "page_count",
    "pages_analyzed",
    "pages_with_scan_estimate",
    "recommended_dpi",
    "confidence",
    "ignored_probable_watermark_images"
  ],
  "title": "PdfDpiAnalysisResponse",
  "description": "Estimated scan resolution, recommended ingestion DPI, confidence, and analysis warnings."
}
```

</details>

### ProjectCreate { #schema-projectcreate }

JSON body containing the display name for a new persistent project.

| Field | Required | Schema | Details |
|---|---|---|---|
| `name` | True | `string` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "name": {
      "type": "string",
      "title": "Name"
    }
  },
  "type": "object",
  "required": [
    "name"
  ],
  "title": "ProjectCreate",
  "description": "JSON body containing the display name for a new persistent project."
}
```

</details>

### ProjectLineRead { #schema-projectlineread }

Persisted review line with text, geometry, and recognition metadata.

| Field | Required | Schema | Details |
|---|---|---|---|
| `id` | True | `integer` |  |
| `page_id` | False | `integer` or `null` |  |
| `line_order` | False | `integer` or `null` |  |
| `img_path` | False | `string` or `null` |  |
| `bounding_box` | False | `object` or `null` |  |
| `polygon_points` | False | array of array of `number` or `null` |  |
| `ocr_text` | False | `string` or `null` |  |
| `corrected_text` | False | `string` or `null` |  |
| `line_confidence` | False | `number` or `null` |  |
| `char_confidence` | False | `string` or `null` |  |
| `char_positions` | False | array of `object` or `null` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "id": {
      "type": "integer",
      "title": "Id"
    },
    "page_id": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Page Id"
    },
    "line_order": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Line Order"
    },
    "img_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Img Path"
    },
    "bounding_box": {
      "anyOf": [
        {
          "additionalProperties": {
            "type": "integer"
          },
          "type": "object"
        },
        {
          "type": "null"
        }
      ],
      "title": "Bounding Box"
    },
    "polygon_points": {
      "anyOf": [
        {
          "items": {
            "items": {
              "type": "number"
            },
            "type": "array"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "title": "Polygon Points"
    },
    "ocr_text": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Ocr Text"
    },
    "corrected_text": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Corrected Text"
    },
    "line_confidence": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ],
      "title": "Line Confidence"
    },
    "char_confidence": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Char Confidence"
    },
    "char_positions": {
      "anyOf": [
        {
          "items": {
            "additionalProperties": true,
            "type": "object"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "title": "Char Positions"
    }
  },
  "type": "object",
  "required": [
    "id"
  ],
  "title": "ProjectLineRead",
  "description": "Persisted review line with text, geometry, and recognition metadata."
}
```

</details>

### ProjectPageRead { #schema-projectpageread }

Persisted page dimensions, image location, and review lines returned to the frontend.

| Field | Required | Schema | Details |
|---|---|---|---|
| `id` | True | `integer` |  |
| `page_number` | True | `integer` |  |
| `img_path` | False | `string` or `null` |  |
| `width` | False | `integer` or `null` |  |
| `height` | False | `integer` or `null` |  |
| `rotation` | False | `integer` or `null` |  |
| `lines` | True | array of [ProjectLineRead](#schema-projectlineread) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "id": {
      "type": "integer",
      "title": "Id"
    },
    "page_number": {
      "type": "integer",
      "title": "Page Number"
    },
    "img_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Img Path"
    },
    "width": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Width"
    },
    "height": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Height"
    },
    "rotation": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "title": "Rotation"
    },
    "lines": {
      "items": {
        "$ref": "#/components/schemas/ProjectLineRead"
      },
      "type": "array",
      "title": "Lines"
    }
  },
  "type": "object",
  "required": [
    "id",
    "page_number",
    "lines"
  ],
  "title": "ProjectPageRead",
  "description": "Persisted page dimensions, image location, and review lines returned to the frontend."
}
```

</details>

### ProjectPagesResponse { #schema-projectpagesresponse }

Project-scoped page collection consumed by the review workspace.

| Field | Required | Schema | Details |
|---|---|---|---|
| `project_id` | True | `integer` |  |
| `pages` | True | array of [ProjectPageRead](#schema-projectpageread) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "project_id": {
      "type": "integer",
      "title": "Project Id"
    },
    "pages": {
      "items": {
        "$ref": "#/components/schemas/ProjectPageRead"
      },
      "type": "array",
      "title": "Pages"
    }
  },
  "type": "object",
  "required": [
    "project_id",
    "pages"
  ],
  "title": "ProjectPagesResponse",
  "description": "Project-scoped page collection consumed by the review workspace."
}
```

</details>

### ProjectRead { #schema-projectread }

Persistent project metadata, source-file information, and most recent OCR-run summary.

| Field | Required | Schema | Details |
|---|---|---|---|
| `name` | True | `string` |  |
| `id` | True | `integer` |  |
| `date_created` | False | `string` (date-time) or `null` |  |
| `date_modified` | False | `string` (date-time) or `null` |  |
| `source_pdf_path` | False | `string` or `null` |  |
| `source_pdf_name` | False | `string` or `null` |  |
| `ocr_run_count` | False | `integer` | default: `0` |
| `ocr_last_status` | False | `string` or `null` |  |
| `ocr_last_elapsed_seconds` | False | `number` or `null` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "name": {
      "type": "string",
      "title": "Name"
    },
    "id": {
      "type": "integer",
      "title": "Id"
    },
    "date_created": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ],
      "title": "Date Created"
    },
    "date_modified": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ],
      "title": "Date Modified"
    },
    "source_pdf_path": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Source Pdf Path"
    },
    "source_pdf_name": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Source Pdf Name"
    },
    "ocr_run_count": {
      "type": "integer",
      "title": "Ocr Run Count",
      "default": 0
    },
    "ocr_last_status": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "title": "Ocr Last Status"
    },
    "ocr_last_elapsed_seconds": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ],
      "title": "Ocr Last Elapsed Seconds"
    }
  },
  "type": "object",
  "required": [
    "name",
    "id"
  ],
  "title": "ProjectRead",
  "description": "Persistent project metadata, source-file information, and most recent OCR-run summary."
}
```

</details>

### ProjectUpdate { #schema-projectupdate }

Replacement project name accepted by the project update endpoint.

| Field | Required | Schema | Details |
|---|---|---|---|
| `name` | True | `string` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "name": {
      "type": "string",
      "title": "Name"
    }
  },
  "type": "object",
  "required": [
    "name"
  ],
  "title": "ProjectUpdate",
  "description": "Replacement project name accepted by the project update endpoint."
}
```

</details>

### ProjectsListResponse { #schema-projectslistresponse }

Collection envelope for project metadata returned by the dashboard endpoint.

| Field | Required | Schema | Details |
|---|---|---|---|
| `projects` | True | array of [ProjectRead](#schema-projectread) |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "projects": {
      "items": {
        "$ref": "#/components/schemas/ProjectRead"
      },
      "type": "array",
      "title": "Projects"
    }
  },
  "type": "object",
  "required": [
    "projects"
  ],
  "title": "ProjectsListResponse",
  "description": "Collection envelope for project metadata returned by the dashboard endpoint."
}
```

</details>

### RestartCancelRequest { #schema-restartcancelrequest }

Opaque token identifying the restart reservation that should be cancelled.

| Field | Required | Schema | Details |
|---|---|---|---|
| `restart_token` | True | `string` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "restart_token": {
      "type": "string",
      "title": "Restart Token"
    }
  },
  "type": "object",
  "required": [
    "restart_token"
  ],
  "title": "RestartCancelRequest",
  "description": "Opaque token identifying the restart reservation that should be cancelled."
}
```

</details>

### RestartPrepareRequest { #schema-restartpreparerequest }

Performance profile to apply when the desktop host restarts the backend.

| Field | Required | Schema | Details |
|---|---|---|---|
| `profile` | True | `string` | enum: `["cool", "balanced", "fast"]` |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "profile": {
      "type": "string",
      "enum": [
        "cool",
        "balanced",
        "fast"
      ],
      "title": "Profile"
    }
  },
  "type": "object",
  "required": [
    "profile"
  ],
  "title": "RestartPrepareRequest",
  "description": "Performance profile to apply when the desktop host restarts the backend."
}
```

</details>

### UploadedPdfResponse { #schema-uploadedpdfresponse }

Upload token and stored-file metadata returned before OCR job submission.

| Field | Required | Schema | Details |
|---|---|---|---|
| `upload_id` | True | `string` |  |
| `project_id` | True | `integer` |  |
| `filename` | True | `string` |  |
| `message` | True | `string` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "upload_id": {
      "type": "string",
      "title": "Upload Id"
    },
    "project_id": {
      "type": "integer",
      "title": "Project Id"
    },
    "filename": {
      "type": "string",
      "title": "Filename"
    },
    "message": {
      "type": "string",
      "title": "Message"
    }
  },
  "type": "object",
  "required": [
    "upload_id",
    "project_id",
    "filename",
    "message"
  ],
  "title": "UploadedPdfResponse",
  "description": "Upload token and stored-file metadata returned before OCR job submission."
}
```

</details>

### ValidationError { #schema-validationerror }

| Field | Required | Schema | Details |
|---|---|---|---|
| `loc` | True | array of `string` or `integer` |  |
| `msg` | True | `string` |  |
| `type` | True | `string` |  |
| `input` | False | `unspecified` |  |
| `ctx` | False | `object` |  |

<details markdown="1">
<summary>JSON schema definition</summary>

```json
{
  "properties": {
    "loc": {
      "items": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "integer"
          }
        ]
      },
      "type": "array",
      "title": "Location"
    },
    "msg": {
      "type": "string",
      "title": "Message"
    },
    "type": {
      "type": "string",
      "title": "Error Type"
    },
    "input": {
      "title": "Input"
    },
    "ctx": {
      "type": "object",
      "title": "Context"
    }
  },
  "type": "object",
  "required": [
    "loc",
    "msg",
    "type"
  ],
  "title": "ValidationError"
}
```

</details>

Raw schema: [backend-openapi.json](backend-openapi.json)
