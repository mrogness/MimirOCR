# Segmentation Worker Contract

## Request envelope

```json
{
  "version": "v1",
  "job_id": "string",
  "project_id": "string",
  "config": {
    "strict_top_to_bottom": false,
    "mask": []
  },
  "pages": [
    {
      "id": "page-1",
      "image_path": "..."
    }
  ]
}
```

## Response envelope

```json
{
  "version": "v1",
  "job_id": "string",
  "status": "succeeded",
  "pages": [
    {
      "id": "page-1",
      "lines": [
        {
          "id": "page-1_line_1",
          "bbox": { "x_min": 1, "y_min": 2, "x_max": 30, "y_max": 12 },
          "image_path": "...",
          "baseline_info": { "source_order": 1 }
        }
      ]
    }
  ]
}
```

## Error contract

- Non-zero worker exits must return a structured failure payload.
- Orchestrator must preserve page ordering after parallel completion.
