/**
 * @file Maintain a bounded undo stack of serializable review action snapshots. This module
 * stores history; useLineEditing performs the corresponding API writes.
 */
import { computed, ref } from 'vue'

const MAX_UNDO_ACTIONS = 100

/**
 * Clone plain action data with structuredClone, falling back to JSON serialization when
 * reactive proxies cannot be cloned.
 */
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

/**
 * Return the undo-button label for a text, reorder, or delete action, using a generic label
 * for unknown data.
 */
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

/**
 * Create independent undo history for a review workspace, retaining at most 100 actions.
 * Snapshots are cloned on insertion so subsequent edits cannot mutate saved history.
 * @returns {object} Reactive history state and push, peek, pop, clear, and error helpers.
 */
export function useReviewHistory() {
  const undoStack = ref([])
  const isUndoing = ref(false)
  const undoErrorMessage = ref('')

  const canUndo = computed(() => undoStack.value.length > 0)
  const undoLabel = computed(() => {
    const action = undoStack.value[undoStack.value.length - 1] || null
    return describeUndoAction(action)
  })

  /**
   * Clone and append an action, trimming the oldest entries when the bounded history limit is
   * exceeded.
   */
  function pushUndoAction(action) {
    const cloned = cloneSerializable(action)
    const next = [...undoStack.value, cloned]
    if (next.length > MAX_UNDO_ACTIONS) {
      next.splice(0, next.length - MAX_UNDO_ACTIONS)
    }
    undoStack.value = next
  }

  /**
   * Return the latest action without removing it, or null for an empty stack.
   */
  function peekUndoAction() {
    return undoStack.value[undoStack.value.length - 1] || null
  }

  /**
   * Remove and return the latest action by replacing the reactive array, or return null when
   * empty.
   */
  function popUndoAction() {
    if (undoStack.value.length === 0) {
      return null
    }
    const next = undoStack.value.slice(0, -1)
    const popped = undoStack.value[undoStack.value.length - 1]
    undoStack.value = next
    return popped
  }

  /**
   * Clear saved actions and the previous undo error message.
   */
  function clearUndoHistory() {
    undoStack.value = []
    undoErrorMessage.value = ''
  }

  /**
   * Set user-facing undo feedback, normalizing an empty value to an empty string.
   */
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
