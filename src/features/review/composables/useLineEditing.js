/**
 * @file Coordinate debounced text saves, line reordering, deletion, retries, and undo.
 * Request tokens prevent stale responses from overwriting newer edits; export can flush
 * pending saves.
 */
import { computed, ref } from 'vue'

import { useReviewHistory } from './useReviewHistory'

const TEXT_SAVE_DEBOUNCE_MS = 350

/**
 * Attach persistent editing and undo behavior to a review workspace's reactive state.
 *
 * Own one instance per review workspace. Text input updates the supplied line immediately
 * and saves after 350 ms. Await flushPendingSaves before exporting or replacing data that
 * must include edits. Call clearPendingTimers and clearUndoHistory on dataset teardown;
 * cancelling timers discards queued saves and does not abort requests already sent.
 *
 * @param {object} dependencies - Page/selection refs, API access, and selection callbacks.
 * @param {object} dependencies.selectedPage - Vue computed/ref containing the selected page or null.
 * @param {object} dependencies.pages - Mutable Vue ref of HTTP page records, with persistent line IDs and line_order.
 * @param {object} dependencies.selectedLineId - Mutable Vue ref of the selected line ID or null.
 * @param {object} dependencies.activeLineId - Mutable Vue ref of the focused line ID or null.
 * @param {Function} dependencies.backendFetch - Async (path, RequestInit) function returning a Response; HTTP failures must retain their status.
 * @param {Function} dependencies.refreshPagesPreservingSelection - Async reload callback used when local restoration needs fresh server IDs.
 * @param {Function} dependencies.selectPageById - Async page-selection callback used before undoing an action on another page.
 * @returns {object} Reactive lineSaveState, undoStack, canUndo, undoLabel, isUndoing, and undoErrorMessage;
 * setLineSaveState, onLineInput, moveLine, commitLineOrderInput, deleteLine, undoLastAction,
 * clearUndoHistory, clearPendingTimers, and flushPendingSaves actions. Returned refs remain refs.
 * @example
 * // Within a Vue setup function with the listed refs/callbacks already created:
 * const editing = useLineEditing({ selectedPage, pages, selectedLineId, activeLineId,
 *   backendFetch, refreshPagesPreservingSelection, selectPageById })
 * editing.onLineInput(selectedPage.value.lines[0], 'Corrected transcription')
 * await editing.flushPendingSaves() // Rejects if a correction remains unsaved.
 * onBeforeUnmount(() => { editing.clearPendingTimers(); editing.clearUndoHistory() })
 */
export function useLineEditing({
  selectedPage,
  pages,
  selectedLineId,
  activeLineId,
  backendFetch,
  refreshPagesPreservingSelection,
  selectPageById,
}) {
  const lineSaveState = ref({})
  const lineSaveTimers = new Map()
  const inFlightTextSaves = new Map()
  const lineRequestTokens = new Map()
  const pendingTextEdits = new Map()
  const pendingSequence = ref(0)
  const pendingUndoCount = ref(0)
  const historyWriteDepth = ref(0)

  const {
    undoStack,
    canUndo: canUndoStack,
    undoLabel: stackUndoLabel,
    isUndoing,
    undoErrorMessage,
    pushUndoAction,
    peekUndoAction,
    popUndoAction,
    clearUndoHistory,
    setUndoError,
    cloneSerializable,
  } = useReviewHistory()

  const canUndo = computed(() => pendingUndoCount.value > 0 || canUndoStack.value)
  const undoLabel = computed(() => {
    if (pendingUndoCount.value > 0) {
      return 'Undo text edit'
    }
    return stackUndoLabel.value
  })

  /**
   * Report whether an undo/restore operation is currently suppressing new history records.
   */
  function isHistorySuppressed() {
    return historyWriteDepth.value > 0
  }

  /**
   * Await an operation while incrementing history-suppression depth, restoring the depth even
   * if it rejects.
   */
  async function withHistorySuppressed(callback) {
    historyWriteDepth.value += 1
    try {
      return await callback()
    } finally {
      historyWriteDepth.value -= 1
    }
  }

  /**
   * Prefer nonempty corrected text over OCR text, returning an empty string when neither is
   * present.
   */
  function getDisplayedText(line) {
    return line.corrected_text || line.ocr_text || ''
  }

  /**
   * Remove a line's save indicator by replacing the state object so Vue observes the
   * deletion.
   */
  function removeLineSaveState(lineId) {
    if (!lineSaveState.value[lineId]) {
      return
    }

    const next = { ...lineSaveState.value }
    delete next[lineId]
    lineSaveState.value = next
  }

  /**
   * Replace a line's reactive save status and optional user-facing message.
   */
  function setLineSaveState(lineId, status, message = '') {
    lineSaveState.value = {
      ...lineSaveState.value,
      [lineId]: { status, message },
    }
  }

  /**
   * Advance and return a line's request generation so older responses can be ignored.
   */
  function bumpLineRequestToken(lineId) {
    const next = (lineRequestTokens.get(lineId) || 0) + 1
    lineRequestTokens.set(lineId, next)
    return next
  }

  /**
   * Read a line's current request generation, using zero before any edit or invalidation.
   */
  function getLineRequestToken(lineId) {
    return lineRequestTokens.get(lineId) || 0
  }

  /**
   * Find a page in the current review dataset, returning null if its persistent ID is absent.
   */
  function findPageById(pageId) {
    return pages.value.find((candidate) => candidate.id === pageId) || null
  }

  /**
   * Find a line under the specified page, returning null when the page or line is absent.
   */
  function findLineById(pageId, lineId) {
    const page = findPageById(pageId)
    if (!page || !Array.isArray(page.lines)) {
      return null
    }
    return page.lines.find((candidate) => candidate.id === lineId) || null
  }

  /**
   * Reidentify a line after refreshing the dataset, preferring its page/order mapping before
   * the old ID.
   */
  function findLineForRetry(target) {
    const page = findPageById(target.page_id)
    if (!page) {
      return null
    }

    if (target.line_order != null) {
      const byOrder = page.lines.find((candidate) => candidate.line_order === target.line_order)
      if (byOrder) {
        return byOrder
      }
    }

    return page.lines.find((candidate) => candidate.id === target.id) || null
  }

  /**
   * Return the current zero-based index of a page, or -1 when it is absent.
   */
  function findPageIndexById(pageId) {
    return pages.value.findIndex((candidate) => candidate.id === pageId)
  }

  /**
   * Select the page needed for undo when its finite ID differs from the current selection and
   * a selection callback is available.
   */
  async function ensurePageSelected(pageId) {
    if (!Number.isFinite(pageId)) {
      return
    }
    if (selectedPage.value?.id === pageId) {
      return
    }
    if (typeof selectPageById === 'function') {
      selectPageById(pageId)
    }
  }

  /**
   * Copy line IDs and saved orders in stable review order, supplying sequential orders when a
   * stored value is nonfinite.
   */
  function captureLineOrderSnapshot(page) {
    if (!page || !Array.isArray(page.lines)) {
      return []
    }

    const sorted = [...page.lines].sort(
      (a, b) => (a.line_order || Number.MAX_SAFE_INTEGER) - (b.line_order || Number.MAX_SAFE_INTEGER) || a.id - b.id
    )
    return sorted.map((line, index) => ({
      id: line.id,
      line_order: Number.isFinite(line.line_order) ? line.line_order : index + 1,
    }))
  }

  /**
   * Compare two ordered snapshots by length, line IDs, and order values.
   */
  function snapshotsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }

    for (let index = 0; index < a.length; index += 1) {
      if (a[index].id !== b[index].id || a[index].line_order !== b[index].line_order) {
        return false
      }
    }

    return true
  }

  /**
   * Reorder the page's current line objects from a snapshot and assign contiguous one-based
   * local orders.
   */
  function applyOrderSnapshotLocally(page, snapshot) {
    if (!page || !Array.isArray(page.lines) || !Array.isArray(snapshot)) {
      return
    }

    const orderById = new Map(snapshot.map((entry) => [entry.id, entry.line_order]))
    const decorated = page.lines.map((line, index) => ({
      line,
      order: orderById.get(line.id) || Number.MAX_SAFE_INTEGER,
      fallback: index,
    }))

    decorated.sort((a, b) => a.order - b.order || a.fallback - b.fallback || a.line.id - b.line.id)
    page.lines = decorated.map((entry, idx) => {
      entry.line.line_order = idx + 1
      return entry.line
    })
  }

  /**
   * Move one line to a clamped one-based target position and return a fresh contiguous order
   * snapshot.
   */
  function buildMovedOrderSnapshot(page, lineId, targetOrder) {
    if (!page || !Array.isArray(page.lines) || !Number.isFinite(targetOrder)) {
      return []
    }

    const sorted = [...page.lines].sort(
      (a, b) => (a.line_order || Number.MAX_SAFE_INTEGER) - (b.line_order || Number.MAX_SAFE_INTEGER) || a.id - b.id
    )
    const fromIndex = sorted.findIndex((candidate) => candidate.id === lineId)
    if (fromIndex < 0) {
      return []
    }

    const clampedTarget = Math.max(1, Math.min(Math.round(targetOrder), sorted.length))
    const [moving] = sorted.splice(fromIndex, 1)
    sorted.splice(clampedTarget - 1, 0, moving)

    return sorted.map((candidate, index) => ({
      id: candidate.id,
      line_order: index + 1,
    }))
  }

  /**
   * Return entries whose order differs from the before snapshot, preserving the
   * after-snapshot order.
   */
  function changedOrderEntries(beforeOrder, afterOrder) {
    const beforeMap = new Map(beforeOrder.map((entry) => [entry.id, entry.line_order]))
    const changed = []
    for (const entry of afterOrder) {
      if (beforeMap.get(entry.id) !== entry.line_order) {
        changed.push(entry)
      }
    }
    return changed
  }

  /**
   * Count edit sessions still waiting on debounce timers and publish whether pending text can
   * be undone locally.
   */
  function updatePendingUndoCount() {
    let count = 0
    for (const lineId of pendingTextEdits.keys()) {
      if (lineSaveTimers.has(lineId)) {
        count += 1
      }
    }
    pendingUndoCount.value = count
  }

  /**
   * Deep-copy the review fields required to restore a deleted line, retaining geometry and
   * recognition metadata.
   */
  function cloneLineSnapshot(line) {
    return cloneSerializable({
      id: line.id,
      page_id: line.page_id,
      line_order: line.line_order,
      img_path: line.img_path || null,
      bounding_box: line.bounding_box || null,
      polygon_points: line.polygon_points || null,
      ocr_text: line.ocr_text || null,
      corrected_text: line.corrected_text || null,
      line_confidence: line.line_confidence ?? null,
      char_confidence: line.char_confidence ?? null,
      char_positions: line.char_positions || null,
    })
  }

  /**
   * Normalize a returned API line into the nullable field shape used by review state.
   */
  function convertApiLinePayload(linePayload) {
    return {
      id: linePayload.id,
      page_id: linePayload.page_id,
      line_order: linePayload.line_order,
      img_path: linePayload.img_path || null,
      bounding_box: linePayload.bounding_box || null,
      polygon_points: linePayload.polygon_points || null,
      ocr_text: linePayload.ocr_text || null,
      corrected_text: linePayload.corrected_text || null,
      line_confidence: linePayload.line_confidence ?? null,
      char_confidence: linePayload.char_confidence ?? null,
      char_positions: linePayload.char_positions || null,
    }
  }

  /**
   * Persist text/order overrides and apply the returned values only for the current request
   * token. On an initial 404, refresh page mappings and retry once against the reidentified
   * line; other HTTP failures throw.
   */
  async function saveLineToApi(line, { allowRetry = true, requestToken = null, overrideText = null, overrideLineOrder = null } = {}) {
    const correctedText = overrideText != null ? overrideText : line.corrected_text || ''
    const lineOrder = overrideLineOrder != null ? overrideLineOrder : line.line_order
    const response = await backendFetch(`/lines/${line.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        corrected_text: correctedText,
        page_id: line.page_id,
        line_order: lineOrder,
      }),
    })

    if (response.ok) {
      const payload = await response.json()
      if (requestToken != null && getLineRequestToken(line.id) !== requestToken) {
        return { stale: true, payload }
      }

      const corrected = payload?.line?.corrected_text
      if (typeof corrected === 'string') {
        line.corrected_text = corrected
      }

      if (Number.isFinite(payload?.line?.line_order)) {
        line.line_order = payload.line.line_order
      }

      return { stale: false, payload }
    }

    if (response.status === 404 && allowRetry) {
      setLineSaveState(line.id, 'saving', 'Refreshing line mapping...')
      await refreshPagesPreservingSelection()
      const refreshedLine = findLineForRetry(line)
      if (!refreshedLine) {
        throw new Error(`Unable to save line ${line.id} (404)`)
      }

      refreshedLine.corrected_text = correctedText
      if (lineOrder != null) {
        refreshedLine.line_order = lineOrder
      }
      return saveLineToApi(refreshedLine, {
        allowRetry: false,
        requestToken,
        overrideText: correctedText,
        overrideLineOrder: lineOrder,
      })
    }

    throw new Error(`Unable to save line ${line.id} (${response.status})`)
  }

  /**
   * Save only changed line orders sequentially, updating per-line feedback. Attach
   * successfully written IDs to a thrown error so callers can attempt a partial rollback.
   */
  async function persistOrderSnapshot(page, beforeOrder, afterOrder) {
    const changed = changedOrderEntries(beforeOrder, afterOrder)
    if (!changed.length) {
      return
    }

    const successfulIds = []
    try {
      for (const entry of changed) {
        const line = page.lines.find((candidate) => candidate.id === entry.id)
        if (!line) {
          throw new Error(`Unable to find line ${entry.id} while saving order`) 
        }

        setLineSaveState(line.id, 'saving', 'Saving order...')
        await saveLineToApi(line, {
          overrideText: getDisplayedText(line),
          overrideLineOrder: entry.line_order,
        })
        setLineSaveState(line.id, 'saved')
        successfulIds.push(line.id)
      }
    } catch (error) {
      for (const entry of changed) {
        setLineSaveState(entry.id, 'error', String(error))
      }
      error.successfulIds = successfulIds
      throw error
    }
  }

  /**
   * Best-effort restore selected line orders after partial persistence; skip missing lines
   * and tolerate individual rollback failures.
   */
  async function restoreBackendOrderSnapshot(page, snapshot, lineIds = null) {
    const snapshotById = new Map(snapshot.map((entry) => [entry.id, entry.line_order]))
    const targetIds = Array.isArray(lineIds) && lineIds.length
      ? lineIds
      : snapshot.map((entry) => entry.id)

    for (const id of targetIds) {
      const line = page.lines.find((candidate) => candidate.id === id)
      if (!line) {
        continue
      }
      const targetOrder = snapshotById.get(id)
      if (!Number.isFinite(targetOrder)) {
        continue
      }

      try {
        await saveLineToApi(line, {
          overrideText: getDisplayedText(line),
          overrideLineOrder: targetOrder,
          allowRetry: false,
        })
      } catch (_error) {
        // Best-effort rollback for partial order persistence failures.
      }
    }
  }

  /**
   * Return the newest edit session whose debounce timer has not fired, or null when none can
   * be cancelled locally.
   */
  function getLatestPendingTextEdit() {
    let latest = null
    for (const session of pendingTextEdits.values()) {
      if (!lineSaveTimers.has(session.lineId)) {
        continue
      }
      if (!latest || session.sequence > latest.sequence) {
        latest = session
      }
    }
    return latest
  }

  /**
   * Cancel a queued line save, optionally restore its original text, and invalidate obsolete
   * responses. Clear requested pending state and return the edit session when one existed.
   */
  function cancelPendingTextSave(lineId, { restoreInitialText = false, clearPendingState = true } = {}) {
    const timer = lineSaveTimers.get(lineId)
    if (timer) {
      clearTimeout(timer)
      lineSaveTimers.delete(lineId)
    }

    const session = pendingTextEdits.get(lineId) || null
    if (session && restoreInitialText) {
      const line = findLineById(session.pageId, session.lineId)
      if (line) {
        line.corrected_text = session.beforeText
      }
    }

    if (session && clearPendingState) {
      pendingTextEdits.delete(lineId)
    }

    bumpLineRequestToken(lineId)
    removeLineSaveState(lineId)
    updatePendingUndoCount()

    return session
  }

  /**
   * POST a deleted-line snapshot and its original page order to the restore endpoint,
   * returning a normalized line or throwing on failure.
   */
  async function restoreDeletedLineAction(action) {
    const response = await backendFetch('/lines/restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        line: action.lineSnapshot,
        line_orders: action.beforeOrder,
      }),
    })

    if (!response.ok) {
      throw new Error(`Unable to restore deleted line ${action.lineSnapshot?.id} (${response.status})`)
    }

    const payload = await response.json()
    return convertApiLinePayload(payload.line)
  }

  /**
   * Replace a matching local line or append a restored line before order is reapplied.
   */
  function upsertRestoredLine(page, linePayload) {
    const existingIndex = page.lines.findIndex((candidate) => candidate.id === linePayload.id)
    if (existingIndex >= 0) {
      page.lines.splice(existingIndex, 1, linePayload)
      return
    }
    page.lines.push(linePayload)
  }

  /**
   * Clear committed undo history and pending edit-session bookkeeping without cancelling
   * timers by itself.
   */
  function clearUndoAndPendingTextEdits() {
    clearUndoHistory()
    pendingTextEdits.clear()
    pendingUndoCount.value = 0
  }

  /**
   * Serialize saves for one line and skip obsolete request generations. Record a successful
   * text edit in undo history, retain failures in save feedback, and track the promise for
   * export flushing.
   */
  function persistTextSave(line, requestToken) {
    const lineId = line.id
    const previous = inFlightTextSaves.get(lineId)
    const saving = (async () => {
      if (previous) await previous
      if (requestToken !== getLineRequestToken(lineId)) return
      setLineSaveState(lineId, 'saving')
      try {
        const result = await saveLineToApi(line, { requestToken })
        if (result?.stale) {
          return
        }

        setLineSaveState(lineId, 'saved')
        const session = pendingTextEdits.get(lineId)
        if (!session) {
          return
        }

        pendingTextEdits.delete(lineId)
        const finalText = getDisplayedText(line)
        if (!isHistorySuppressed() && session.beforeText !== finalText) {
          pushUndoAction({
            type: 'text',
            pageId: session.pageId,
            lineId: session.lineId,
            beforeText: session.beforeText,
            afterText: finalText,
          })
        }
      } catch (error) {
        if (getLineRequestToken(lineId) === requestToken) {
          setLineSaveState(lineId, 'error', String(error))
        }
      } finally {
        updatePendingUndoCount()
      }
    })()
    inFlightTextSaves.set(lineId, saving)
    void saving.finally(() => {
      if (inFlightTextSaves.get(lineId) === saving) inFlightTextSaves.delete(lineId)
    })
    return saving
  }

  /**
   * Persist queued edits immediately and await in-flight writes before export.
   * Older requests finish before the newest correction is written. This does not flush
   * reorder/delete operations that the caller has not awaited.
   * @returns {Promise<void>} Resolves when queued text saves have completed successfully.
   * @throws {Error} A line remains in the error state; the caller should stop export and offer retry.
   */
  async function flushPendingSaves() {
    // Finish older requests first so the newest correction is the final write.
    while (lineSaveTimers.size || inFlightTextSaves.size) {
      const queuedIds = [...lineSaveTimers.keys()]
      for (const id of queuedIds) {
        clearTimeout(lineSaveTimers.get(id))
        lineSaveTimers.delete(id)
      }
      updatePendingUndoCount()
      await Promise.all([...inFlightTextSaves.values()])
      await Promise.all(queuedIds.map((id) => {
        const session = pendingTextEdits.get(id)
        const line = session && findLineById(session.pageId, id)
        return line ? persistTextSave(line, getLineRequestToken(id)) : undefined
      }))
    }
    if (Object.values(lineSaveState.value).some((state) => state.status === 'error')) {
      throw new Error('Unable to export while line changes are unsaved. Retry the failed edit first.')
    }
  }

  /**
   * Replace a line's debounce timer, advance its request token, and publish pending state
   * before saving after the delay.
   */
  function queueLineSave(line) {
    const lineId = line.id
    setLineSaveState(lineId, 'pending')

    const previousTimer = lineSaveTimers.get(lineId)
    if (previousTimer) {
      clearTimeout(previousTimer)
      lineSaveTimers.delete(lineId)
    }

    const requestToken = bumpLineRequestToken(lineId)
    const timer = setTimeout(() => {
      lineSaveTimers.delete(lineId)
      updatePendingUndoCount()
      void persistTextSave(line, requestToken)
    }, TEXT_SAVE_DEBOUNCE_MS)

    lineSaveTimers.set(lineId, timer)
    updatePendingUndoCount()
  }

  /**
   * Start or extend a text-edit session, remember its original displayed text, update the
   * local correction, and queue a debounced save.
   */
  function onLineInput(line, value) {
    const lineId = line.id
    let session = pendingTextEdits.get(lineId)
    if (!session) {
      pendingSequence.value += 1
      session = {
        pageId: line.page_id,
        lineId,
        beforeText: getDisplayedText(line),
        draftText: value,
        sequence: pendingSequence.value,
      }
      pendingTextEdits.set(lineId, session)
    } else {
      session.draftText = value
    }

    line.corrected_text = value
    queueLineSave(line)
  }

  /**
   * Apply a requested move locally and persist changed orders before adding undo history. On
   * failure, restore local order and best-effort roll back only the backend writes known to
   * have succeeded.
   */
  async function applyReorderOperation(line, targetOrder) {
    const page = findPageById(line.page_id)
    if (!page || !Number.isFinite(targetOrder)) {
      return
    }

    const beforeOrder = captureLineOrderSnapshot(page)
    const afterOrder = buildMovedOrderSnapshot(page, line.id, targetOrder)
    if (!afterOrder.length || snapshotsEqual(beforeOrder, afterOrder)) {
      return
    }

    applyOrderSnapshotLocally(page, afterOrder)

    try {
      await persistOrderSnapshot(page, beforeOrder, afterOrder)
      if (!isHistorySuppressed()) {
        pushUndoAction({
          type: 'reorder',
          pageId: page.id,
          beforeOrder,
          afterOrder,
        })
      }
      setUndoError('')
    } catch (error) {
      applyOrderSnapshotLocally(page, beforeOrder)
      const successfulIds = Array.isArray(error.successfulIds) ? error.successfulIds : []
      if (successfulIds.length) {
        await restoreBackendOrderSnapshot(page, beforeOrder, successfulIds)
      }
      setUndoError(`Unable to save line order. Restored previous order. ${String(error)}`)
    }
  }

  /**
   * Request a relative move from the line's current one-based order.
   */
  function moveLine(line, offset) {
    const currentOrder = Number(line.line_order || 1)
    applyReorderOperation(line, currentOrder + offset)
  }

  /**
   * Parse a numeric order input and request the corresponding absolute move, ignoring invalid
   * input.
   */
  function commitLineOrderInput(line, value) {
    const parsed = Number.parseInt(String(value), 10)
    if (!Number.isFinite(parsed)) {
      return
    }

    applyReorderOperation(line, parsed)
  }

  /**
   * Cancel pending text for a line, delete it through the API, and persist contiguous orders
   * for survivors. Save the original line/order snapshots for undo after success; report
   * failures through line and undo feedback.
   */
  async function deleteLine(line) {
    const page = findPageById(line.page_id)
    if (!page) {
      return
    }

    cancelPendingTextSave(line.id, { restoreInitialText: false, clearPendingState: true })

    const lineSnapshot = cloneLineSnapshot(line)
    const beforeOrder = captureLineOrderSnapshot(page)
    setLineSaveState(line.id, 'saving', 'Deleting...')

    try {
      const response = await backendFetch(`/lines/${line.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(`Unable to delete line ${line.id} (${response.status})`)
      }

      page.lines = page.lines.filter((candidate) => candidate.id !== line.id)
      removeLineSaveState(line.id)

      if (selectedLineId.value === line.id) {
        selectedLineId.value = null
      }
      if (activeLineId.value === line.id) {
        activeLineId.value = null
      }

      const sorted = [...page.lines].sort(
        (a, b) => (a.line_order || Number.MAX_SAFE_INTEGER) - (b.line_order || Number.MAX_SAFE_INTEGER) || a.id - b.id
      )
      sorted.forEach((candidate, index) => {
        candidate.line_order = index + 1
      })
      page.lines = sorted

      const previousRemainingOrder = beforeOrder.filter((entry) => entry.id !== line.id)
      const afterOrder = captureLineOrderSnapshot(page)
      await persistOrderSnapshot(page, previousRemainingOrder, afterOrder)

      if (!isHistorySuppressed()) {
        pushUndoAction({
          type: 'delete',
          pageId: page.id,
          lineSnapshot,
          beforeOrder,
        })
      }
      setUndoError('')
    } catch (error) {
      setLineSaveState(line.id, 'error', String(error))
      setUndoError(`Unable to delete line. ${String(error)}`)
    }
  }

  /**
   * Cancel the latest still-debounced edit and restore its original text locally without
   * creating a server undo write. Select its page/line and report whether a pending edit was
   * found.
   */
  async function undoPendingTextEdit() {
    const pending = getLatestPendingTextEdit()
    if (!pending) {
      return false
    }

    cancelPendingTextSave(pending.lineId, {
      restoreInitialText: true,
      clearPendingState: true,
    })

    await ensurePageSelected(pending.pageId)
    selectedLineId.value = pending.lineId
    activeLineId.value = pending.lineId
    return true
  }

  /**
   * Write an undo action's original text with a fresh request token. Restore the displayed
   * text on failure and select the affected line after a successful write.
   */
  async function undoTextAction(action) {
    const line = findLineById(action.pageId, action.lineId)
    if (!line) {
      throw new Error(`Unable to find line ${action.lineId} for undo`) 
    }

    cancelPendingTextSave(action.lineId, { restoreInitialText: false, clearPendingState: true })
    const token = bumpLineRequestToken(line.id)
    const original = getDisplayedText(line)
    line.corrected_text = action.beforeText || ''
    setLineSaveState(line.id, 'saving', 'Undoing text edit...')

    try {
      const result = await saveLineToApi(line, {
        requestToken: token,
        overrideText: action.beforeText || '',
      })
      if (result?.stale) {
        return
      }
      setLineSaveState(line.id, 'saved')
    } catch (error) {
      line.corrected_text = original
      setLineSaveState(line.id, 'error', String(error))
      throw error
    }

    selectedLineId.value = line.id
    activeLineId.value = line.id
  }

  /**
   * Restore an action's before-order snapshot locally and on the server. If persistence
   * fails, recover the after-order view and attempt to roll back successful undo writes.
   */
  async function undoReorderAction(action) {
    const page = findPageById(action.pageId)
    if (!page) {
      throw new Error(`Unable to find page ${action.pageId} for reorder undo`) 
    }

    applyOrderSnapshotLocally(page, action.beforeOrder)
    try {
      await persistOrderSnapshot(page, action.afterOrder, action.beforeOrder)
    } catch (error) {
      applyOrderSnapshotLocally(page, action.afterOrder)
      const successfulIds = Array.isArray(error.successfulIds) ? error.successfulIds : []
      if (successfulIds.length) {
        await restoreBackendOrderSnapshot(page, action.afterOrder, successfulIds)
      }
      throw error
    }
  }

  /**
   * Restore a deleted line through the API, reapply the original page order, and select the
   * restored line.
   */
  async function undoDeleteAction(action) {
    const page = findPageById(action.pageId)
    if (!page) {
      throw new Error(`Unable to find page ${action.pageId} for delete undo`) 
    }

    const restored = await restoreDeletedLineAction(action)
    upsertRestoredLine(page, restored)
    applyOrderSnapshotLocally(page, action.beforeOrder)
    selectedLineId.value = restored.id
    activeLineId.value = restored.id
    removeLineSaveState(restored.id)
  }

  /**
   * Undo a waiting text edit before consulting committed history. Serialize undo execution,
   * suppress new history entries during restoration, and pop a committed action only after
   * successful completion.
   */
  async function undoLastAction() {
    if (isUndoing.value) {
      return
    }

    isUndoing.value = true
    try {
      const undonePending = await undoPendingTextEdit()
      if (undonePending) {
        setUndoError('')
        return
      }

      const action = peekUndoAction()
      if (!action) {
        return
      }

      await ensurePageSelected(action.pageId)

      await withHistorySuppressed(async () => {
        if (action.type === 'text') {
          await undoTextAction(action)
          return
        }
        if (action.type === 'reorder') {
          await undoReorderAction(action)
          return
        }
        if (action.type === 'delete') {
          await undoDeleteAction(action)
          return
        }

        throw new Error(`Unsupported undo action type: ${String(action.type)}`)
      })

      popUndoAction()
      setUndoError('')
    } catch (error) {
      setUndoError(`Undo failed: ${String(error)}`)
    } finally {
      isUndoing.value = false
    }
  }

  /**
   * Cancel queued debounce timers, invalidate existing line request tokens, and clear pending
   * sessions during dataset teardown. Already sent requests are not aborted.
   */
  function clearPendingTimers() {
    for (const timer of lineSaveTimers.values()) {
      clearTimeout(timer)
    }
    lineSaveTimers.clear()
    for (const id of lineRequestTokens.keys()) bumpLineRequestToken(id)
    pendingTextEdits.clear()
    pendingUndoCount.value = 0
  }

  return {
    lineSaveState,
    undoStack,
    canUndo,
    undoLabel,
    isUndoing,
    undoErrorMessage,
    setLineSaveState,
    onLineInput,
    moveLine,
    commitLineOrderInput,
    deleteLine,
    undoLastAction,
    clearUndoHistory: clearUndoAndPendingTextEdits,
    clearPendingTimers,
    flushPendingSaves,
  }
}
