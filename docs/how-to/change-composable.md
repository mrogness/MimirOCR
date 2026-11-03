# Change a Vue composable

Use a composable for reactive workflow behavior owned by a feature. Shared HTTP
connection logic belongs in `src/shared/services/backend.js`; review editing belongs
in `src/features/review/composables/`. See [frontend organization](../architecture/frontend-organization.md).

## Write the contract beside the implementation

Document the module purpose with `@file`, then describe each named function.
For exported composables, name each dependency field, whether it is a Vue ref or
callback, what it may contain, and who owns mutation. Describe returned refs and
actions, errors, asynchronous ordering, and teardown. Use `@example` for a small
usage example; it is rendered in the generated source reference.

`useLineEditing()` is a concrete example:

| Input | Contract |
| --- | --- |
| `selectedPage` | Ref/computed containing the current HTTP page or `null` |
| `pages` | Mutable ref containing loaded HTTP page records |
| `selectedLineId`, `activeLineId` | Mutable refs for selected/focused persistent line IDs |
| `backendFetch` | Async fetch-compatible function returning a `Response` |
| `refreshPagesPreservingSelection` | Async reload preserving the current review selection |
| `selectPageById` | Async selection callback used by undo across pages |

| Returned member | How the caller uses it |
| --- | --- |
| `lineSaveState` | Ref keyed by line ID; values contain save status and an optional message |
| `undoStack`, `canUndo`, `undoLabel` | Reactive history and availability/label for the undo control |
| `isUndoing`, `undoErrorMessage` | Reactive undo progress and failure feedback |
| `setLineSaveState` | Set per-line save feedback |
| `onLineInput` | Update corrected text immediately and queue a 350 ms debounced save |
| `moveLine`, `commitLineOrderInput` | Move a line or commit a typed order, persisting changed positions |
| `deleteLine` | Delete a line and retain a restoration snapshot |
| `undoLastAction` | Undo pending text first, then a saved text/order/delete action |
| `flushPendingSaves` | Await queued/in-flight text writes; reject if any correction remains unsaved |
| `clearPendingTimers` | Cancel queued saves and invalidate responses; already-sent writes continue |
| `clearUndoHistory` | Clear undo and pending text-edit history |

## Preserve lifecycle and failure behavior

Create one instance per workspace. Before export, await `flushPendingSaves()`;
also await any reorder/delete action you initiated. Do not treat timer cancellation
as successful persistence. When changing datasets or unmounting, follow the cleanup
calls in `ProjectReviewView.vue` and prevent old responses from mutating the new view.

Mock backend boundaries in tests, while exercising the actual composable and reactive
state. For editing changes, cover debounce completion, rejected saves, retry, stale
responses, cleanup, and undo. For polling changes, cover slow requests and terminal
states. Add a view test when the component wiring changes.

```sh
yarn test:unit src/features/review/composables/__tests__/useLineEditing.spec.js
yarn test:unit src/features/review/__tests__/ProjectReviewView.spec.js
yarn docs:build
```

Inspect the generated parameters, returned members, and example. Description checks
find missing text; they do not verify that the text accurately describes behavior.
