# OCR Process Split

This section documents the intended split of segmentation and OCR engines into
isolated worker processes.

## Target topology

```mermaid
flowchart TD
  ORCH[Orchestrator: FastAPI/Pipeline Runner]
  ORCH --> IPC1[Segmentation IPC Contract]
  IPC1 --> SEGPROC[Segmentation Worker Process]
  ORCH --> IPC2[OCR IPC Contract]
  IPC2 --> OCRPROC[OCR Worker Process]
  SEGPROC --> ORCH
  OCRPROC --> ORCH
  ORCH --> DB[(SQLite)]
```

## Design constraints

- Worker payloads must be versioned and backward compatible during migration.
- Timeout and cancellation semantics must be explicit per job phase.
- Failed worker calls must map to deterministic job status transitions.
- Page ordering must remain stable across parallel worker completion.

## Regression risks

- Silent contract drift between orchestrator and workers.
- Partial writes after worker failure.
- Runtime-gate release leaks when worker startup fails.
