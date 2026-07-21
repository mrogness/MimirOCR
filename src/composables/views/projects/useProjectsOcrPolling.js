export function useProjectsOcrPolling({
  backendFetch,
  project,
  reloadProject,
  state,
  timing,
  persistence,
  onRecoveredRunNotice,
}) {
  let pollTimer = null

  function asUserMessage(error, fallback) {
    if (error instanceof TypeError) {
      return `${fallback} The backend may still be starting or temporarily busy.`
    }
    return String(error)
  }

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

  function asNonNegativeInt(value, fallback = 0) {
    const n = Number.parseInt(value, 10)
    if (!Number.isFinite(n) || n < 0) {
      return fallback
    }
    return n
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function isRecoverableRunningPhase(phase) {
    return phase === 'running' || phase === 'queued' || phase === 'preparing'
  }

  async function pollJob(jobId) {
    const response = await backendFetch(`/ocr/jobs/${jobId}`, {}, { retries: 2 })
    if (!response.ok) {
      throw new Error(`Unable to fetch OCR job (${response.status})`)
    }

    const data = await response.json()
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
      return
    }

    if (data.status === 'succeeded') {
      stopPolling()
      state.processingEndMs.value = Date.now()
      timing.stopElapsedTimer()
      persistence.clearPersistedActiveJob()
      state.uploadMessage.value = 'OCR processing complete.'
      await reloadProject()
    }
  }

  function startPolling(jobId) {
    stopPolling()
    pollTimer = setInterval(async () => {
      try {
        await pollJob(jobId)
      } catch (error) {
        stopPolling()
        state.uploadError.value = asUserMessage(error, 'Lost connection while polling OCR status.')
      }
    }, 1200)
  }

  async function resumeLatestJobIfActive() {
    if (!project.value) {
      return
    }

    const persisted = persistence.readPersistedActiveJob()
    if (persisted?.jobId) {
      state.currentJobId.value = persisted.jobId
      if (persisted.startedAtMs) {
        state.processingStartMs.value = persisted.startedAtMs
        state.processingEndMs.value = null
        timing.startElapsedTimer()
      }

      try {
        await pollJob(persisted.jobId)
        const shouldShowNotice = state.currentJobId.value !== persisted.jobId
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
      const shouldShowNotice = state.currentJobId.value !== latestJob.job_id
      if (shouldShowNotice) {
        onRecoveredRunNotice('Reconnected to in-progress OCR run.')
      }
      startPolling(latestJob.job_id)
    } catch (_error) {
      // Keep current UI state if listing jobs fails.
    }
  }

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
