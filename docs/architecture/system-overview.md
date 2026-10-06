# System Overview

The Vue frontend talks to the local FastAPI backend launched by Tauri. The API
owns the database, job state, rasterization and export. It launches isolated
Kraken segmentation and Calamari recognition workers and exchanges JSON metadata
and image paths with them. All three runtimes are bundled in one application.

See [isolated OCR runtimes](ocr-process-split.md) for development, packaging,
process lifetime and failure handling, and the worker contracts for IPC details.
