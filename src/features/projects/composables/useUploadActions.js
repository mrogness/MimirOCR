/**
 * @file Validate and upload the selected PDF, construct OCR job requests, and update
 * submission feedback.
 */
import { ref, watch } from 'vue'

import { getProjectSettings, saveProjectSettings } from '../../../shared/services/appSettings'

/**
 * Manage per-project OCR settings, source-DPI analysis, PDF upload, and job admission.
 * @param {object} dependencies - Project/run refs, backend access, timer/polling helpers, and runtime refresh callbacks.
 * @returns {object} Upload/analysis feedback, settings refs, PDF selection, and submit handlers.
 */
export function useUploadActions({
  backendFetch,
  project,
  selectedPdf,
  uploadError,
  uploadMessage,
  ocrPhase,
  ocrProgress,
  currentJobId,
  totalPagesCounter,
  rasterizedPagesCounter,
  segmentedPagesCounter,
  ocrPagesCounter,
  persistedElapsedSeconds,
  processingStartMs,
  processingEndMs,
  activeJob,
  refreshBackendRuntime,
  startElapsedTimer,
  stopElapsedTimer,
  persistActiveJob,
  pollJob,
  startPolling,
  asUserMessage,
  loadProject,
}) {
  const isUploading = ref(false)
  const dpiInput = ref('300')
  const thresholdInput = ref('170')
  const strictTopToBottom = ref(false)
  const ijDisambiguation = ref(true)
  const spreadMode = ref('split-spread')

  const isAnalyzingDpi = ref(false)
  const dpiAnalysis = ref(null)
  const dpiAnalysisError = ref('')

  let dpiAnalysisRequestId = 0

  /**
   * Parse a positive integer setting or return the caller's default.
   */
  function toPositiveInteger(value, fallback) {
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) && n >= 1 ? n : fallback
  }

  /**
   * Load the selected project's persisted ingestion, spread, reading-order, and I/J settings
   * into controls.
   */
  function loadProjectScopedSettings() {
    const settings = getProjectSettings(project.value?.id)
    dpiInput.value = String(settings.dpi)
    thresholdInput.value = String(settings.binarizationThreshold)
    spreadMode.value = settings.spreadMode
    strictTopToBottom.value = settings.strictTopToBottom === true
    ijDisambiguation.value = settings.ijDisambiguation !== false
  }

  /**
   * Normalize current controls and save settings only when a persistent project ID is
   * available.
   */
  function persistProjectScopedSettings() {
    if (!project.value?.id) return
    saveProjectSettings(project.value.id, {
      dpi: toPositiveInteger(dpiInput.value, 300),
      binarizationThreshold: toPositiveInteger(thresholdInput.value, 170),
      spreadMode: spreadMode.value,
      strictTopToBottom: strictTopToBottom.value,
      ijDisambiguation: ijDisambiguation.value,
    })
  }

  watch(() => project.value?.id, loadProjectScopedSettings, { immediate: true })
  watch(
    [dpiInput, thresholdInput, spreadMode, strictTopToBottom, ijDisambiguation],
    persistProjectScopedSettings,
  )
  watch(selectedPdf, (file) => {
    void analyzeSelectedPdf(file)
  })

  /**
   * Capture the first selected File, clear the file input for reselection, and reset stale
   * run feedback when no OCR run is active.
   */
  function onPdfSelected(event) {
    selectedPdf.value = event.target.files?.[0] || null
    event.target.value = ''
    const isActiveRun = Boolean(currentJobId.value) && !['completed', 'failed', 'idle'].includes(ocrPhase.value)
    if (!isActiveRun && selectedPdf.value) {
      stopElapsedTimer()
      processingStartMs.value = null
      processingEndMs.value = null
      persistedElapsedSeconds.value = null
      ocrPhase.value = 'idle'
      ocrProgress.value = 0
      currentJobId.value = ''
      totalPagesCounter.value = 0
      rasterizedPagesCounter.value = 0
      segmentedPagesCounter.value = 0
      ocrPagesCounter.value = 0
      uploadMessage.value = ''
      uploadError.value = ''
    }
  }

  /**
   * Read an API error detail/message when possible, otherwise include the HTTP status in a
   * fallback message.
   */
  async function errorFromResponse(response, fallback) {
    const body = await response.json().catch(() => ({}))
    return body.detail?.message || body.detail || `${fallback} (${response.status})`
  }

  /**
   * Request a scan-DPI estimate for the selected file and apply a validated recommendation.
   * Ignore responses for superseded file selections and preserve current-request error/busy
   * state.
   */
  async function analyzeSelectedPdf(file) {
    const requestId = ++dpiAnalysisRequestId

    dpiAnalysis.value = null
    dpiAnalysisError.value = ''

    if (!file) {
      isAnalyzingDpi.value = false
      return
    }

    isAnalyzingDpi.value = true

    try {
      const form = new FormData()
      form.append('file', file)

      const response = await backendFetch('/files/analyze-pdf-dpi', {
        method: 'POST',
        body: form,
      })

      if (!response.ok) {
        throw new Error(await errorFromResponse(response, 'Unable to analyze PDF resolution'))
      }

      const analysis = await response.json()

      // Ignore a response for a PDF that is no longer selected.
      if (requestId !== dpiAnalysisRequestId || selectedPdf.value !== file) {
        return
      }

      // Pydantic validates the backend response, but retain a small
      // client-side guard before putting the value into the input.
      if (!Number.isInteger(analysis.recommended_dpi) || analysis.recommended_dpi < 1) {
        throw new Error('The backend returned an invalid DPI recommendation.')
      }

      dpiAnalysis.value = analysis
      dpiInput.value = String(analysis.recommended_dpi)
    } catch (error) {
      if (requestId !== dpiAnalysisRequestId) {
        return
      }

      dpiAnalysisError.value = asUserMessage(
        error,
        'Unable to analyze PDF resolution.',
      )
    } finally {
      if (requestId === dpiAnalysisRequestId) {
        isAnalyzingDpi.value = false
      }
    }
  }

  /**
   * Validate project/file selection and runtime availability, upload the PDF, and submit its
   * token with OCR overrides. Initialize timing, persistence, and polling on success; expose
   * failures and refresh shared runtime state.
   */
  async function uploadPdfAndStartOcr() {
    if (!project.value) {
      uploadError.value = 'Project must be loaded before uploading.'
      return
    }
    if (!selectedPdf.value) {
      uploadError.value = 'Choose a PDF before uploading.'
      return
    }

    await refreshBackendRuntime().catch(() => { })
    if (activeJob.value) {
      uploadError.value = 'Another OCR job is already running. Only one job may run at a time.'
      return
    }

    uploadError.value = ''
    uploadMessage.value = ''
    isUploading.value = true
    ocrProgress.value = 0
    ocrPhase.value = 'queued'
    currentJobId.value = ''
    persistedElapsedSeconds.value = null
    processingStartMs.value = Date.now()
    processingEndMs.value = null
    startElapsedTimer()

    try {
      const form = new FormData()
      form.append('file', selectedPdf.value)
      const uploadResponse = await backendFetch(`/files/projects/${project.value.id}/upload-pdf`, {
        method: 'POST',
        body: form,
      })
      if (!uploadResponse.ok) {
        throw new Error(await errorFromResponse(uploadResponse, 'Upload failed'))
      }

      const uploadData = await uploadResponse.json()
      const startResponse = await backendFetch(`/ocr/projects/${project.value.id}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_id: uploadData.upload_id,
          config: {
            dpi: toPositiveInteger(dpiInput.value, 300),
            binarization_threshold: toPositiveInteger(thresholdInput.value, 170),
            strict_top_to_bottom: strictTopToBottom.value,
            disambiguate_ij: ijDisambiguation.value,
          },
        }),
      })
      if (!startResponse.ok) {
        throw new Error(await errorFromResponse(startResponse, 'Unable to start OCR job'))
      }

      const job = await startResponse.json()
      await refreshBackendRuntime().catch(() => { })
      await loadProject()
      currentJobId.value = job.job_id
      persistActiveJob(job.job_id, Date.now())
      uploadMessage.value = `Uploaded ${uploadData.filename}. OCR job started.`
      await pollJob(job.job_id)
      startPolling(job.job_id)
    } catch (error) {
      processingEndMs.value = Date.now()
      stopElapsedTimer()
      uploadError.value = asUserMessage(error, 'Upload or OCR job start failed.')
      ocrPhase.value = 'idle'
      ocrProgress.value = 0
      await refreshBackendRuntime().catch(() => { })
    } finally {
      isUploading.value = false
    }
  }

  return {
    isUploading,
    isAnalyzingDpi,
    dpiAnalysis,
    dpiAnalysisError,
    dpiInput,
    thresholdInput,
    strictTopToBottom,
    ijDisambiguation,
    spreadMode,
    onPdfSelected,
    uploadPdfAndStartOcr,
  }
}
