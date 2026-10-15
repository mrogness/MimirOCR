# Test Inventory

Generated from current test files.

## Summary

| Layer | Files | Approx test count |
|---|---:|---:|
| Backend pytest | 22 | 124 |
| Frontend vitest | 25 | 119 |
| Rust unit tests | 9 | 10 |

## Backend by area

| Area | Approx test count |
|---|---:|
| exports | 13 |
| line routes and CRUD | 6 |
| ocr and orchestration | 5 |
| other | 74 |
| runtime and restart | 4 |
| workers and pipeline | 22 |

## Backend files

| File | Approx test count |
|---|---:|
| backend/tests/test_export_routes.py | 7 |
| backend/tests/test_file_routes.py | 15 |
| backend/tests/test_health_routes.py | 2 |
| backend/tests/test_ij_disambiguation.py | 3 |
| backend/tests/test_line_routes.py | 6 |
| backend/tests/test_ocr_fake_worker_integration.py | 1 |
| backend/tests/test_ocr_routes.py | 5 |
| backend/tests/test_page_model.py | 4 |
| backend/tests/test_pdf_dpi.py | 6 |
| backend/tests/test_pdf_preparation.py | 2 |
| backend/tests/test_performance.py | 5 |
| backend/tests/test_pipeline_runner.py | 3 |
| backend/tests/test_prediction_metadata.py | 5 |
| backend/tests/test_project_artifact_cleanup.py | 1 |
| backend/tests/test_project_routes.py | 19 |
| backend/tests/test_reflow.py | 6 |
| backend/tests/test_route_imports.py | 5 |
| backend/tests/test_runtime_gate.py | 4 |
| backend/tests/test_system_routes.py | 7 |
| backend/tests/test_worker_helpers.py | 4 |
| backend/tests/test_worker_processes.py | 10 |
| backend/tests/test_worker_resources.py | 4 |

## Frontend files

| File | Approx test count |
|---|---:|
| src/__tests__/App.spec.js | 2 |
| src/features/projects/__tests__/ProjectsView.spec.js | 2 |
| src/features/projects/composables/__tests__/useDashboard.spec.js | 3 |
| src/features/projects/composables/__tests__/useJobPersistence.spec.js | 2 |
| src/features/projects/composables/__tests__/useOcrPolling.spec.js | 7 |
| src/features/projects/composables/__tests__/usePdfBinarizationPreview.spec.js | 5 |
| src/features/projects/composables/__tests__/useProjectActions.spec.js | 6 |
| src/features/projects/composables/__tests__/useUploadActions.spec.js | 3 |
| src/features/review/__tests__/ProjectReviewView.spec.js | 7 |
| src/features/review/__tests__/geometry.spec.js | 7 |
| src/features/review/components/__tests__/ExportSettingsSheet.spec.js | 4 |
| src/features/review/components/__tests__/PageImageOverlay.spec.js | 2 |
| src/features/review/components/__tests__/PredictedLineRow.spec.js | 3 |
| src/features/review/components/__tests__/ReviewTopBar.spec.js | 3 |
| src/features/review/composables/__tests__/useExportPdf.spec.js | 4 |
| src/features/review/composables/__tests__/useLineEditing.spec.js | 18 |
| src/features/review/composables/__tests__/useProjectReviewData.spec.js | 5 |
| src/features/review/composables/__tests__/useReviewGeometry.spec.js | 3 |
| src/features/review/composables/__tests__/useReviewHistory.spec.js | 3 |
| src/features/review/composables/__tests__/useSuspiciousAnalysis.spec.js | 4 |
| src/features/settings/composables/__tests__/usePerformanceProfileSettings.spec.js | 3 |
| src/shared/composables/__tests__/useBackendRuntime.spec.js | 5 |
| src/shared/composables/__tests__/useImageViewport.spec.js | 3 |
| src/shared/services/__tests__/appSettings.spec.js | 3 |
| src/shared/services/__tests__/backend.spec.js | 12 |
