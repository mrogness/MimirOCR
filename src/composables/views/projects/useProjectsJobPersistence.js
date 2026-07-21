export function useProjectsJobPersistence({ project }) {
  function getActiveJobStorageKey(id) {
    return `mimir:active-ocr-job:${id}`
  }

  function persistActiveJob(jobId, startedAtMs = null) {
    if (!project.value?.id || !jobId) {
      return
    }

    const key = getActiveJobStorageKey(project.value.id)
    const payload = {
      jobId,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
      savedAtMs: Date.now(),
    }

    localStorage.setItem(key, JSON.stringify(payload))
  }

  function clearPersistedActiveJob() {
    if (!project.value?.id) {
      return
    }

    localStorage.removeItem(getActiveJobStorageKey(project.value.id))
  }

  function readPersistedActiveJob() {
    if (!project.value?.id) {
      return null
    }

    const raw = localStorage.getItem(getActiveJobStorageKey(project.value.id))
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed.jobId !== 'string' || parsed.jobId.length === 0) {
        return null
      }

      return {
        jobId: parsed.jobId,
        startedAtMs: Number.isFinite(parsed.startedAtMs) ? parsed.startedAtMs : null,
      }
    } catch (_error) {
      return null
    }
  }

  return {
    persistActiveJob,
    clearPersistedActiveJob,
    readPersistedActiveJob,
  }
}
