import { computed, ref } from 'vue'

import { backendFetch } from '../../services/backend'

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
    }
  })()

  return refreshPromise
}

function startBackendRuntimePolling() {
  subscriberCount += 1
  void refreshBackendRuntime().catch(() => {})
  if (!pollTimer) {
    pollTimer = window.setInterval(() => {
      void refreshBackendRuntime().catch(() => {})
    }, 1200)
  }
}

function stopBackendRuntimePolling() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount === 0 && pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function markBackendRestarting() {
  backendConnection.value = 'restarting'
  activeJob.value = null
  runtimeError.value = ''
}

function applyBackendRuntime(data) {
  backendConnection.value = 'connected'
  backendInstanceId.value = data.backend_instance_id || ''
  activeJob.value = data.active_job || null
  activeProfile.value = data.performance?.profile || 'balanced'
  effectiveLimits.value = data.performance || null
  runtimeError.value = ''
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
