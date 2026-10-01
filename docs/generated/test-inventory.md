# Test Inventory

Generated: 2026-10-01T14:37:37+00:00

## Summary

| Layer | Files | Approx test count |
|---|---:|---:|
| Backend pytest | 12 | 46 |
| Frontend vitest | 9 | 33 |
| Rust unit tests | 9 | 10 |

## Backend by area

| Area | Approx test count |
|---|---:|
| line routes and CRUD | 8 |
| ocr and orchestration | 5 |
| other | 29 |
| runtime and restart | 4 |

## Backend files

| File | Approx test count |
|---|---:|
| backend/tests/test_health_routes.py | 2 |
| backend/tests/test_line_routes.py | 6 |
| backend/tests/test_ocr_fake_worker_integration.py | 1 |
| backend/tests/test_ocr_routes.py | 4 |
| backend/tests/test_page_model.py | 4 |
| backend/tests/test_performance.py | 5 |
| backend/tests/test_pipeline_runner.py | 2 |
| backend/tests/test_reflow.py | 6 |
| backend/tests/test_route_imports.py | 1 |
| backend/tests/test_runtime_gate.py | 4 |
| backend/tests/test_stage_helpers.py | 4 |
| backend/tests/test_system_routes.py | 7 |

## Frontend files

| File | Approx test count |
|---|---:|
| src/components/__tests__/App.spec.js | 2 |
| src/components/__tests__/PredictedLineRow.spec.js | 3 |
| src/components/__tests__/ReviewTopBar.spec.js | 3 |
| src/composables/review/__tests__/useLineEditing.spec.js | 9 |
| src/composables/review/__tests__/useReviewHistory.spec.js | 3 |
| src/composables/review/__tests__/useSuspiciousAnalysis.spec.js | 4 |
| src/composables/views/projects/__tests__/useProjectsOcrPolling.spec.js | 3 |
| src/composables/views/projects/__tests__/useProjectsUploadActions.spec.js | 3 |
| src/services/__tests__/appSettings.spec.js | 3 |
