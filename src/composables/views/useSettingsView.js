import { onMounted, onUnmounted, ref, watch } from 'vue'

export function useSettingsView({
  backendFetch,
  getBackendConnectionDiagnostics,
  getDefaultWorkerCount,
  getSavedWorkerCount,
  saveWorkerCount,
  brandThemeOptions,
  getSavedBrandTheme,
  saveBrandTheme,
  applyBrandTheme,
}) {
  const totalCores = ref(0)
  const recommendedWorkers = ref(1)
  const workerCountInput = ref('1')
  const brandThemeInput = ref('slate')
  const settingsMessage = ref('')
  const settingsError = ref('')

  const isLoadingSystem = ref(true)
  const isSaving = ref(false)
  const isRefreshingDiagnostics = ref(false)
  const isDiagnosticsOpen = ref(false)

  const frontendOrigin = ref('')
  const frontendPort = ref('')
  const backendStatusUrl = ref('')
  const backendBaseUrl = ref('')
  const backendPort = ref('')
  const backendMode = ref('')
  const backendRuntime = ref('')
  const appDataDir = ref('')
  const cacheDir = ref('')
  const tempDir = ref('')
  const dbPath = ref('')
  const uploadsDir = ref('')
  const outputDir = ref('')
  const sidecarSelectedPath = ref('')
  const sidecarCheckedPaths = ref([])
  const sidecarUptimeSummary = ref('')
  const backendStartupIssue = ref('')
  const healthProbeSummary = ref('')
  const projectsProbeSummary = ref('')
  let diagnosticsRefreshInterval = null
  let workerAutosaveTimeout = null
  let lastSavedWorkerCount = null

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return 'unknown'
    }

    const totalSeconds = Math.floor(seconds)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const remainingSeconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`
    }

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`
    }

    return `${remainingSeconds}s`
  }

  function summarizeProbe(probe) {
    if (!probe) {
      return 'not checked'
    }

    const base = `${probe.status} in ${probe.elapsedMs}ms`
    if (probe.ok) {
      return base
    }

    if (probe.noCorsReachable) {
      return `${base} (transport reachable via no-cors; likely CORS/response policy blocking)`
    }

    return probe.error ? `${base} (${probe.error})` : base
  }

  async function refreshConnectivityDiagnostics() {
    if (!getBackendConnectionDiagnostics) {
      return
    }

    if (isRefreshingDiagnostics.value) {
      return
    }

    isRefreshingDiagnostics.value = true
    try {
      const diagnostics = await getBackendConnectionDiagnostics()
      frontendOrigin.value = diagnostics.frontendOrigin || ''
      frontendPort.value = diagnostics.frontendPort || ''
      backendStatusUrl.value = diagnostics.backendStatusUrl || ''
      backendBaseUrl.value = diagnostics.backendBaseUrl || ''
      backendPort.value = diagnostics.backendPort || ''
      backendMode.value = diagnostics.backendMode || ''
      backendRuntime.value = diagnostics.backendRuntime || ''
      appDataDir.value = diagnostics.appDataDir || ''
      cacheDir.value = diagnostics.cacheDir || ''
      tempDir.value = diagnostics.tempDir || ''
      dbPath.value = diagnostics.dbPath || ''
      uploadsDir.value = diagnostics.uploadsDir || ''
      outputDir.value = diagnostics.outputDir || ''
      sidecarSelectedPath.value = diagnostics.sidecarSelectedPath || ''
      sidecarCheckedPaths.value = Array.isArray(diagnostics.sidecarCheckedPaths)
        ? diagnostics.sidecarCheckedPaths
        : []
      sidecarUptimeSummary.value = formatDuration(diagnostics.uptimeSeconds)
      backendStartupIssue.value = diagnostics.startupError || ''
      healthProbeSummary.value = summarizeProbe(diagnostics.health)
      projectsProbeSummary.value = summarizeProbe(diagnostics.projects)
    } catch (error) {
      backendStartupIssue.value = String(error)
      healthProbeSummary.value = 'error'
      projectsProbeSummary.value = 'error'
      sidecarUptimeSummary.value = 'unknown'
    } finally {
      isRefreshingDiagnostics.value = false
    }
  }

  function startDiagnosticsPolling() {
    if (diagnosticsRefreshInterval) {
      return
    }

    diagnosticsRefreshInterval = setInterval(() => {
      void refreshConnectivityDiagnostics()
    }, 5000)
  }

  function stopDiagnosticsPolling() {
    if (!diagnosticsRefreshInterval) {
      return
    }

    clearInterval(diagnosticsRefreshInterval)
    diagnosticsRefreshInterval = null
  }

  function setDiagnosticsOpen(isOpen) {
    isDiagnosticsOpen.value = Boolean(isOpen)
  }

  async function loadSystemDefaults() {
    isLoadingSystem.value = true
    settingsError.value = ''

    try {
      const response = await backendFetch('/system/cpu')
      if (!response.ok) {
        throw new Error(`Unable to load CPU info (${response.status})`)
      }

      const data = await response.json()
      const cores = Number.parseInt(data.total_cores, 10)
      totalCores.value = Number.isFinite(cores) && cores > 0 ? cores : 1

      const fallback = getDefaultWorkerCount(totalCores.value)
      recommendedWorkers.value = fallback

      const saved = getSavedWorkerCount(fallback)
      workerCountInput.value = String(saved)
      lastSavedWorkerCount = saved
      brandThemeInput.value = getSavedBrandTheme()
      applyBrandTheme(brandThemeInput.value)
    } catch (error) {
      const fallbackCores = navigator.hardwareConcurrency || 1
      totalCores.value = fallbackCores
      recommendedWorkers.value = getDefaultWorkerCount(fallbackCores)
      const saved = getSavedWorkerCount(recommendedWorkers.value)
      workerCountInput.value = String(saved)
      lastSavedWorkerCount = saved
      brandThemeInput.value = getSavedBrandTheme()
      applyBrandTheme(brandThemeInput.value)
      settingsError.value = String(error)
    } finally {
      isLoadingSystem.value = false
    }
  }

  async function persistWorkerCount() {
    isSaving.value = true
    settingsError.value = ''

    try {
      const saved = saveWorkerCount(workerCountInput.value)
      workerCountInput.value = String(saved)
      lastSavedWorkerCount = saved
    } catch (error) {
      settingsError.value = String(error)
    } finally {
      isSaving.value = false
    }
  }

  function scheduleWorkerCountSave() {
    if (isLoadingSystem.value) {
      return
    }

    const parsed = Number.parseInt(workerCountInput.value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      return
    }

    if (lastSavedWorkerCount === parsed) {
      return
    }

    if (workerAutosaveTimeout) {
      clearTimeout(workerAutosaveTimeout)
    }

    workerAutosaveTimeout = setTimeout(() => {
      void persistWorkerCount()
    }, 250)
  }

  function previewBrandTheme() {
    settingsError.value = ''
    try {
      brandThemeInput.value = saveBrandTheme(brandThemeInput.value)
    } catch (error) {
      settingsError.value = String(error)
      brandThemeInput.value = applyBrandTheme(getSavedBrandTheme())
    }
  }

  function useRecommendedValue() {
    workerCountInput.value = String(recommendedWorkers.value)
  }

  onMounted(async () => {
    await loadSystemDefaults()
  })

  watch(isDiagnosticsOpen, async (isOpen) => {
    if (isOpen) {
      await refreshConnectivityDiagnostics()
      startDiagnosticsPolling()
      return
    }

    stopDiagnosticsPolling()
  })

  watch(workerCountInput, () => {
    scheduleWorkerCountSave()
  })

  onUnmounted(() => {
    stopDiagnosticsPolling()
    if (workerAutosaveTimeout) {
      clearTimeout(workerAutosaveTimeout)
      workerAutosaveTimeout = null
    }
  })

  return {
    totalCores,
    recommendedWorkers,
    workerCountInput,
    brandThemeInput,
    brandThemeOptions,
    settingsMessage,
    settingsError,
    isLoadingSystem,
    isSaving,
    isRefreshingDiagnostics,
    isDiagnosticsOpen,
    frontendOrigin,
    frontendPort,
    backendStatusUrl,
    backendBaseUrl,
    backendPort,
    backendMode,
    backendRuntime,
    appDataDir,
    cacheDir,
    tempDir,
    dbPath,
    uploadsDir,
    outputDir,
    sidecarSelectedPath,
    sidecarCheckedPaths,
    sidecarUptimeSummary,
    backendStartupIssue,
    healthProbeSummary,
    projectsProbeSummary,
    useRecommendedValue,
    previewBrandTheme,
    setDiagnosticsOpen,
    refreshConnectivityDiagnostics,
  }
}
