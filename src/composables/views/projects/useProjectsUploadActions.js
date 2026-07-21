import { ref, watch } from 'vue'

import { getProjectSettings, saveProjectSettings } from '../../../services/appSettings'

export function useProjectsUploadActions({
  backendFetch,
  getDefaultWorkerCount,
  getSavedWorkerCount,
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
  workerCount,
  startElapsedTimer,
  stopElapsedTimer,
  persistActiveJob,
  pollJob,
  startPolling,
  asUserMessage,
  loadProject,
}) {
  const pdfRef = ref(null)
  const isUploading = ref(false)

  const dpiInput = ref('300')
  const thresholdInput = ref('170')
  const strictTopToBottom = ref(false)
  const spreadMode = ref('split-spread')

  function toPositiveInteger(value, fallback) {
    const n = Number.parseInt(value, 10)
    if (!Number.isFinite(n) || n < 1) {
      return fallback
    }
    return n
  }

  function triggerFileBrowser() {
    if (pdfRef.value) {
      pdfRef.value.click()
    }
  }

  function loadProjectScopedSettings() {
    const projectId = project.value?.id
    const settings = getProjectSettings(projectId)
    dpiInput.value = String(settings.dpi)
    thresholdInput.value = String(settings.binarizationThreshold)
    spreadMode.value = settings.spreadMode
    strictTopToBottom.value = settings.strictTopToBottom === true
  }

  function persistProjectScopedSettings() {
    const projectId = project.value?.id
    if (!projectId) {
      return
    }

    const dpi = toPositiveInteger(dpiInput.value, 300)
    const threshold = toPositiveInteger(thresholdInput.value, 170)
    saveProjectSettings(projectId, {
      dpi,
      binarizationThreshold: threshold,
      spreadMode: spreadMode.value,
      strictTopToBottom: strictTopToBottom.value,
    })
  }

  watch(
    () => project.value?.id,
    () => {
      loadProjectScopedSettings()
    },
    { immediate: true }
  )

  watch([dpiInput, thresholdInput, spreadMode, strictTopToBottom], () => {
    persistProjectScopedSettings()
  })

  function onPdfSelected(event) {
    const file = event.target.files?.[0]
    selectedPdf.value = file || null
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

  async function uploadPdfAndStartOcr() {
    if (!project.value) {
      uploadError.value = 'Project must be loaded before uploading.'
      return
    }

    if (!selectedPdf.value) {
      uploadError.value = 'Choose a PDF before uploading.'
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
        throw new Error(`Upload failed (${uploadResponse.status})`)
      }

      const uploadData = await uploadResponse.json()
      const dpi = toPositiveInteger(dpiInput.value, 300)
      const threshold = toPositiveInteger(thresholdInput.value, 170)

      const startResponse = await backendFetch(`/ocr/projects/${project.value.id}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          upload_id: uploadData.upload_id,
          config: {
            dpi,
            binarization_threshold: threshold,
            strict_top_to_bottom: strictTopToBottom.value,
            num_workers: workerCount.value,
          },
        }),
      })

      if (!startResponse.ok) {
        throw new Error(`Unable to start OCR job (${startResponse.status})`)
      }

      const job = await startResponse.json()
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
    } finally {
      isUploading.value = false
    }
  }

  async function loadWorkerSettings() {
    let totalCores = navigator.hardwareConcurrency || 1

    try {
      const response = await backendFetch('/system/cpu')
      if (response.ok) {
        const data = await response.json()
        const parsed = Number.parseInt(data.total_cores, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          totalCores = parsed
        }
      }
    } catch (_error) {
      // Fall back to browser hardwareConcurrency if backend call fails.
    }

    const fallback = getDefaultWorkerCount(totalCores)
    workerCount.value = getSavedWorkerCount(fallback)
  }

  return {
    workerCount,
    pdfRef,
    isUploading,
    dpiInput,
    thresholdInput,
    strictTopToBottom,
    spreadMode,
    triggerFileBrowser,
    onPdfSelected,
    uploadPdfAndStartOcr,
    loadWorkerSettings,
  }
}
