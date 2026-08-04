import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLineEditing } from './useLineEditing'
import { useReviewHistory } from './useReviewHistory'

function makeJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

function makeEmptyResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return {}
    },
  }
}

function createLine({ id, pageId, order, text = '', overrides = {} }) {
  return {
    id,
    page_id: pageId,
    line_order: order,
    img_path: `/tmp/${id}.png`,
    bounding_box: { x_min: 1, y_min: 2, x_max: 3, y_max: 4 },
    polygon_points: [[1, 2], [3, 4], [5, 6]],
    ocr_text: text,
    corrected_text: text,
    line_confidence: 0.9,
    char_confidence: '{"a":0.9}',
    char_positions: [{ ch: 'a', start: 0, end: 1 }],
    ...overrides,
  }
}

function clone(value) {
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function createHarness({ pagesData, backendFetch, selectedPageIndex = 0 }) {
  const pages = ref(clone(pagesData))
  const selectedPageIndexRef = ref(selectedPageIndex)
  const selectedPage = computed(() => pages.value[selectedPageIndexRef.value] || null)
  const selectedLineId = ref(null)
  const activeLineId = ref(null)

  const composable = useLineEditing({
    selectedPage,
    pages,
    selectedLineId,
    activeLineId,
    backendFetch,
    refreshPagesPreservingSelection: vi.fn(async () => {}),
    selectPageById: (pageId) => {
      const index = pages.value.findIndex((page) => page.id === pageId)
      if (index >= 0) {
        selectedPageIndexRef.value = index
      }
    },
  })

  return {
    pages,
    selectedPage,
    selectedPageIndexRef,
    selectedLineId,
    activeLineId,
    ...composable,
  }
}

function getLineById(pagesRef, lineId) {
  for (const page of pagesRef.value) {
    const line = page.lines.find((candidate) => candidate.id === lineId)
    if (line) {
      return line
    }
  }
  return null
}

async function flushMicrotasks(count = 5) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useLineEditing undo behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces rapid keystrokes into one text undo action', async () => {
    const patchCalls = []
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        patchCalls.push(payload)
        const line = getLineById(harness.pages, lineId)
        line.corrected_text = payload.corrected_text
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [{ id: 1, lines: [createLine({ id: 11, pageId: 1, order: 1, text: 'alpha' })] }],
      backendFetch,
    })

    const line = harness.pages.value[0].lines[0]
    harness.onLineInput(line, 'beta')
    harness.onLineInput(line, 'betax')
    harness.onLineInput(line, 'beta-final')

    await vi.advanceTimersByTimeAsync(350)
    await flushMicrotasks()

    expect(patchCalls).toHaveLength(1)
    expect(harness.undoStack.value).toHaveLength(1)
    expect(harness.undoStack.value[0]).toMatchObject({
      type: 'text',
      lineId: 11,
      beforeText: 'alpha',
      afterText: 'beta-final',
    })
  })

  it('undo before debounce cancels save and restores original text', async () => {
    const backendFetch = vi.fn(async () => makeJsonResponse(200, { line: {} }))
    const harness = createHarness({
      pagesData: [{ id: 1, lines: [createLine({ id: 21, pageId: 1, order: 1, text: 'orig' })] }],
      backendFetch,
    })

    const line = harness.pages.value[0].lines[0]
    harness.onLineInput(line, 'edited')
    expect(harness.canUndo.value).toBe(true)

    await harness.undoLastAction()
    expect(line.corrected_text).toBe('orig')

    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()

    expect(backendFetch).not.toHaveBeenCalled()
    expect(harness.canUndo.value).toBe(false)
  })

  it('undo after saved text edit PATCHes previous text', async () => {
    const patchBodies = []
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        patchBodies.push(payload)
        const line = getLineById(harness.pages, lineId)
        line.corrected_text = payload.corrected_text
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [{ id: 1, lines: [createLine({ id: 31, pageId: 1, order: 1, text: 'start' })] }],
      backendFetch,
    })

    const line = harness.pages.value[0].lines[0]
    harness.onLineInput(line, 'final')
    await vi.advanceTimersByTimeAsync(350)
    await flushMicrotasks()

    await harness.undoLastAction()
    await flushMicrotasks()

    expect(patchBodies).toHaveLength(2)
    expect(patchBodies[1].corrected_text).toBe('start')
    expect(line.corrected_text).toBe('start')
  })

  it('does not add no-op text edits to undo history', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const line = getLineById(harness.pages, lineId)
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [{ id: 1, lines: [createLine({ id: 41, pageId: 1, order: 1, text: 'same' })] }],
      backendFetch,
    })

    const line = harness.pages.value[0].lines[0]
    harness.onLineInput(line, 'same')
    await vi.advanceTimersByTimeAsync(350)
    await flushMicrotasks()

    expect(harness.undoStack.value).toHaveLength(0)
  })

  it('moving a line records and restores full page order', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.line_order = payload.line_order
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [
        {
          id: 2,
          lines: [
            createLine({ id: 51, pageId: 2, order: 1, text: 'a' }),
            createLine({ id: 52, pageId: 2, order: 2, text: 'b' }),
            createLine({ id: 53, pageId: 2, order: 3, text: 'c' }),
          ],
        },
      ],
      backendFetch,
    })

    harness.moveLine(harness.pages.value[0].lines[0], 1)
    await flushMicrotasks()

    expect(harness.undoStack.value).toHaveLength(1)
    expect(harness.undoStack.value[0].type).toBe('reorder')

    await harness.undoLastAction()
    await flushMicrotasks()

    const orderedIds = [...harness.pages.value[0].lines]
      .sort((a, b) => a.line_order - b.line_order)
      .map((line) => line.id)
    expect(orderedIds).toEqual([51, 52, 53])
  })

  it('numeric order changes are undone as one operation', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.line_order = payload.line_order
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [
        {
          id: 3,
          lines: [
            createLine({ id: 61, pageId: 3, order: 1, text: 'a' }),
            createLine({ id: 62, pageId: 3, order: 2, text: 'b' }),
            createLine({ id: 63, pageId: 3, order: 3, text: 'c' }),
          ],
        },
      ],
      backendFetch,
    })

    harness.commitLineOrderInput(harness.pages.value[0].lines[2], '1')
    await flushMicrotasks()

    expect(harness.undoStack.value).toHaveLength(1)
    expect(harness.undoStack.value[0]).toMatchObject({ type: 'reorder', pageId: 3 })

    await harness.undoLastAction()
    await flushMicrotasks()

    const orderedIds = [...harness.pages.value[0].lines]
      .sort((a, b) => a.line_order - b.line_order)
      .map((line) => line.id)
    expect(orderedIds).toEqual([61, 62, 63])
  })

  it('failed reorder persistence does not enter history', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        if (lineId === 72) {
          return makeEmptyResponse(500)
        }
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.line_order = payload.line_order
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [
        {
          id: 4,
          lines: [
            createLine({ id: 71, pageId: 4, order: 1, text: 'a' }),
            createLine({ id: 72, pageId: 4, order: 2, text: 'b' }),
          ],
        },
      ],
      backendFetch,
    })

    harness.moveLine(harness.pages.value[0].lines[0], 1)
    await flushMicrotasks()

    const orderedIds = [...harness.pages.value[0].lines]
      .sort((a, b) => a.line_order - b.line_order)
      .map((line) => line.id)

    expect(orderedIds).toEqual([71, 72])
    expect(harness.undoStack.value).toHaveLength(0)
    expect(harness.undoErrorMessage.value).toContain('Unable to save line order')
  })

  it('delete undo restores same line id, line fields, and prior order', async () => {
    const calls = []
    const backendFetch = vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body || null })

      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.line_order = payload.line_order
        line.corrected_text = payload.corrected_text
        return makeJsonResponse(200, { line })
      }

      if (url.startsWith('/lines/') && options.method === 'DELETE') {
        return makeEmptyResponse(204)
      }

      if (url === '/lines/restore' && options.method === 'POST') {
        const payload = JSON.parse(options.body)
        const restored = {
          ...payload.line,
          line_order: payload.line_orders.find((entry) => entry.id === payload.line.id).line_order,
        }
        return makeJsonResponse(200, { line: restored })
      }

      return makeEmptyResponse(404)
    })

    const originalDeleted = createLine({
      id: 82,
      pageId: 5,
      order: 2,
      text: 'middle',
      overrides: {
        corrected_text: 'middle-fixed',
        char_positions: [{ ch: 'm', start: 0, end: 1 }, { ch: 'i', start: 1, end: 2 }],
      },
    })

    const harness = createHarness({
      pagesData: [
        {
          id: 5,
          lines: [
            createLine({ id: 81, pageId: 5, order: 1, text: 'top' }),
            originalDeleted,
            createLine({ id: 83, pageId: 5, order: 3, text: 'bottom' }),
          ],
        },
      ],
      backendFetch,
    })

    await harness.deleteLine(harness.pages.value[0].lines[1])
    expect(harness.undoStack.value).toHaveLength(1)

    await harness.undoLastAction()
    await flushMicrotasks()

    const ordered = [...harness.pages.value[0].lines].sort((a, b) => a.line_order - b.line_order)
    expect(ordered.map((line) => line.id)).toEqual([81, 82, 83])

    const restored = ordered.find((line) => line.id === 82)
    expect(restored.corrected_text).toBe('middle-fixed')
    expect(restored.bounding_box).toEqual(originalDeleted.bounding_box)
    expect(restored.char_positions).toEqual(originalDeleted.char_positions)

    const restoreCall = calls.find((entry) => entry.url === '/lines/restore')
    const restorePayload = JSON.parse(restoreCall.body)
    expect(restorePayload.line.id).toBe(82)
  })

  it('failed line restoration keeps delete action on stack', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.line_order = payload.line_order
        line.corrected_text = payload.corrected_text
        return makeJsonResponse(200, { line })
      }
      if (url.startsWith('/lines/') && options.method === 'DELETE') {
        return makeEmptyResponse(204)
      }
      if (url === '/lines/restore' && options.method === 'POST') {
        return makeEmptyResponse(500)
      }
      return makeEmptyResponse(404)
    })

    const harness = createHarness({
      pagesData: [
        {
          id: 6,
          lines: [
            createLine({ id: 91, pageId: 6, order: 1, text: 'a' }),
            createLine({ id: 92, pageId: 6, order: 2, text: 'b' }),
          ],
        },
      ],
      backendFetch,
    })

    await harness.deleteLine(harness.pages.value[0].lines[1])
    expect(harness.undoStack.value).toHaveLength(1)

    await harness.undoLastAction()
    await flushMicrotasks()

    expect(harness.undoStack.value).toHaveLength(1)
    expect(harness.undoStack.value[0].type).toBe('delete')
  })

  it('undoing another page action selects that page and line', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.corrected_text = payload.corrected_text
        line.line_order = payload.line_order
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      selectedPageIndex: 1,
      pagesData: [
        { id: 10, lines: [createLine({ id: 101, pageId: 10, order: 1, text: 'p1' })] },
        { id: 20, lines: [createLine({ id: 201, pageId: 20, order: 1, text: 'p2' })] },
      ],
      backendFetch,
    })

    const lineOnPageTwo = harness.pages.value[1].lines[0]
    harness.onLineInput(lineOnPageTwo, 'p2-edited')
    await vi.advanceTimersByTimeAsync(350)
    await flushMicrotasks()

    harness.selectedPageIndexRef.value = 0
    await harness.undoLastAction()
    await flushMicrotasks()

    expect(harness.selectedPageIndexRef.value).toBe(1)
    expect(harness.selectedLineId.value).toBe(201)
  })

  it('undo operations do not create additional undo entries', async () => {
    const backendFetch = vi.fn(async (url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        const line = getLineById(harness.pages, lineId)
        line.line_order = payload.line_order
        line.corrected_text = payload.corrected_text
        return makeJsonResponse(200, { line })
      }
      return makeEmptyResponse(204)
    })

    const harness = createHarness({
      pagesData: [
        {
          id: 7,
          lines: [
            createLine({ id: 111, pageId: 7, order: 1, text: 'a' }),
            createLine({ id: 112, pageId: 7, order: 2, text: 'b' }),
          ],
        },
      ],
      backendFetch,
    })

    harness.moveLine(harness.pages.value[0].lines[0], 1)
    await flushMicrotasks()

    expect(harness.undoStack.value).toHaveLength(1)
    await harness.undoLastAction()
    await flushMicrotasks()
    expect(harness.undoStack.value).toHaveLength(0)
  })

  it('stale async text-save responses do not overwrite undo result', async () => {
    const deferredPatchOne = createDeferred()
    const deferredPatchTwo = createDeferred()
    const patchBodies = []
  let patchIndex = 0
    const backendFetch = vi.fn((url, options = {}) => {
      if (url.startsWith('/lines/') && options.method === 'PATCH') {
        const lineId = Number.parseInt(url.split('/').pop(), 10)
        const payload = JSON.parse(options.body)
        patchBodies.push(payload)
        const line = getLineById(harness.pages, lineId)

        patchIndex += 1
        if (patchIndex === 1) {
          return deferredPatchOne.promise.then(() => makeJsonResponse(200, { line: { ...line, corrected_text: payload.corrected_text } }))
        }
        if (patchIndex === 2) {
          return deferredPatchTwo.promise.then(() => makeJsonResponse(200, { line: { ...line, corrected_text: payload.corrected_text } }))
        }

        line.corrected_text = payload.corrected_text
        return Promise.resolve(makeJsonResponse(200, { line }))
      }
      return Promise.resolve(makeEmptyResponse(204))
    })

    const harness = createHarness({
      pagesData: [{ id: 8, lines: [createLine({ id: 121, pageId: 8, order: 1, text: 'orig' })] }],
      backendFetch,
    })

    const line = harness.pages.value[0].lines[0]
    harness.onLineInput(line, 'one')
    await vi.advanceTimersByTimeAsync(350)
    await flushMicrotasks()

    harness.onLineInput(line, 'two')
    await vi.advanceTimersByTimeAsync(350)
    await flushMicrotasks()

    deferredPatchTwo.resolve()
    await flushMicrotasks(8)

    await harness.undoLastAction()
    await flushMicrotasks(8)
    expect(line.corrected_text).toBe('orig')

    deferredPatchOne.resolve()
    await flushMicrotasks(8)

    expect(patchBodies).toHaveLength(3)
    expect(line.corrected_text).toBe('orig')
  })
})

describe('useReviewHistory', () => {
  it('keeps only the latest 100 undo actions', () => {
    const history = useReviewHistory()
    for (let index = 1; index <= 101; index += 1) {
      history.pushUndoAction({ type: 'text', pageId: 1, lineId: index, beforeText: 'a', afterText: 'b' })
    }

    expect(history.undoStack.value).toHaveLength(100)
    expect(history.undoStack.value[0].lineId).toBe(2)
    expect(history.undoStack.value[99].lineId).toBe(101)
  })
})
