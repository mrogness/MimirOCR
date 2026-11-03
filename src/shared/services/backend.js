/**
 * @file Resolve the Tauri-managed backend URL, retry transport failures, and coordinate
 * runtime restarts. Connection generations prevent stale startup requests from repopulating
 * the cache.
 */
import { invoke } from '@tauri-apps/api/core'

let cachedBackendUrl = ''
let cachedBackendStatus = null
let connectionPromise = null
let connectionGeneration = 0

/**
 * Extract an explicit port from a URL, returning an empty string for missing, invalid, or
 * default-port URLs.
 */
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

/**
 * Resolve after the requested delay in milliseconds between readiness probes.
 */
function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Normalize a finite numeric option to an integer no lower than the supplied minimum,
 * otherwise use the fallback.
 */
function positiveInteger(value, fallback, minimum = 1) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(minimum, Number.parseInt(value, 10))
}

/**
 * Time a no-cache HTTP probe with an AbortController deadline and return a diagnostics record
 * instead of throwing transport errors.
 */
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

/**
 * Race a Tauri command against a millisecond deadline and always clear the timer. Timing out
 * rejects the wrapper promise but does not cancel the native command.
 */
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

/**
 * Retry the backend runtime endpoint until a success response is seen or the configured
 * attempt limit is exhausted.
 */
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

/**
 * Reuse a cached URL or a shared pending connection lookup, otherwise ask Tauri for status
 * and optionally await HTTP readiness. Refuse to cache results from an invalidated connection
 * generation.
 */
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

/**
 * Read the host's startup-error detail, returning an empty string when the status command
 * itself is unavailable.
 * @returns {Promise<string>} Startup detail suitable for user-facing connection errors.
 */
export async function getBackendStartupIssue() {
  try {
    const status = await invokeWithTimeout('backend_status')
    return status?.startup_error || ''
  } catch (_err) {
    return ''
  }
}

/**
 * Resolve and cache the URL reported by Tauri, optionally waiting for readiness.
 * @param {object} [options={}] - Refresh and readiness polling options.
 * @returns {Promise<string>} The local backend base URL.
 */
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

/**
 * Fetch a local API path, refreshing the connection after a transport failure.
 * HTTP error responses are returned to the caller; only transport failures are retried.
 * @param {string} path - API path beginning with a slash.
 * @param {RequestInit} [init={}] - Fetch method, headers, body, and other options.
 * @param {object} [options={}] - Retry configuration.
 * @param {number} [options.retries=1] - Extra attempts after the initial request.
 * @returns {Promise<Response>} The response, including non-success HTTP statuses.
 */
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

/**
 * Collect frontend/host addresses, runtime paths, startup detail, uptime, and parallel
 * health/runtime HTTP probes. The returned projects field retains its historical name for
 * runtime-probe feedback.
 * @returns {Promise<object>} A diagnostics snapshot with probe outcomes and host-reported paths.
 */
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

/** Clear cached connection state and invalidate outstanding URL resolutions. */
export function invalidateBackendConnection() {
  connectionGeneration += 1
  cachedBackendUrl = ''
  cachedBackendStatus = null
  connectionPromise = null
}

/**
 * Detect the desktop host through its injected internals or tauri URL scheme, returning false
 * outside a browser window.
 */
export function isTauriRuntime() {
  if (typeof window === 'undefined') {
    return false
  }
  return Boolean(window.__TAURI_INTERNALS__) || window.location.protocol === 'tauri:'
}

/**
 * Ask the Tauri host to restart the backend with a prepared token and performance profile.
 * Reject outside the desktop runtime and bound the command wait to twenty seconds.
 * @param {string} profile - Requested backend performance profile.
 * @param {string} restartToken - Reservation token returned by the preparation endpoint.
 * @returns {Promise<*>} The host command's restart result.
 */
export async function restartBackend(profile, restartToken) {
  if (!isTauriRuntime()) {
    throw new Error('Automatic backend restart is available only inside the Tauri application.')
  }
  return invokeWithTimeout('restart_backend', { profile, restartToken }, 20000)
}

/**
 * Poll until the requested profile is active and the backend instance has changed.
 * @param {object} options - Expected profile, prior instance ID, and polling limits.
 * @returns {Promise<object>} The matching runtime snapshot.
 */
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
