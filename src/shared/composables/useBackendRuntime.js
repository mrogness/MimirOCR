/**
 * @file Share backend status and one polling loop across mounted consumers. Subscriber
 * counting and generation checks coordinate refresh, restart, and cleanup.
 */
import { computed, ref } from 'vue'

import { backendFetch } from '../services/backend'

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
let runtimeGeneration = 0

/**
 * Share one in-flight runtime request across callers and update status only for the current
 * generation. Publish connection errors and resume scheduled polling when subscribers still
 * exist.
 */
async function refreshBackendRuntime() {
  if (refreshPromise) {
    return refreshPromise
  }

  const generation = runtimeGeneration
  refreshPromise = (async () => {
    try {
      const response = await backendFetch('/system/runtime', {}, { retries: 1 })
      if (!response.ok) {
        throw new Error(`Unable to load backend runtime (${response.status})`)
      }
      const data = await response.json()
      if (generation !== runtimeGeneration) return data
      backendConnection.value = 'connected'
      backendInstanceId.value = data.backend_instance_id || ''
      activeJob.value = data.active_job || null
      activeProfile.value = data.performance?.profile || 'balanced'
      effectiveLimits.value = data.performance || null
      runtimeError.value = ''
      return data
    } catch (error) {
      if (generation !== runtimeGeneration) throw error
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

/**
 * Choose the slower hidden-document delay, otherwise poll faster for an active OCR job than
 * an idle backend.
 */
function nextPollDelay() {
  if (typeof document !== 'undefined' && document.hidden) {
    return HIDDEN_POLL_MS
  }
  return activeJob.value ? ACTIVE_POLL_MS : IDLE_POLL_MS
}

/**
 * Replace the scheduled timeout while subscribers exist, refresh runtime status once, and
 * schedule the next poll even after a failed request.
 */
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

/**
 * Add a consumer and schedule an immediate status refresh when the first subscriber arrives.
 */
function startBackendRuntimePolling() {
  subscriberCount += 1
  if (subscriberCount === 1) {
    scheduleBackendRuntimePoll(0)
  }
}

/**
 * Release one consumer and clear the scheduled poll when no subscribers remain.
 */
function stopBackendRuntimePolling() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount === 0 && pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * Invalidate old runtime responses, publish restarting state, clear the displayed job/error,
 * and pause the scheduled poll.
 */
function markBackendRestarting() {
  runtimeGeneration += 1
  backendConnection.value = 'restarting'
  activeJob.value = null
  runtimeError.value = ''
  if (pollTimer) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * Adopt a confirmed runtime snapshot after restart, invalidate old responses, and resume
 * polling for active subscribers.
 */
function applyBackendRuntime(data) {
  runtimeGeneration += 1
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

/**
 * Access shared backend status and explicit polling/restart lifecycle helpers.
 * Consumers pair start/stop calls so the shared poller runs only while needed.
 * @returns {object} Runtime refs and refresh, subscription, and restart-state helpers.
 */
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
