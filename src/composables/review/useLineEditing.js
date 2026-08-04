import { computed, ref } from 'vue'

import { useReviewHistory } from './useReviewHistory'

const TEXT_SAVE_DEBOUNCE_MS = 350

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

  function isHistorySuppressed() {
    return historyWriteDepth.value > 0
  }

  async function withHistorySuppressed(callback) {
    historyWriteDepth.value += 1
    try {
      return await callback()
    } finally {
      historyWriteDepth.value -= 1
    }
  }

  function getDisplayedText(line) {
    return line.corrected_text || line.ocr_text || ''
  }

  function removeLineSaveState(lineId) {
    if (!lineSaveState.value[lineId]) {
      return
    }

    const next = { ...lineSaveState.value }
    delete next[lineId]
    lineSaveState.value = next
  }

  function setLineSaveState(lineId, status, message = '') {
    lineSaveState.value = {
      ...lineSaveState.value,
      [lineId]: { status, message },
    }
  }

  function bumpLineRequestToken(lineId) {
    const next = (lineRequestTokens.get(lineId) || 0) + 1
    lineRequestTokens.set(lineId, next)
    return next
  }

  function getLineRequestToken(lineId) {
    return lineRequestTokens.get(lineId) || 0
  }

  function findPageById(pageId) {
    return pages.value.find((candidate) => candidate.id === pageId) || null
  }

  function findLineById(pageId, lineId) {
    const page = findPageById(pageId)
    if (!page || !Array.isArray(page.lines)) {
      return null
    }
    return page.lines.find((candidate) => candidate.id === lineId) || null
  }

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

  function findPageIndexById(pageId) {
    return pages.value.findIndex((candidate) => candidate.id === pageId)
  }

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

  function updatePendingUndoCount() {
    let count = 0
    for (const lineId of pendingTextEdits.keys()) {
      if (lineSaveTimers.has(lineId)) {
        count += 1
      }
    }
    pendingUndoCount.value = count
  }

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

  function upsertRestoredLine(page, linePayload) {
    const existingIndex = page.lines.findIndex((candidate) => candidate.id === linePayload.id)
    if (existingIndex >= 0) {
      page.lines.splice(existingIndex, 1, linePayload)
      return
    }
    page.lines.push(linePayload)
  }

  function clearUndoAndPendingTextEdits() {
    clearUndoHistory()
    pendingTextEdits.clear()
    pendingUndoCount.value = 0
  }

  function queueLineSave(line) {
    const lineId = line.id
    setLineSaveState(lineId, 'pending')

    const previousTimer = lineSaveTimers.get(lineId)
    if (previousTimer) {
      clearTimeout(previousTimer)
      lineSaveTimers.delete(lineId)
    }

    const requestToken = bumpLineRequestToken(lineId)
    const timer = setTimeout(async () => {
      lineSaveTimers.delete(lineId)
      updatePendingUndoCount()

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
    }, TEXT_SAVE_DEBOUNCE_MS)

    lineSaveTimers.set(lineId, timer)
    updatePendingUndoCount()
  }

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

  function moveLine(line, offset) {
    const currentOrder = Number(line.line_order || 1)
    applyReorderOperation(line, currentOrder + offset)
  }

  function commitLineOrderInput(line, value) {
    const parsed = Number.parseInt(String(value), 10)
    if (!Number.isFinite(parsed)) {
      return
    }

    applyReorderOperation(line, parsed)
  }

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

  function clearPendingTimers() {
    for (const timer of lineSaveTimers.values()) {
      clearTimeout(timer)
    }
    lineSaveTimers.clear()
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
  }
}
