import { onUnmounted, ref, watch } from 'vue'

const DIAGNOSTICS_REFRESH_MS = 5000

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

export function useBackendDiagnostics({ getBackendConnectionDiagnostics }) {
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

  let refreshInterval = null

  function applyDiagnostics(diagnostics) {
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
  }

  async function refreshConnectivityDiagnostics() {
    if (!getBackendConnectionDiagnostics || isRefreshingDiagnostics.value) {
      return
    }

    isRefreshingDiagnostics.value = true

    try {
      applyDiagnostics(await getBackendConnectionDiagnostics())
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
    if (refreshInterval) {
      return
    }

    refreshInterval = setInterval(() => {
      void refreshConnectivityDiagnostics()
    }, DIAGNOSTICS_REFRESH_MS)
  }

  function stopDiagnosticsPolling() {
    if (!refreshInterval) {
      return
    }

    clearInterval(refreshInterval)
    refreshInterval = null
  }

  function setDiagnosticsOpen(isOpen) {
    isDiagnosticsOpen.value = Boolean(isOpen)
  }

  watch(isDiagnosticsOpen, async (isOpen) => {
    if (isOpen) {
      await refreshConnectivityDiagnostics()
      startDiagnosticsPolling()
      return
    }

    stopDiagnosticsPolling()
  })

  onUnmounted(stopDiagnosticsPolling)

  return {
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
    setDiagnosticsOpen,
    refreshConnectivityDiagnostics,
  }
}
