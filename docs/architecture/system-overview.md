# System Overview

```mermaid
flowchart LR
  UI[Vue UI] --> TAURI[Tauri Host]
  TAURI --> API[FastAPI Sidecar]
  API --> PIPE[Pipeline Runner]
  PIPE --> SEG[Segmentation Stage]
  PIPE --> OCR[OCR Stage]
  PIPE --> EXP[Export Stage]

  API --> DB[(SQLite)]
  API --> OUT[(Runtime Artifacts)]
```

## Notes

- The sidecar backend is the runtime coordinator.
- Pipeline state is tracked through OCR jobs and runtime gate constraints.
- Persistence is database-backed for project/page/line state.
