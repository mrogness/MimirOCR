import { computed, ref } from 'vue'

const MAX_UNDO_ACTIONS = 100

function cloneSerializable(value) {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch (_error) {
      // Vue reactive proxies can fail structuredClone. Fall back to JSON cloning
      // for our plain action payloads and line snapshots.
    }
  }
  return JSON.parse(JSON.stringify(value))
}

function describeUndoAction(action) {
  if (!action || typeof action !== 'object') {
    return 'Undo'
  }

  if (action.type === 'text') {
    return 'Undo text edit'
  }
  if (action.type === 'reorder') {
    return 'Undo line reorder'
  }
  if (action.type === 'delete') {
    return 'Undo line deletion'
  }

  return 'Undo'
}

export function useReviewHistory() {
  const undoStack = ref([])
  const isUndoing = ref(false)
  const undoErrorMessage = ref('')

  const canUndo = computed(() => undoStack.value.length > 0)
  const undoLabel = computed(() => {
    const action = undoStack.value[undoStack.value.length - 1] || null
    return describeUndoAction(action)
  })

  function pushUndoAction(action) {
    const cloned = cloneSerializable(action)
    const next = [...undoStack.value, cloned]
    if (next.length > MAX_UNDO_ACTIONS) {
      next.splice(0, next.length - MAX_UNDO_ACTIONS)
    }
    undoStack.value = next
  }

  function peekUndoAction() {
    return undoStack.value[undoStack.value.length - 1] || null
  }

  function popUndoAction() {
    if (undoStack.value.length === 0) {
      return null
    }
    const next = undoStack.value.slice(0, -1)
    const popped = undoStack.value[undoStack.value.length - 1]
    undoStack.value = next
    return popped
  }

  function clearUndoHistory() {
    undoStack.value = []
    undoErrorMessage.value = ''
  }

  function setUndoError(message) {
    undoErrorMessage.value = message || ''
  }

  return {
    undoStack,
    canUndo,
    undoLabel,
    isUndoing,
    undoErrorMessage,
    pushUndoAction,
    peekUndoAction,
    popUndoAction,
    clearUndoHistory,
    setUndoError,
    cloneSerializable,
    describeUndoAction,
  }
}
