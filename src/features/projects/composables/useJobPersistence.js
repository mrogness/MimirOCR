/**
 * @file Store and recover the active OCR job identifier and timing information across view
 * reloads.
 */
/**
 * Store and recover the current project's active OCR job in browser localStorage.
 * @param {object} dependencies - A reactive project ref supplying the persistent project ID.
 * @returns {object} Save, clear, and validated read helpers for active-job metadata.
 */
export function useJobPersistence({ project }) {
  /**
   * Build the project-specific localStorage key used for OCR recovery metadata.
   */
  function getActiveJobStorageKey(id) {
    return `mimir:active-ocr-job:${id}`
  }

  /**
   * Save a nonempty job ID, optional finite start time, and current save time for the loaded
   * project.
   */
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

  /**
   * Remove recovery metadata for the currently loaded project, doing nothing without a
   * project ID.
   */
  function clearPersistedActiveJob() {
    if (!project.value?.id) {
      return
    }

    localStorage.removeItem(getActiveJobStorageKey(project.value.id))
  }

  /**
   * Read and validate stored job metadata. Return null for an absent project, missing entry,
   * malformed JSON, or invalid job ID.
   */
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
