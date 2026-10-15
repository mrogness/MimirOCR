import { ref } from 'vue'
import { useJobPersistence } from '../useJobPersistence'

describe('project-scoped OCR job persistence', () => {
  it('keeps separate jobs for separate projects and clears only the current one', () => {
    const project = ref({ id: 1 })
    const api = useJobPersistence({ project })
    api.persistActiveJob('first', 123)
    project.value = { id: 2 }
    expect(api.readPersistedActiveJob()).toBeNull()
    api.persistActiveJob('second', 456)
    api.clearPersistedActiveJob()
    project.value = { id: 1 }
    expect(api.readPersistedActiveJob()).toEqual({ jobId: 'first', startedAtMs: 123 })
  })

  it.each(['bad JSON', '{}', '{"jobId":""}', '{"jobId":3}'])('ignores malformed stored data: %s', raw => {
    localStorage.setItem('mimir:active-ocr-job:1', raw)
    expect(useJobPersistence({ project: ref({ id: 1 }) }).readPersistedActiveJob()).toBeNull()
  })

  it('does not create a key without a loaded project', () => {
    const api = useJobPersistence({ project: ref(null) })
    api.persistActiveJob('orphan')
    api.clearPersistedActiveJob()
    expect(api.readPersistedActiveJob()).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})
