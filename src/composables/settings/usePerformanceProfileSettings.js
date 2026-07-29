import { computed, onBeforeUnmount, ref } from 'vue'

import { useBackendRuntime } from '../runtime/useBackendRuntime'

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

    const option = performanceProfileOptions.find((item) => item.value === selectedProfile.value)
    const confirmed = window.confirm(
      `Apply the ${option?.label || selectedProfile.value} profile and restart the processing backend?`,
    )
    if (!confirmed) {
      selectedProfile.value = runtime.activeProfile.value
      return
    }

    isApplyingProfile.value = true
    profileMessage.value = 'Preparing backend restart…'
    profileError.value = ''
    let restartToken = ''

    try {
      const prepareResponse = await backendFetch('/system/restart/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: selectedProfile.value }),
      })
      if (!prepareResponse.ok) {
        const body = await prepareResponse.json().catch(() => ({}))
        throw new Error(body.detail?.message || 'The backend is busy and cannot restart.')
      }
      const prepared = await prepareResponse.json()
      restartToken = prepared.restart_token || ''

      const previousInstanceId = runtime.backendInstanceId.value
      runtime.markBackendRestarting()
      profileMessage.value = `Restarting backend with the ${option?.label || selectedProfile.value} profile…`
      await restartBackend(selectedProfile.value, restartToken)

      profileMessage.value = 'Waiting for the processing backend to reconnect…'
      const nextRuntime = await waitForBackendRuntime({
        expectedProfile: selectedProfile.value,
        previousInstanceId,
      })
      runtime.applyBackendRuntime(nextRuntime)
      profileMessage.value = `${option?.label || selectedProfile.value} profile is active.`
    } catch (error) {
      await cancelRestartReservation(restartToken)
      profileError.value = String(error)
      profileMessage.value = ''
      void runtime.refreshBackendRuntime().catch(() => {})
    } finally {
      isApplyingProfile.value = false
    }
  }

  onBeforeUnmount(() => {
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
