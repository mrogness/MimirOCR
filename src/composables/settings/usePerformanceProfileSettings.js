import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import { useBackendRuntime } from '../runtime/useBackendRuntime'

const RESTART_PHASE_DELAY_MS = 250
const CONNECTED_MESSAGE_MS = 3000

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

  function pause(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  }

  function clearConnectedMessageTimer() {
    if (clearMessageTimer) {
      window.clearTimeout(clearMessageTimer)
      clearMessageTimer = null
    }
  }

  function scheduleConnectedMessageClear() {
    clearConnectedMessageTimer()
    clearMessageTimer = window.setTimeout(() => {
      profileMessage.value = ''
      clearMessageTimer = null
    }, CONNECTED_MESSAGE_MS)
  }

  async function showRestartPhase(message, delay = 0) {
    profileMessage.value = message
    await nextTick()
    if (delay > 0) {
      await pause(delay)
    }
  }

  async function loadPerformanceProfile() {
    runtime.startBackendRuntimePolling()
    try {
      await runtime.refreshBackendRuntime()
      selectedProfile.value = runtime.activeProfile.value
    } catch (error) {
      profileError.value = String(error)
    }
  }

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
