# Testing Architecture (Generated)

Generated: 2026-10-01

This document summarizes how tests are organized across backend, frontend, and
Tauri components, and how OCR runtime orchestration is validated without model
weights.

## Suite Topology

```mermaid
flowchart TD
  A[Repository] --> B[Backend pytest]
  A --> C[Frontend vitest]
  A --> D[Rust cargo test]

  B --> B1[Route and CRUD behavior]
  B --> B2[Runtime gate and restart safety]
  B --> B3[Pipeline orchestration]
  B --> B4[Stage helper normalization]
  B --> B5[Fake-worker OCR integration]

  C --> C1[Review composables]
  C --> C2[Projects upload and polling]
  C --> C3[Component interaction tests]

  D --> D1[Profile parsing and persistence]
  D --> D2[Restart reservation handling]
```

## OCR Job Lifecycle (Backend)

```mermaid
stateDiagram-v2
  [*] --> queued: POST /ocr/projects/{id}/jobs
  queued --> running: worker thread starts
  running --> running: progress updates
  running --> succeeded: pipeline + persistence complete
  running --> failed: exception path
  succeeded --> [*]
  failed --> [*]
```

## Frontend Upload and Polling Flow

```mermaid
sequenceDiagram
  participant UI as Projects UI
  participant API as FastAPI backend
  participant JOB as Job store/runtime gate

  UI->>API: POST /files/projects/{id}/upload-pdf
  API-->>UI: upload_id
  UI->>API: POST /ocr/projects/{id}/jobs
  API->>JOB: reserve runtime + create job
  API-->>UI: job_id
  loop every 1200ms
    UI->>API: GET /ocr/jobs/{job_id}
    API-->>UI: status, phase, counters, message
  end
  UI->>UI: stop polling on succeeded/failed
```

## Coverage Priorities for Process Split

1. Keep OCR route lifecycle tests as strict contract tests for process
   reservation, job state transitions, and transcript retrieval.
2. Keep runner failure-ordering tests to guarantee deterministic page ordering
   despite multi-process segmentation.
3. Keep helper normalization tests to protect serialization/compatibility
   assumptions at process boundaries.
4. Keep fake-worker integration tests to validate persistence behavior without
   loading heavy ML runtimes.
5. Keep frontend polling/upload tests to lock client behavior for queued,
   running, failed, and recovered jobs.
