# MimirOCR Contributor Documentation

This portal is the contributor-first reference for architecture, testing,
runtime behavior, and worker-process contracts.

## Goals

- Provide fast onboarding for backend, frontend, and Tauri contributors.
- Keep process-boundary behavior explicit as segmentation and OCR split into
  separate runtimes.
- Keep docs updated through CI generation + validation.

## Where to start

- New contributors: see [Contributing](contributing.md).
- Runtime model and process boundaries: see
  [Architecture](architecture/system-overview.md).
- Worker payload and behavior requirements: see [Contracts](contracts/ocr-worker-contract.md).
- Test strategy and quality gates: see [Testing Guide](testing.md).
