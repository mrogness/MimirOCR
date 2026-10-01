import { ref } from 'vue'
import { afterEach, beforeEach, vi } from 'vitest'
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
  const backendFetch = vi.fn(async (_url, options) => ok(JSON.parse(options.body || '{}').corrected_text))
  const editing = useLineEditing({
    pages, selectedPage: ref(pages.value[0]), selectedLineId, activeLineId, backendFetch,
    refreshPagesPreservingSelection: vi.fn(), selectPageById: vi.fn(),
  })
  return { ...editing, pages, selectedLineId, activeLineId, backendFetch, line: pages.value[0].lines[0] }
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
})
