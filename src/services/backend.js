import { invoke } from '@tauri-apps/api/core'

let cachedBackendUrl = ''

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

function alternateLoopbackUrl(rawUrl) {
  if (!rawUrl) {
    return ''
  }

  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost'
      return parsed.toString().replace(/\/$/, '')
    }

    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1'
      return parsed.toString().replace(/\/$/, '')
    }

    return ''
  } catch (_err) {
    return ''
  }
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
    const response = await fetch(`${url}${path}`, { signal: controller.signal })
    return {
      ok: response.ok,
      status: String(response.status),
      elapsedMs: Math.round(performance.now() - start),
      error: '',
      noCorsReachable: false,
    }
  } catch (error) {
    let noCorsReachable = false

    // If a normal CORS fetch fails with TypeError, check whether transport still
    // reaches localhost by using a no-cors request (opaque response expected).
    if (error instanceof TypeError) {
      const noCorsController = new AbortController()
      const noCorsTimeoutId = setTimeout(() => noCorsController.abort(), timeoutMs)
      try {
        await fetch(`${url}${path}`, {
          mode: 'no-cors',
          signal: noCorsController.signal,
        })
        noCorsReachable = true
      } catch (_noCorsError) {
        noCorsReachable = false
      } finally {
        clearTimeout(noCorsTimeoutId)
      }
    }

    return {
      ok: false,
      status: 'error',
      elapsedMs: Math.round(performance.now() - start),
      error: String(error),
      noCorsReachable,
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

async function waitForHealth(url, attempts = 40, delayMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) {
        return true
      }
    } catch (_err) {
      // Backend may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return false
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
  const allowUnhealthyUrl = options.allowUnhealthyUrl !== false
  let tauriStatusError = ''
  let statusLookupFailed = false

  try {
    const status = await invokeWithTimeout('backend_status')
    const url = status?.url
    const startupError = status?.startup_error

    if (typeof url === 'string' && url.length > 0) {
      cachedBackendUrl = url
      const healthy = await waitForHealth(url)
      if (healthy) {
        return url
      }

      const alternateUrl = alternateLoopbackUrl(url)
      if (alternateUrl) {
        const alternateHealthy = await waitForHealth(alternateUrl, 8, 200)
        if (alternateHealthy) {
          cachedBackendUrl = alternateUrl
          return alternateUrl
        }
      }

      if (allowUnhealthyUrl) {
        // If a URL was provided by Tauri, keep using it even if health is slow
        // under heavy OCR load. Endpoint-specific calls can still report failures.
        return alternateUrl || url
      }
    }

    if (startupError) {
      tauriStatusError = startupError
    }
  } catch (err) {
    statusLookupFailed = true
    console.warn('backend_status command unavailable', err)
  }

  if (cachedBackendUrl) {
    const cachedHealthy = await waitForHealth(cachedBackendUrl, 3, 150)
    if (cachedHealthy) {
      return cachedBackendUrl
    }
    cachedBackendUrl = ''
  }

  if (statusLookupFailed) {
    throw new Error("Backend status is unavailable. Start the app with 'yarn tauri dev'.")
  }

  const detail = tauriStatusError ? ` Details: ${tauriStatusError}` : ''
  throw new Error(
    `Backend is not reachable. Start the app with 'yarn tauri dev' or run FastAPI manually.${detail}`
  )
}

export async function backendFetch(path, init = {}, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 1

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const backendBaseUrl = await getBackendBaseUrl({ allowUnhealthyUrl: false })
      try {
        return await fetch(`${backendBaseUrl}${path}`, init)
      } catch (error) {
        if (!(error instanceof TypeError)) {
          throw error
        }

        const alternateUrl = alternateLoopbackUrl(backendBaseUrl)
        if (!alternateUrl) {
          throw error
        }

        return await fetch(`${alternateUrl}${path}`, init)
      }
    } catch (error) {
      lastError = error
      const canRetry = error instanceof TypeError && attempt < retries
      if (!canRetry) {
        if (error instanceof TypeError) {
          const startupIssue = await getBackendStartupIssue()
          const detail = startupIssue ? ` Startup issue: ${startupIssue}` : ''
          throw new Error(`Unable to reach backend endpoint '${path}'.${detail}`)
        }
        throw error
      }

      cachedBackendUrl = ''
    }
  }

  throw lastError || new Error('Backend request failed')
}

export async function getBackendConnectionDiagnostics() {
  const frontendOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const frontendPort = parsePortFromUrl(frontendOrigin)

  let backendStatusUrl = ''
  let backendBaseUrl = ''
  let startupError = ''
  let backendMode = ''
  let backendRuntime = ''
  let sidecarSelectedPath = ''
  let sidecarCheckedPaths = []
  let sidecarLogPath = ''
  let uptimeSeconds = null

  try {
    const status = await invokeWithTimeout('backend_status')
    backendStatusUrl = typeof status?.url === 'string' ? status.url : ''
    startupError = status?.startup_error || ''
    backendMode = status?.backend_mode || ''
    backendRuntime = status?.backend_runtime || ''
    sidecarSelectedPath = status?.sidecar_selected_path || ''
    sidecarCheckedPaths = Array.isArray(status?.sidecar_checked_paths) ? status.sidecar_checked_paths : []
    sidecarLogPath = status?.sidecar_log_path || ''
    const parsedUptime = Number(status?.uptime_seconds)
    uptimeSeconds = Number.isFinite(parsedUptime) ? parsedUptime : null
  } catch (error) {
    startupError = String(error)
  }

  try {
    backendBaseUrl = await getBackendBaseUrl({ allowUnhealthyUrl: true })
  } catch (_err) {
    // Keep diagnostics best-effort; use backend_status URL if available.
  }

  const chosenBackendUrl = backendBaseUrl || backendStatusUrl
  const backendPort = parsePortFromUrl(chosenBackendUrl)

  const [health, projects] = await Promise.all([
    probeEndpoint(chosenBackendUrl, '/health'),
    probeEndpoint(chosenBackendUrl, '/projects/'),
  ])

  return {
    frontendOrigin,
    frontendPort,
    backendStatusUrl,
    backendBaseUrl,
    chosenBackendUrl,
    backendPort,
    startupError,
    backendMode,
    backendRuntime,
    sidecarSelectedPath,
    sidecarCheckedPaths,
    sidecarLogPath,
    uptimeSeconds,
    health,
    projects,
  }
}
