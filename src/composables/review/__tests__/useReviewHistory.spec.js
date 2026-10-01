import { reactive } from 'vue'
import { useReviewHistory } from '../useReviewHistory'

describe('review history', () => {
  it('starts empty and handles an empty pop', () => {
    const history = useReviewHistory()
    expect(history.canUndo.value).toBe(false)
    expect(history.undoLabel.value).toBe('Undo')
    expect(history.popUndoAction()).toBeNull()
  })

  it('takes independent snapshots of reactive action payloads', () => {
    const history = useReviewHistory()
    const action = reactive({ type: 'delete', lineSnapshot: { id: 1, corrected_text: 'Æø' } })
    history.pushUndoAction(action)
    action.lineSnapshot.corrected_text = 'changed'
    expect(history.peekUndoAction().lineSnapshot.corrected_text).toBe('Æø')
    expect(history.undoLabel.value).toBe('Undo line deletion')
  })

  it.each([['text', 'Undo text edit'], ['reorder', 'Undo line reorder'], ['delete', 'Undo line deletion']])(
    'describes %s actions', (type, label) => {
      const history = useReviewHistory()
      history.pushUndoAction({ type })
      expect(history.undoLabel.value).toBe(label)
      expect(history.canUndo.value).toBe(true)
    },
  )

  it('retains the latest 100 actions in LIFO order and clears errors', () => {
    const history = useReviewHistory()
    for (let id = 0; id < 105; id++) history.pushUndoAction({ type: 'text', id })
    expect(history.undoStack.value).toHaveLength(100)
    expect(history.undoStack.value[0].id).toBe(5)
    expect(history.popUndoAction().id).toBe(104)
    history.setUndoError('failed')
    history.clearUndoHistory()
    expect(history.canUndo.value).toBe(false)
    expect(history.undoErrorMessage.value).toBe('')
  })
})
