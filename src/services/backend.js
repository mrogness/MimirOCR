import { invoke } from '@tauri-apps/api/core'

let cachedBackendUrl = ''
let cachedBackendStatus = null
let connectionPromise = null
let connectionGeneration = 0

function parsePortFromUrl(rawUrl) {
  if (!rawUrl) {
    return ''
  }

  try {
    const parsed = new URL(rawUrl)
    return parsed.port || ''
  } catch (_err) {
    return ''
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function positiveInteger(value, fallback, minimum = 1) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(minimum, Number.parseInt(value, 10))
}

async function probeEndpoint(url, path, timeoutMs = 2500) {
  if (!url) {
    return {
      ok: false,
      status: 'n/a',
      elapsedMs: 0,
      error: 'No backend URL available',
    }
  }

  const start = performance.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${url}${path}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: String(response.status),
      elapsedMs: Math.round(performance.now() - start),
      error: '',
      noCorsReachable: false,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      elapsedMs: Math.round(performance.now() - start),
      error: String(error),
      noCorsReachable: false,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function invokeWithTimeout(command, args = {}, timeoutMs = 1800) {
  let timeoutId = null
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out waiting for Tauri command '${command}'`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([invoke(command, args), timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function waitForRuntimeEndpoint(url, attempts, delayMs) {
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/system/runtime`, {
        cache: 'no-store',
      })
      if (response.ok) {
        return
      }
      lastError = new Error(`Backend runtime check failed (${response.status})`)
    } catch (error) {
      lastError = error
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs)
    }
  }

  const detail = lastError ? ` Last error: ${lastError}` : ''
  throw new Error(`Backend runtime endpoint did not become ready.${detail}`)
}

async function resolveBackendConnection({
  forceRefresh = false,
  waitUntilReady = true,
  readinessAttempts = 40,
  readinessDelayMs = 250,
} = {}) {
  if (!forceRefresh && cachedBackendUrl) {
    return {
      baseUrl: cachedBackendUrl,
      status: cachedBackendStatus,
    }
  }

  if (!forceRefresh && connectionPromise) {
    return connectionPromise
  }

  const generation = connectionGeneration
  const pending = (async () => {
    const status = await invokeWithTimeout('backend_status')
    const url = typeof status?.url === 'string' ? status.url.trim() : ''

    if (!url) {
      const detail = status?.startup_error ? ` Details: ${status.startup_error}` : ''
      throw new Error(`Backend URL is unavailable.${detail}`)
    }

    if (waitUntilReady) {
      await waitForRuntimeEndpoint(
        url,
        positiveInteger(readinessAttempts, 40),
        positiveInteger(readinessDelayMs, 250, 50),
      )
    }

    if (generation !== connectionGeneration) {
      throw new Error('Backend connection changed while it was being resolved.')
    }

    cachedBackendUrl = url
    cachedBackendStatus = status
    return {
      baseUrl: url,
      status,
    }
  })()

  connectionPromise = pending

  try {
    return await pending
  } finally {
    if (connectionPromise === pending) {
      connectionPromise = null
    }
  }
}

export async function getBackendStartupIssue() {
  try {
    const status = await invokeWithTimeout('backend_status')
    return status?.startup_error || ''
  } catch (_err) {
    return ''
  }
}

export async function getBackendBaseUrl(options = {}) {
  const readinessAttempts = options.readinessAttempts ?? options.healthAttempts
  const readinessDelayMs = options.readinessDelayMs ?? options.healthDelayMs
  const connection = await resolveBackendConnection({
    forceRefresh: options.forceRefresh === true,
    waitUntilReady: options.waitUntilReady !== false,
    readinessAttempts: positiveInteger(readinessAttempts, 40),
    readinessDelayMs: positiveInteger(readinessDelayMs, 250, 50),
  })
  return connection.baseUrl
}

export async function backendFetch(path, init = {}, options = {}) {
  const retries = positiveInteger(options.retries, 1, 0)
  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const backendBaseUrl = await getBackendBaseUrl()
      return await fetch(`${backendBaseUrl}${path}`, init)
    } catch (error) {
      lastError = error
      const isTransportFailure = error instanceof TypeError

      if (!isTransportFailure || attempt >= retries) {
        if (isTransportFailure) {
          const startupIssue = await getBackendStartupIssue()
          const detail = startupIssue ? ` Startup issue: ${startupIssue}` : ''
          throw new Error(`Unable to reach backend endpoint '${path}'.${detail}`)
        }
        throw error
      }

      invalidateBackendConnection()
    }
  }

  throw lastError || new Error('Backend request failed')
}

export async function getBackendConnectionDiagnostics() {
  const frontendOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const frontendPort = parsePortFromUrl(frontendOrigin)

  let status = null
  let startupError = ''

  try {
    status = await invokeWithTimeout('backend_status', {}, 1800)
  } catch (error) {
    startupError = String(error)
  }

  const backendStatusUrl = typeof status?.url === 'string' ? status.url : ''
  const backendBaseUrl = cachedBackendUrl || backendStatusUrl
  const chosenBackendUrl = backendBaseUrl || backendStatusUrl
  const backendPort = parsePortFromUrl(chosenBackendUrl)

  if (!startupError) {
    startupError = status?.startup_error || ''
  }

  const [health, projects] = await Promise.all([
    probeEndpoint(chosenBackendUrl, '/health'),
    probeEndpoint(chosenBackendUrl, '/system/runtime'),
  ])

  return {
    frontendOrigin,
    frontendPort,
    backendStatusUrl,
    backendBaseUrl,
    chosenBackendUrl,
    backendPort,
    startupError,
    backendMode: status?.backend_mode || '',
    backendRuntime: status?.backend_runtime || '',
    sidecarSelectedPath: status?.sidecar_selected_path || '',
    sidecarCheckedPaths: Array.isArray(status?.sidecar_checked_paths)
      ? status.sidecar_checked_paths
      : [],
    sidecarLogPath: status?.sidecar_log_path || '',
    appDataDir: status?.app_data_dir || '',
    cacheDir: status?.cache_dir || '',
    tempDir: status?.temp_dir || '',
    dbPath: status?.db_path || '',
    uploadsDir: status?.uploads_dir || '',
    outputDir: status?.output_dir || '',
    uptimeSeconds:
      status?.uptime_seconds != null &&
      Number.isFinite(Number(status.uptime_seconds))
        ? Number(status.uptime_seconds)
        : null,
    health,
    // Retain the existing diagnostics field name for UI compatibility.
    projects,
  }
}

export function invalidateBackendConnection() {
  connectionGeneration += 1
  cachedBackendUrl = ''
  cachedBackendStatus = null
  connectionPromise = null
}

export function isTauriRuntime() {
  if (typeof window === 'undefined') {
    return false
  }
  return Boolean(window.__TAURI_INTERNALS__) || window.location.protocol === 'tauri:'
}

export async function restartBackend(profile, restartToken) {
  if (!isTauriRuntime()) {
    throw new Error('Automatic backend restart is available only inside the Tauri application.')
  }
  return invokeWithTimeout('restart_backend', { profile, restartToken }, 20000)
}

export async function waitForBackendRuntime({
  expectedProfile,
  previousInstanceId = '',
  attempts = 80,
  delayMs = 250,
}) {
  invalidateBackendConnection()
  let lastError = null
  let baseUrl = ''

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!baseUrl) {
        baseUrl = await getBackendBaseUrl({
          forceRefresh: true,
          waitUntilReady: false,
        })
      }

      const response = await fetch(`${baseUrl}/system/runtime`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`Backend runtime check failed (${response.status})`)
      }

      const runtime = await response.json()
      const instanceChanged =
        !previousInstanceId || runtime.backend_instance_id !== previousInstanceId
      const profileMatches = runtime.performance?.profile === expectedProfile

      if (instanceChanged && profileMatches) {
        return runtime
      }
    } catch (error) {
      lastError = error
    }

    await sleep(delayMs)
  }

  const startupIssue = await getBackendStartupIssue()
  const startupDetail = startupIssue ? ` Startup issue: ${startupIssue}` : ''
  const detail = lastError ? ` Last error: ${lastError}` : ''
  throw new Error(
    `The backend did not reconnect with the ${expectedProfile} profile.${detail}${startupDetail}`,
  )
}
