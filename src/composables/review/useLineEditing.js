import { ref } from 'vue'

export function useLineEditing({ selectedPage, pages, selectedLineId, activeLineId, backendFetch, refreshPagesPreservingSelection }) {
  const lineSaveState = ref({})
  const lineSaveTimers = new Map()

  function setLineSaveState(lineId, status, message = '') {
    lineSaveState.value = {
      ...lineSaveState.value,
      [lineId]: { status, message },
    }
  }

  function onLineInput(line, value) {
    line.corrected_text = value
    queueLineSave(line)
  }

  function findLineForRetry(target) {
    const page = pages.value.find((candidate) => candidate.id === target.page_id)
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

  async function saveLineToApi(line, { allowRetry = true } = {}) {
    const response = await backendFetch(`/lines/${line.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        corrected_text: line.corrected_text || '',
        page_id: line.page_id,
        line_order: line.line_order,
      }),
    })

    if (response.ok) {
      const payload = await response.json()
      const corrected = payload?.line?.corrected_text
      line.corrected_text = typeof corrected === 'string' ? corrected : line.corrected_text
      return
    }

    if (response.status === 404 && allowRetry) {
      setLineSaveState(line.id, 'saving', 'Refreshing line mapping...')
      await refreshPagesPreservingSelection()
      const refreshedLine = findLineForRetry(line)
      if (!refreshedLine) {
        throw new Error(`Unable to save line ${line.id} (404)`)
      }

      refreshedLine.corrected_text = line.corrected_text || ''
      await saveLineToApi(refreshedLine, { allowRetry: false })
      return
    }

    throw new Error(`Unable to save line ${line.id} (${response.status})`)
  }

  async function persistLineOrderChanges(lines) {
    for (const line of lines) {
      setLineSaveState(line.id, 'saving', 'Saving order...')
      try {
        await saveLineToApi(line)
        setLineSaveState(line.id, 'saved')
      } catch (error) {
        setLineSaveState(line.id, 'error', String(error))
      }
    }
  }

  function reorderLine(line, targetOrder) {
    const page = selectedPage.value
    if (!page || !Number.isFinite(targetOrder)) {
      return
    }

    const sorted = [...page.lines].sort(
      (a, b) => (a.line_order || Number.MAX_SAFE_INTEGER) - (b.line_order || Number.MAX_SAFE_INTEGER) || a.id - b.id
    )
    const fromIndex = sorted.findIndex((candidate) => candidate.id === line.id)
    if (fromIndex < 0) {
      return
    }

    const oldOrdersById = new Map(sorted.map((candidate) => [candidate.id, candidate.line_order || null]))
    const clampedTarget = Math.max(1, Math.min(Math.round(targetOrder), sorted.length))

    const [moving] = sorted.splice(fromIndex, 1)
    sorted.splice(clampedTarget - 1, 0, moving)
    sorted.forEach((candidate, idx) => {
      candidate.line_order = idx + 1
    })

    page.lines = sorted
    const changed = sorted.filter((candidate) => oldOrdersById.get(candidate.id) !== candidate.line_order)
    if (changed.length) {
      persistLineOrderChanges(changed)
    }
  }

  function moveLine(line, offset) {
    const currentOrder = Number(line.line_order || 1)
    reorderLine(line, currentOrder + offset)
  }

  function commitLineOrderInput(line, value) {
    const parsed = Number.parseInt(String(value), 10)
    if (!Number.isFinite(parsed)) {
      return
    }

    reorderLine(line, parsed)
  }

  async function deleteLine(line) {
    const page = selectedPage.value
    if (!page) {
      return
    }

    setLineSaveState(line.id, 'saving', 'Deleting...')
    try {
      const response = await backendFetch(`/lines/${line.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`Unable to delete line ${line.id} (${response.status})`)
      }

      page.lines = page.lines.filter((candidate) => candidate.id !== line.id)
      const nextSaveState = { ...lineSaveState.value }
      delete nextSaveState[line.id]
      lineSaveState.value = nextSaveState

      if (selectedLineId.value === line.id) {
        selectedLineId.value = null
      }
      if (activeLineId.value === line.id) {
        activeLineId.value = null
      }

      const reindexed = [...page.lines].sort(
        (a, b) => (a.line_order || Number.MAX_SAFE_INTEGER) - (b.line_order || Number.MAX_SAFE_INTEGER) || a.id - b.id
      )
      const oldOrdersById = new Map(reindexed.map((candidate) => [candidate.id, candidate.line_order || null]))
      reindexed.forEach((candidate, idx) => {
        candidate.line_order = idx + 1
      })

      const changed = reindexed.filter((candidate) => oldOrdersById.get(candidate.id) !== candidate.line_order)
      if (changed.length) {
        persistLineOrderChanges(changed)
      }
    } catch (error) {
      setLineSaveState(line.id, 'error', String(error))
    }
  }

  function queueLineSave(line) {
    const lineId = line.id
    setLineSaveState(lineId, 'pending')

    const previousTimer = lineSaveTimers.get(lineId)
    if (previousTimer) {
      clearTimeout(previousTimer)
    }

    const timer = setTimeout(async () => {
      setLineSaveState(lineId, 'saving')
      try {
        await saveLineToApi(line)
        setLineSaveState(lineId, 'saved')
      } catch (error) {
        setLineSaveState(lineId, 'error', String(error))
      } finally {
        lineSaveTimers.delete(lineId)
      }
    }, 350)

    lineSaveTimers.set(lineId, timer)
  }

  function clearPendingTimers() {
    for (const timer of lineSaveTimers.values()) {
      clearTimeout(timer)
    }
    lineSaveTimers.clear()
  }

  return {
    lineSaveState,
    setLineSaveState,
    onLineInput,
    moveLine,
    commitLineOrderInput,
    deleteLine,
    clearPendingTimers,
  }
}
