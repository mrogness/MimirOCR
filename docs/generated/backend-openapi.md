# Backend OpenAPI Summary

Generated: 2026-10-01T15:03:14+00:00

| Method | Path | Summary | Tags |
|---|---|---|---|
| GET | / | Root |  |
| GET | /export/projects/{project_id}/pdf | Export Project Pdf Get | export |
| POST | /export/projects/{project_id}/pdf | Export Project Pdf Post | export |
| GET | /export/projects/{project_id}/training-data | Export Project Training Data | export |
| POST | /files/analyze-pdf-dpi | Analyze Uploaded Pdf Dpi | files |
| POST | /files/projects/{project_id}/upload-pdf | Upload Pdf For Project | files |
| GET | /health | Health |  |
| POST | /lines/restore | Restore Line | lines |
| DELETE | /lines/{line_id} | Delete Line | lines |
| PATCH | /lines/{line_id} | Update Line | lines |
| GET | /ocr/jobs/{job_id} | Get Ocr Job | ocr |
| GET | /ocr/jobs/{job_id}/transcript | Get Ocr Job Transcript | ocr |
| GET | /ocr/projects/{project_id}/jobs | List Project Ocr Jobs | ocr |
| POST | /ocr/projects/{project_id}/jobs | Start Ocr Job | ocr |
| GET | /projects/ | List Projects | projects |
| POST | /projects/ | Create Project | projects |
| DELETE | /projects/{project_id} | Delete Project | projects |
| GET | /projects/{project_id} | Read Project | projects |
| PUT | /projects/{project_id} | Update Project | projects |
| GET | /projects/{project_id}/pages | List Project Pages | projects |
| GET | /projects/{project_id}/pages/{page_id}/image | Get Project Page Image | projects |
| GET | /projects/{project_id}/source-pdf | Get Project Source Pdf | projects |
| GET | /system/cpu | Get Cpu Info | system |
| POST | /system/restart/cancel | Cancel Backend Restart | system |
| POST | /system/restart/prepare | Prepare Backend Restart | system |
| GET | /system/runtime | Get Runtime Info | system |

Raw schema: docs/generated/backend-openapi.json
