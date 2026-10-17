# Frontend Code Organization

Frontend source is grouped by the screen or workflow that owns it. Start in
`src/features/` when changing a user workflow; start in `src/shared/` when changing
behavior used by several features. The app shell, router, global styles, and
shared test setup stay at the top level of `src/`.

## Ownership

| Location | Owns |
|---|---|
| `src/features/projects/` | Dashboard, project workspace, upload, PDF preview, OCR progress, and job polling |
| `src/features/review/` | Review screen, correction history, editing, suspicious-character analysis, overlays, and exports |
| `src/features/settings/` | Settings screen, performance profiles, brand preferences, and connectivity diagnostics |
| `src/features/help/` | Information screen, guides, character references, and acknowledgements |
| `src/shared/components/` | Help popovers and resizable split panes |
| `src/shared/composables/` | Image viewport controls, app version lookup, and backend runtime status/restart access |
| `src/shared/services/` | Backend transport and persisted application settings |
| `src/App.vue`, `src/main.js`, `src/router/` | App shell, startup bootstrap, and route registration |
| `src/styles/` | Global and theme styling |
| `src/test/` | Vitest setup and shared test utilities |

Each feature keeps its views at its root and its components and composables in
their respective subdirectories. Place component/composable tests in nearby
`__tests__/` directories. App shell tests live in `src/__tests__/`; shared
component, composable, and service tests live under matching `src/shared/**/__tests__/`
paths.

Features can use shared code. Shared code should not depend on a feature, and a
feature should not reach into another feature's internals. Move a helper into
`shared/` only when more than one feature needs it. For example,
`useImageViewport` serves both project PDF preview and page review;
`usePdfBinarizationPreview` belongs to projects alone. Imports remain explicit
relative paths; there are no new aliases or barrel modules to resolve.

## Where to make changes

| Task | Starting point |
|---|---|
| Dashboard project list/create/delete | `features/projects/DashboardView.vue`, `composables/useDashboard.js` |
| Upload or OCR progress/polling | `features/projects/ProjectsView.vue`, `composables/useUploadActions.js`, `useOcrPolling.js`, `useProjectRuntime.js` |
| Correction, save, undo, or delete | `features/review/composables/useLineEditing.js`, `useReviewHistory.js` |
| Character marker placement or polygon validation | `features/review/geometry.js` |
| Reactive overlay scale and marker visibility | `features/review/composables/useReviewGeometry.js` |
| SVG display, clipping, or overlay interactions | `features/review/components/PageImageOverlay.vue` |
| Zoom or viewport fitting | `shared/composables/useImageViewport.js` |
| HTTP retries or backend startup detection | `shared/services/backend.js` |
| Settings validation and storage keys | `shared/services/appSettings.js` |

Paths in this table are relative to `src/`; a feature's `composables/` paths are
relative to that feature.

## Review geometry

`geometry.js` contains pure calculations. It accepts page-coordinate data and
returns page-coordinate character boxes or formatted polygon points. The reactive
`useReviewGeometry` composable tracks selected page data, rendered image size,
overlay mode, and suspicious hint visibility. `ProjectReviewView.vue` connects
these values to `PageImageOverlay.vue`, which scales character boxes for display.

The extraction preserves observed-span normalization, alternate coordinate
fields, reversed spans, neighbor-constrained widening, even-spacing fallback,
and polygon fallback when a valid box is unavailable. Hidden suspicious hints
still avoid marker calculation. No routes, backend payloads, settings keys,
polling intervals, or dependency versions change.

The only removed functions are the review view's unused `normalizeConfidence`
and `boxStyle` helpers; suspicious-character analysis retains its existing
confidence normalization.

## Migration from the earlier layout

| Previous location/name | Current location/name |
|---|---|
| `src/views/defaultView.vue`, `useDefaultView` | `features/projects/DashboardView.vue`, `useDashboard` |
| `src/views/projectsView.vue` | `features/projects/ProjectsView.vue` |
| `src/views/projectReviewView.vue` | `features/review/ProjectReviewView.vue` |
| `src/views/settingsView.vue`, `src/views/infoView.vue` | `features/settings/SettingsView.vue`, `features/help/InfoView.vue` |
| `src/components/{projects,review,settings,help}/` | Corresponding `features/<feature>/components/`; `AppHelp` is shared |
| `src/composables/views/projects/useProjects*.js` | `features/projects/composables/use*.js`; redundant `Projects` prefix removed |
| `src/composables/{review,settings,preview}/` | Owning feature's `composables/`, except the shared helpers above |
| `useReviewViewport` | `shared/composables/useImageViewport.js` |
| `src/composables/runtime/useBackendRuntime.js`, `settings/useAppVersion.js` | `shared/composables/` |
| `src/services/` | `shared/services/` |

## Verification

See the [testing guide](../testing.md) and
[generated test inventory](../generated/test-inventory.md) for the relocated
tests. Run from the repository root:

```sh
yarn test:unit:coverage
yarn build
python scripts/generate_docs.py
mkdocs build --strict
```

Geometry tests cover calculation edge cases, reactive page/size/toggle changes,
and scaled SVG output and selection events through the real overlay component.
These checks do not launch a Tauri window or prove packaged-app rendering.
