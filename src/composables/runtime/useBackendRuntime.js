import { computed, ref } from 'vue'

import { backendFetch } from '../../services/backend'

const ACTIVE_POLL_MS = 1200
const IDLE_POLL_MS = 5000
const HIDDEN_POLL_MS = 15000
const backendConnection = ref('connecting')
const backendInstanceId = ref('')
const activeJob = ref(null)
const activeProfile = ref('balanced')
const effectiveLimits = ref(null)
const runtimeError = ref('')

let pollTimer = null
let subscriberCount = 0
let refreshPromise = null

async function refreshBackendRuntime() {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    try {
      const response = await backendFetch('/system/runtime', {}, { retries: 1 })
      if (!response.ok) {
        throw new Error(`Unable to load backend runtime (${response.status})`)
      }
      const data = await response.json()
      backendConnection.value = 'connected'
      backendInstanceId.value = data.backend_instance_id || ''
      activeJob.value = data.active_job || null
      activeProfile.value = data.performance?.profile || 'balanced'
      effectiveLimits.value = data.performance || null
      runtimeError.value = ''
      return data
    } catch (error) {
      if (backendConnection.value !== 'restarting') {
        backendConnection.value = 'disconnected'
      }
      runtimeError.value = String(error)
      throw error
    } finally {
      refreshPromise = null
      if (
        subscriberCount > 0 &&
        !pollTimer &&
        backendConnection.value !== 'restarting'
      ) {
        scheduleBackendRuntimePoll()
      }
    }
  })()

  return refreshPromise
}

function nextPollDelay() {
  if (typeof document !== 'undefined' && document.hidden) {
    return HIDDEN_POLL_MS
  }
  return activeJob.value ? ACTIVE_POLL_MS : IDLE_POLL_MS
}

function scheduleBackendRuntimePoll(delayMs = nextPollDelay()) {
  if (pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }

  if (subscriberCount === 0) {
    return
  }

  pollTimer = window.setTimeout(async () => {
    pollTimer = null
    try {
      await refreshBackendRuntime()
    } catch (_error) {
      // Runtime state exposes the failure; polling continues at the idle rate.
    } finally {
      scheduleBackendRuntimePoll()
    }
  }, delayMs)
}

function startBackendRuntimePolling() {
  subscriberCount += 1
  if (subscriberCount === 1) {
    scheduleBackendRuntimePoll(0)
  }
}

function stopBackendRuntimePolling() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount === 0 && pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

function markBackendRestarting() {
  backendConnection.value = 'restarting'
  activeJob.value = null
  runtimeError.value = ''
  if (pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

function applyBackendRuntime(data) {
  backendConnection.value = 'connected'
  backendInstanceId.value = data.backend_instance_id || ''
  activeJob.value = data.active_job || null
  activeProfile.value = data.performance?.profile || 'balanced'
  effectiveLimits.value = data.performance || null
  runtimeError.value = ''
  if (subscriberCount > 0) {
    scheduleBackendRuntimePoll()
  }
}

export function useBackendRuntime() {
  return {
    backendConnection,
    backendInstanceId,
    activeJob,
    activeProfile,
    effectiveLimits,
    runtimeError,
    hasActiveOcrJob: computed(() => Boolean(activeJob.value)),
    refreshBackendRuntime,
    startBackendRuntimePolling,
    stopBackendRuntimePolling,
    markBackendRestarting,
    applyBackendRuntime,
  }
}
