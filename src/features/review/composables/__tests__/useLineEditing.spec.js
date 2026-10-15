import { ref } from 'vue'
import { afterEach, beforeEach, vi } from 'vitest'
import { deferred, jsonResponse } from '../../../../test/helpers'
import { useLineEditing } from '../useLineEditing'

function ok(text) {
  return { ok: true, json: async () => ({ line: { corrected_text: text } }) }
}

function harness() {
  const pages = ref([{ id: 10, lines: [
    { id: 101, page_id: 10, line_order: 1, ocr_text: 'Original', corrected_text: null },
    { id: 102, page_id: 10, line_order: 2, ocr_text: 'Second', corrected_text: null },
  ] }])
  const selectedLineId = ref(101)
  const activeLineId = ref(101)
  const refreshPagesPreservingSelection = vi.fn(async () => {})
  const backendFetch = vi.fn(async (_url, options) => ok(JSON.parse(options.body || '{}').corrected_text))
  const editing = useLineEditing({
    pages, selectedPage: ref(pages.value[0]), selectedLineId, activeLineId, backendFetch,
    refreshPagesPreservingSelection, selectPageById: vi.fn(),
  })
  return { ...editing, pages, selectedLineId, activeLineId, backendFetch, refreshPagesPreservingSelection, line: pages.value[0].lines[0] }
}

describe('line editing persistence', () => {
  let editor
  beforeEach(() => {
    vi.useFakeTimers()
    editor = harness()
  })
  afterEach(() => {
    editor.clearPendingTimers()
    vi.useRealTimers()
  })

  it('debounces rapid input into one save and one undo entry', async () => {
    editor.onLineInput(editor.line, 'First')
    await vi.advanceTimersByTimeAsync(200)
    editor.onLineInput(editor.line, 'Ændret')
    await vi.advanceTimersByTimeAsync(349)
    expect(editor.backendFetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(editor.backendFetch).toHaveBeenCalledTimes(1)
    const [url, options] = editor.backendFetch.mock.calls[0]
    expect(url).toBe('/lines/101')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ corrected_text: 'Ændret', page_id: 10, line_order: 1 })
    expect(editor.lineSaveState.value[101].status).toBe('saved')
    expect(editor.undoStack.value).toEqual([expect.objectContaining({ beforeText: 'Original', afterText: 'Ændret' })])
  })

  it('undoes a pending edit without contacting the backend', async () => {
    editor.onLineInput(editor.line, 'Draft')
    expect(editor.canUndo.value).toBe(true)
    await editor.undoLastAction()
    await vi.advanceTimersByTimeAsync(1000)
    expect(editor.line.corrected_text).toBe('Original')
    expect(editor.backendFetch).not.toHaveBeenCalled()
    expect(editor.canUndo.value).toBe(false)
  })

  it('persists undo of a completed edit without adding another history entry', async () => {
    editor.onLineInput(editor.line, 'Corrected')
    await vi.advanceTimersByTimeAsync(350)
    await editor.undoLastAction()
    expect(editor.backendFetch).toHaveBeenCalledTimes(2)
    expect(editor.line.corrected_text).toBe('Original')
    expect(editor.canUndo.value).toBe(false)
    expect(editor.isUndoing.value).toBe(false)
  })

  it('retains the edit and undo entry if the undo request fails', async () => {
    editor.onLineInput(editor.line, 'Corrected')
    await vi.advanceTimersByTimeAsync(350)
    editor.backendFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await editor.undoLastAction()
    expect(editor.line.corrected_text).toBe('Corrected')
    expect(editor.canUndo.value).toBe(true)
    expect(editor.undoErrorMessage.value).toContain('Undo failed')
    expect(editor.isUndoing.value).toBe(false)
  })

  it('shows failed saves and lets a subsequent edit retry', async () => {
    editor.backendFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    editor.onLineInput(editor.line, 'Draft')
    await vi.advanceTimersByTimeAsync(350)
    expect(editor.lineSaveState.value[101].status).toBe('error')
    expect(editor.undoStack.value).toHaveLength(0)
    editor.onLineInput(editor.line, 'Retry')
    await vi.advanceTimersByTimeAsync(350)
    expect(editor.lineSaveState.value[101].status).toBe('saved')
    expect(editor.undoStack.value[0].beforeText).toBe('Original')
  })

  it('ignores an older response after a newer edit has been queued', async () => {
    let resolveOld
    editor.backendFetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    editor.onLineInput(editor.line, 'Old')
    await vi.advanceTimersByTimeAsync(350)
    editor.onLineInput(editor.line, 'New')
    resolveOld(ok('Old'))
    await vi.advanceTimersByTimeAsync(0)
    expect(editor.line.corrected_text).toBe('New')
    expect(editor.lineSaveState.value[101].status).toBe('pending')
    await vi.advanceTimersByTimeAsync(350)
    expect(editor.undoStack.value).toHaveLength(1)
    expect(editor.undoStack.value[0].afterText).toBe('New')
  })

  it('cancels queued saves on cleanup', async () => {
    editor.onLineInput(editor.line, 'Draft')
    editor.clearPendingTimers()
    await vi.advanceTimersByTimeAsync(1000)
    expect(editor.backendFetch).not.toHaveBeenCalled()
    expect(editor.canUndo.value).toBe(false)
  })

  it('keeps a line in the page when deletion fails', async () => {
    editor.backendFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await editor.deleteLine(editor.line)
    expect(editor.pages.value[0].lines.map(line => line.id)).toEqual([101, 102])
    expect(editor.selectedLineId.value).toBe(101)
    expect(editor.undoStack.value).toHaveLength(0)
    expect(editor.undoErrorMessage.value).toContain('Unable to delete line')
  })

  it('deletes, renumbers and records a restorable snapshot', async () => {
    await editor.deleteLine(editor.line)
    expect(editor.pages.value[0].lines.map(line => [line.id, line.line_order])).toEqual([[102, 1]])
    expect(editor.selectedLineId.value).toBeNull()
    expect(editor.activeLineId.value).toBeNull()
    expect(editor.undoStack.value[0]).toMatchObject({ type: 'delete', lineSnapshot: { id: 101 } })
    editor.backendFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ line: editor.line }) })
    await editor.undoLastAction()
    expect(editor.backendFetch.mock.lastCall[0]).toBe('/lines/restore')
    expect(editor.pages.value[0].lines.map(line => line.id)).toEqual([101, 102])
    expect(editor.canUndo.value).toBe(false)
  })

  it('persists a moved order and restores it on undo', async () => {
    editor.moveLine(editor.line, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(editor.pages.value[0].lines.map(l => l.id)).toEqual([102, 101])
    expect(editor.backendFetch.mock.calls.map(([, options]) => JSON.parse(options.body).line_order)).toEqual([1, 2])
    expect(editor.undoStack.value[0].type).toBe('reorder')
    await editor.undoLastAction()
    expect(editor.pages.value[0].lines.map(l => [l.id, l.line_order])).toEqual([[101, 1], [102, 2]])
    expect(editor.canUndo.value).toBe(false)
  })

  it('rolls back a partially persisted reorder without adding history', async () => {
    editor.backendFetch.mockResolvedValueOnce(ok('Second')).mockResolvedValueOnce({ ok: false, status: 500 })
    editor.moveLine(editor.line, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(editor.pages.value[0].lines.map(l => [l.id, l.line_order])).toEqual([[101, 1], [102, 2]])
    expect(editor.backendFetch).toHaveBeenCalledTimes(3)
    expect(JSON.parse(editor.backendFetch.mock.lastCall[1].body).line_order).toBe(2)
    expect(editor.undoStack.value).toHaveLength(0)
    expect(editor.undoErrorMessage.value).toContain('Restored previous order')
  })

  it('retains a reorder history entry when undo fails', async () => {
    editor.commitLineOrderInput(editor.line, '2')
    await vi.advanceTimersByTimeAsync(0)
    editor.backendFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await editor.undoLastAction()
    expect(editor.pages.value[0].lines.map(l => l.id)).toEqual([102, 101])
    expect(editor.canUndo.value).toBe(true)
    expect(editor.undoErrorMessage.value).toContain('Undo failed')
  })

  it('ignores invalid and unchanged line-order input', async () => {
    editor.commitLineOrderInput(editor.line, 'no')
    editor.commitLineOrderInput(editor.line, '-10')
    await vi.advanceTimersByTimeAsync(0)
    expect(editor.backendFetch).not.toHaveBeenCalled()
  })

  it('flushes a queued correction before export without waiting for the debounce', async () => {
    editor.onLineInput(editor.line, 'Latest correction')
    await editor.flushPendingSaves()
    expect(editor.backendFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(editor.backendFetch.mock.calls[0][1].body).corrected_text).toBe('Latest correction')
    await vi.advanceTimersByTimeAsync(1000)
    expect(editor.backendFetch).toHaveBeenCalledOnce()
  })

  it('waits for an in-flight save before flushing the newer correction', async () => {
    const pending = deferred()
    editor.backendFetch.mockReturnValueOnce(pending.promise)
    editor.onLineInput(editor.line, 'Older')
    await vi.advanceTimersByTimeAsync(350)
    editor.onLineInput(editor.line, 'Newest')
    const flushing = editor.flushPendingSaves()
    expect(editor.backendFetch).toHaveBeenCalledOnce()
    pending.resolve(ok('Older'))
    await flushing
    expect(editor.line.corrected_text).toBe('Newest')
    expect(JSON.parse(editor.backendFetch.mock.lastCall[1].body).corrected_text).toBe('Newest')
  })

  it('refuses export when a pending correction could not be saved', async () => {
    editor.backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    editor.onLineInput(editor.line, 'Keep my draft')
    await expect(editor.flushPendingSaves()).rejects.toThrow(/unsaved/i)
    expect(editor.line.corrected_text).toBe('Keep my draft')
    expect(editor.lineSaveState.value[101].status).toBe('error')
  })

  it('refreshes and retries a missing line once while preserving the correction', async () => {
    editor.backendFetch.mockResolvedValueOnce(jsonResponse({}, 404))
    editor.onLineInput(editor.line, 'Ændret')
    await vi.advanceTimersByTimeAsync(350)
    expect(editor.refreshPagesPreservingSelection).toHaveBeenCalledOnce()
    expect(editor.backendFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(editor.backendFetch.mock.lastCall[1].body).corrected_text).toBe('Ændret')
    expect(editor.lineSaveState.value[101].status).toBe('saved')
  })

  it('surfaces a repeated 404 without retrying indefinitely', async () => {
    editor.backendFetch.mockResolvedValue(jsonResponse({}, 404))
    editor.onLineInput(editor.line, 'Keep this draft')
    await vi.advanceTimersByTimeAsync(350)
    expect(editor.backendFetch).toHaveBeenCalledTimes(2)
    expect(editor.line.corrected_text).toBe('Keep this draft')
    expect(editor.lineSaveState.value[101].status).toBe('error')
  })


})
