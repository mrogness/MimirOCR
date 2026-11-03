/**
 * @file Apply backend performance profiles and track the restart/reconnection workflow.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import { useBackendRuntime } from '../../../shared/composables/useBackendRuntime'

const RESTART_PHASE_DELAY_MS = 250
const CONNECTED_MESSAGE_MS = 3000

/**
 * Manage profile selection and the reserved backend restart/reconnection workflow. Block
 * changes during active OCR or disconnection and release runtime polling on unmount.
 * @param {object} dependencies - Backend fetch, profile options, host restart, and runtime-wait functions.
 * @returns {object} Profile controls, effective limits, restart feedback, and load/apply actions.
 */
export function usePerformanceProfileSettings({
  backendFetch,
  performanceProfileOptions,
  restartBackend,
  waitForBackendRuntime,
}) {
  const selectedProfile = ref('balanced')
  const profileMessage = ref('')
  const profileError = ref('')
  const isApplyingProfile = ref(false)

  let clearMessageTimer = null

  const runtime = useBackendRuntime()
  const selectedProfileDescription = computed(
    () => performanceProfileOptions.find((item) => item.value === selectedProfile.value)?.description || '',
  )
  const profileChanged = computed(() => selectedProfile.value !== runtime.activeProfile.value)
  const profileChangeBlocked = computed(
    () => runtime.hasActiveOcrJob.value || runtime.backendConnection.value !== 'connected',
  )
  const canApplyProfile = computed(
    () => profileChanged.value && !profileChangeBlocked.value && !isApplyingProfile.value,
  )

  /**
   * Resolve after a millisecond delay so restart phase feedback remains visible.
   */
  function pause(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  }

  /**
   * Cancel the pending timer that clears successful reconnection feedback.
   */
  function clearConnectedMessageTimer() {
    if (clearMessageTimer) {
      window.clearTimeout(clearMessageTimer)
      clearMessageTimer = null
    }
  }

  /**
   * Replace the message timer and clear connected feedback after its display interval.
   */
  function scheduleConnectedMessageClear() {
    clearConnectedMessageTimer()
    clearMessageTimer = window.setTimeout(() => {
      profileMessage.value = ''
      clearMessageTimer = null
    }, CONNECTED_MESSAGE_MS)
  }

  /**
   * Publish a phase message, wait for Vue to render it, and optionally pause before
   * continuing.
   */
  async function showRestartPhase(message, delay = 0) {
    profileMessage.value = message
    await nextTick()
    if (delay > 0) {
      await pause(delay)
    }
  }

  /**
   * Subscribe to shared runtime status, refresh it, and initialize selection from the active
   * profile.
   */
  async function loadPerformanceProfile() {
    runtime.startBackendRuntimePolling()
    try {
      await runtime.refreshBackendRuntime()
      selectedProfile.value = runtime.activeProfile.value
    } catch (error) {
      profileError.value = String(error)
    }
  }

  /**
   * Best-effort cancel an acquired restart token, tolerating the old backend already being
   * stopped.
   */
  async function cancelRestartReservation(restartToken) {
    if (!restartToken) {
      return
    }
    try {
      await backendFetch('/system/restart/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restart_token: restartToken }),
      })
    } catch (_error) {
      // The old backend may already be stopped, which makes cancellation unnecessary.
    }
  }

  /**
   * Reserve an idle backend, invoke the host restart, and wait for a new instance with the
   * requested profile. Adopt the confirmed runtime on success; cancel the reservation and
   * expose feedback on failure.
   */
  async function applyPerformanceProfile() {
    if (!canApplyProfile.value) {
      return
    }

    const requestedProfile = selectedProfile.value
    clearConnectedMessageTimer()
    isApplyingProfile.value = true
    profileError.value = ''
    let restartToken = ''

    try {
      await showRestartPhase('Stopping Backend…', RESTART_PHASE_DELAY_MS)

      const prepareResponse = await backendFetch('/system/restart/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: requestedProfile }),
      })
      if (!prepareResponse.ok) {
        const body = await prepareResponse.json().catch(() => ({}))
        throw new Error(body.detail?.message || 'The backend is busy and cannot restart.')
      }
      const prepared = await prepareResponse.json()
      restartToken = prepared.restart_token || ''

      const previousInstanceId = runtime.backendInstanceId.value
      runtime.markBackendRestarting()

      await showRestartPhase('Restarting Backend…')
      await restartBackend(requestedProfile, restartToken)

      await showRestartPhase('Connecting…')
      const nextRuntime = await waitForBackendRuntime({
        expectedProfile: requestedProfile,
        previousInstanceId,
      })
      runtime.applyBackendRuntime(nextRuntime)
      selectedProfile.value = nextRuntime.performance?.profile || requestedProfile
      await showRestartPhase('Connected')
      scheduleConnectedMessageClear()
    } catch (error) {
      await cancelRestartReservation(restartToken)
      profileError.value = String(error)
      await showRestartPhase('Restart failed')
      void runtime.refreshBackendRuntime().catch(() => {})
    } finally {
      isApplyingProfile.value = false
    }
  }

  onBeforeUnmount(() => {
    clearConnectedMessageTimer()
    runtime.stopBackendRuntimePolling()
  })

  return {
    performanceProfileOptions,
    selectedProfile,
    selectedProfileDescription,
    activeProfile: runtime.activeProfile,
    effectiveLimits: runtime.effectiveLimits,
    activeJob: runtime.activeJob,
    backendConnection: runtime.backendConnection,
    profileMessage,
    profileError,
    isApplyingProfile,
    profileChanged,
    profileChangeBlocked,
    canApplyProfile,
    loadPerformanceProfile,
    applyPerformanceProfile,
  }
}
