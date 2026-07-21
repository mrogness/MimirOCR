import { ref } from 'vue'
import { useProjectsElapsedTimer } from './useProjectsElapsedTimer'
import { useProjectsJobPersistence } from './useProjectsJobPersistence'
import { useProjectsOcrPolling } from './useProjectsOcrPolling'

export function useProjectsRuntime({ backendFetch, project, reloadProject }) {
  const selectedPdf = ref(null)
  const uploadError = ref('')
  const uploadMessage = ref('')

  const ocrPhase = ref('idle')
  const ocrProgress = ref(0)
  const currentJobId = ref('')
  const recoveredRunNotice = ref('')
  const totalPagesCounter = ref(0)
  const rasterizedPagesCounter = ref(0)
  const segmentedPagesCounter = ref(0)
  const ocrPagesCounter = ref(0)
  const processingStartMs = ref(null)
  const processingEndMs = ref(null)
  const processingNowMs = ref(null)
  const persistedElapsedSeconds = ref(null)

  let recoveredNoticeTimer = null

  const persistence = useProjectsJobPersistence({ project })
  const timing = useProjectsElapsedTimer({
    processingStartMs,
    processingEndMs,
    processingNowMs,
    persistedElapsedSeconds,
  })

  function showRecoveredRunNotice(message) {
    recoveredRunNotice.value = message
    if (recoveredNoticeTimer) {
      clearTimeout(recoveredNoticeTimer)
    }
    recoveredNoticeTimer = setTimeout(() => {
      recoveredRunNotice.value = ''
      recoveredNoticeTimer = null
    }, 6000)
  }

  const polling = useProjectsOcrPolling({
    backendFetch,
    project,
    reloadProject,
    state: {
      uploadError,
      uploadMessage,
      ocrPhase,
      ocrProgress,
      currentJobId,
      totalPagesCounter,
      rasterizedPagesCounter,
      segmentedPagesCounter,
      ocrPagesCounter,
      processingStartMs,
      processingEndMs,
      processingNowMs,
      persistedElapsedSeconds,
    },
    timing,
    persistence,
    onRecoveredRunNotice: showRecoveredRunNotice,
  })

  function resetWorkspaceState() {
    persistence.clearPersistedActiveJob()
    recoveredRunNotice.value = ''
    if (recoveredNoticeTimer) {
      clearTimeout(recoveredNoticeTimer)
      recoveredNoticeTimer = null
    }
    polling.stopPolling()
    timing.stopElapsedTimer()
    selectedPdf.value = null
    uploadError.value = ''
    uploadMessage.value = ''
    ocrPhase.value = 'idle'
    ocrProgress.value = 0
    currentJobId.value = ''
    totalPagesCounter.value = 0
    rasterizedPagesCounter.value = 0
    segmentedPagesCounter.value = 0
    ocrPagesCounter.value = 0
    processingStartMs.value = null
    processingEndMs.value = null
    processingNowMs.value = null
    persistedElapsedSeconds.value = null
  }

  function cleanupRuntime() {
    if (recoveredNoticeTimer) {
      clearTimeout(recoveredNoticeTimer)
      recoveredNoticeTimer = null
    }
    polling.cleanupPolling()
    timing.cleanupElapsedTimer()
  }

  return {
    selectedPdf,
    uploadError,
    uploadMessage,
    ocrPhase,
    ocrProgress,
    currentJobId,
    recoveredRunNotice,
    totalPagesCounter,
    rasterizedPagesCounter,
    segmentedPagesCounter,
    ocrPagesCounter,
    persistedElapsedSeconds,
    processingStartMs,
    processingEndMs,
    elapsedDisplay: timing.elapsedDisplay,
    resetWorkspaceState,
    refreshRunStateOnVisibility: polling.refreshRunStateOnVisibility,
    applyProjectStatus: polling.applyProjectStatus,
    persistActiveJob: persistence.persistActiveJob,
    resumeLatestJobIfActive: polling.resumeLatestJobIfActive,
    pollJob: polling.pollJob,
    startPolling: polling.startPolling,
    startElapsedTimer: timing.startElapsedTimer,
    stopElapsedTimer: timing.stopElapsedTimer,
    asUserMessage: polling.asUserMessage,
    cleanupRuntime,
  }
}
