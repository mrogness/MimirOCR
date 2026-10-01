# OCR Worker Contract

## Request envelope

```json
{
  "version": "v1",
  "job_id": "string",
  "project_id": "string",
  "config": {
    "model_path": "string",
    "disambiguate_ij": true,
    "max_threads": 2
  },
  "pages": [
    {
      "id": "page-1",
      "lines": [
        { "id": "line-1", "image_path": "..." }
      ]
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
          "id": "line-1",
          "ocr_text": "...",
          "confidence": 0.97,
          "char_positions": [],
          "char_confidence": []
        }
      ]
    }
  ]
}
```

## Error contract

- Errors must include a stable code and human-readable message.
- Orchestrator maps worker errors to failed OCR job lifecycle state.
