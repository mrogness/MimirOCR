/**
 * @file Poll OCR job progress, recover active runs after reload, and synchronize persisted
 * job state. Generation checks discard responses from obsolete polling sessions.
 */
/**
 * Connect an OCR job's status to project progress refs and persisted recovery data.
 * @param {object} dependencies - Backend access, project/state refs, timing and persistence helpers.
 * @returns {object} Polling, active-job recovery, visibility refresh, and cleanup functions.
 */
export function useOcrPolling({
  backendFetch,
  project,
  reloadProject,
  state,
  timing,
  persistence,
  onRecoveredRunNotice,
}) {
  let pollTimer = null
  let pollingGeneration = 0

  /**
   * Add backend-startup guidance for transport TypeErrors; otherwise return the error's
   * string representation.
   */
  function asUserMessage(error, fallback) {
    if (error instanceof TypeError) {
      return `${fallback} The backend may still be starting or temporarily busy.`
    }
    return String(error)
  }

  /**
   * Parse a nonempty job timestamp into epoch milliseconds, returning null when it cannot be
   * parsed.
   */
  function parseTimestampToMs(value) {
    if (!value) {
      return null
    }

    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) {
      return null
    }

    return parsed
  }

  /**
   * Parse a nonnegative page counter or retain the supplied fallback for unusable data.
   */
  function asNonNegativeInt(value, fallback = 0) {
    const n = Number.parseInt(value, 10)
    if (!Number.isFinite(n) || n < 0) {
      return fallback
    }
    return n
  }

  /** Stop interval polling and invalidate responses still in flight. */
  function stopPolling() {
    pollingGeneration += 1
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /**
   * Identify early active phases in which reconnecting to a run should display a recovery
   * notice.
   */
  function isRecoverableRunningPhase(phase) {
    return phase === 'running' || phase === 'queued' || phase === 'preparing'
  }

  /**
   * Fetch one job snapshot and update progress, counters, timing, and recovery metadata.
   * Ignore obsolete polling generations; stop timers and reload the project when the job
   * succeeds or fails.
   */
  async function pollJob(jobId) {
    const generation = pollingGeneration
    const response = await backendFetch(`/ocr/jobs/${jobId}`, {}, { retries: 2 })
    if (!response.ok) {
      throw new Error(`Unable to fetch OCR job (${response.status})`)
    }

    const data = await response.json()
    if (generation !== pollingGeneration) return null
    state.ocrPhase.value = data.phase || data.status || 'running'
    state.ocrProgress.value = typeof data.progress === 'number' ? data.progress : 0
    state.uploadMessage.value = data.message || ''
    state.totalPagesCounter.value = asNonNegativeInt(data.total_pages, state.totalPagesCounter.value)
    state.rasterizedPagesCounter.value = asNonNegativeInt(data.rasterized_pages, state.rasterizedPagesCounter.value)
    state.segmentedPagesCounter.value = asNonNegativeInt(data.segmented_pages, state.segmentedPagesCounter.value)
    state.ocrPagesCounter.value = asNonNegativeInt(data.ocr_pages, state.ocrPagesCounter.value)

    const startedAtMs = parseTimestampToMs(data.started_at) || parseTimestampToMs(data.created_at)
    if (startedAtMs && !state.processingStartMs.value) {
      state.processingStartMs.value = startedAtMs
      state.processingEndMs.value = null
      timing.startElapsedTimer()
    }

    if (data.status === 'running' || data.status === 'queued') {
      persistence.persistActiveJob(jobId, startedAtMs)
    }

    if (data.status === 'failed') {
      stopPolling()
      state.processingEndMs.value = Date.now()
      timing.stopElapsedTimer()
      persistence.clearPersistedActiveJob()
      state.uploadError.value = data.error || 'OCR job failed.'
      await reloadProject()
      return data
    }

    if (data.status === 'succeeded') {
      stopPolling()
      state.processingEndMs.value = Date.now()
      timing.stopElapsedTimer()
      persistence.clearPersistedActiveJob()
      state.uploadMessage.value = 'OCR processing complete.'
      await reloadProject()
    }
    return data
  }

  /** Start a fresh polling session, allowing at most one interval request at a time. */
  function startPolling(jobId) {
    stopPolling()
    const generation = pollingGeneration
    let requestPending = false
    pollTimer = setInterval(async () => {
      if (requestPending || generation !== pollingGeneration) return
      requestPending = true
      try {
        await pollJob(jobId)
      } catch (error) {
        if (generation !== pollingGeneration) return
        stopPolling()
        state.uploadError.value = asUserMessage(error, 'Lost connection while polling OCR status.')
      } finally {
        requestPending = false
      }
    }, 1200)
  }

  /**
   * Recover a stored job token first, then fall back to the project's newest retained job.
   * Restore timing and polling only for an active run and tolerate recovery lookup failures.
   */
  async function resumeLatestJobIfActive() {
    if (!project.value) {
      return
    }

    const persisted = persistence.readPersistedActiveJob()
    if (persisted?.jobId) {
      const previousJobId = state.currentJobId.value
      state.currentJobId.value = persisted.jobId
      if (persisted.startedAtMs) {
        state.processingStartMs.value = persisted.startedAtMs
        state.processingEndMs.value = null
        timing.startElapsedTimer()
      }

      try {
        const recoveredJob = await pollJob(persisted.jobId)
        if (!recoveredJob || ['succeeded', 'failed'].includes(recoveredJob.status)) return
        const shouldShowNotice = previousJobId !== persisted.jobId
        if (shouldShowNotice && isRecoverableRunningPhase(state.ocrPhase.value)) {
          onRecoveredRunNotice('Recovered active OCR run after reload.')
        }
        startPolling(persisted.jobId)
        return
      } catch (_error) {
        persistence.clearPersistedActiveJob()
      }
    }

    try {
      const response = await backendFetch(`/ocr/projects/${project.value.id}/jobs`)
      if (!response.ok) {
        return
      }

      const data = await response.json()
      const jobs = Array.isArray(data.jobs) ? data.jobs : []
      if (jobs.length === 0) {
        return
      }

      const latestJob = jobs[0]
      if (!latestJob || latestJob.status === 'failed' || latestJob.status === 'succeeded') {
        return
      }

      const previousJobId = state.currentJobId.value
      state.currentJobId.value = latestJob.job_id
      state.ocrPhase.value = latestJob.phase || latestJob.status || 'running'
      state.ocrProgress.value = typeof latestJob.progress === 'number' ? latestJob.progress : 0
      state.uploadMessage.value = latestJob.message || state.uploadMessage.value
      state.totalPagesCounter.value = asNonNegativeInt(latestJob.total_pages, state.totalPagesCounter.value)
      state.rasterizedPagesCounter.value = asNonNegativeInt(latestJob.rasterized_pages, state.rasterizedPagesCounter.value)
      state.segmentedPagesCounter.value = asNonNegativeInt(latestJob.segmented_pages, state.segmentedPagesCounter.value)
      state.ocrPagesCounter.value = asNonNegativeInt(latestJob.ocr_pages, state.ocrPagesCounter.value)

      const startedAtMs = parseTimestampToMs(latestJob.started_at) || parseTimestampToMs(latestJob.created_at)
      if (startedAtMs) {
        state.processingStartMs.value = startedAtMs
        state.processingEndMs.value = null
        timing.startElapsedTimer()
      }

      persistence.persistActiveJob(latestJob.job_id, startedAtMs)
      const shouldShowNotice = previousJobId !== latestJob.job_id
      if (shouldShowNotice) {
        onRecoveredRunNotice('Reconnected to in-progress OCR run.')
      }
      startPolling(latestJob.job_id)
    } catch (_error) {
      // Keep current UI state if listing jobs fails.
    }
  }

  /**
   * Refresh current job state or attempt recovery when the document becomes visible, allowing
   * normal interval polling to handle repeated failures.
   */
  async function refreshRunStateOnVisibility() {
    if (document.visibilityState !== 'visible') {
      return
    }

    state.processingNowMs.value = Date.now()
    if (state.currentJobId.value) {
      try {
        await pollJob(state.currentJobId.value)
      } catch (_error) {
        // Normal polling handles repeated failures.
      }
    } else {
      await resumeLatestJobIfActive()
    }
  }

  /**
   * Initialize terminal/running progress and persisted elapsed duration from project
   * metadata.
   */
  function applyProjectStatus(projectData) {
    state.persistedElapsedSeconds.value = Number.isFinite(projectData?.ocr_last_elapsed_seconds)
      ? projectData.ocr_last_elapsed_seconds
      : null

    if (projectData?.ocr_last_status === 'succeeded') {
      state.ocrPhase.value = 'completed'
      state.ocrProgress.value = 100
    } else if (projectData?.ocr_last_status === 'failed') {
      state.ocrPhase.value = 'failed'
      state.ocrProgress.value = 100
    } else if (projectData?.ocr_last_status === 'running') {
      state.ocrPhase.value = 'running'
      state.ocrProgress.value = 0
    }
  }

  /**
   * Stop the interval and invalidate outstanding responses during workflow teardown.
   */
  function cleanupPolling() {
    stopPolling()
  }

  return {
    asUserMessage,
    stopPolling,
    pollJob,
    startPolling,
    resumeLatestJobIfActive,
    refreshRunStateOnVisibility,
    applyProjectStatus,
    cleanupPolling,
  }
}
