import { ref } from 'vue'
import { beforeEach, afterEach, vi } from 'vitest'
import { mountComposable, deferred, jsonResponse } from '../../../../test/helpers'
import { PERFORMANCE_PROFILE_OPTIONS } from '../../../../shared/services/appSettings'

vi.mock('../../../../shared/composables/useBackendRuntime', () => ({ useBackendRuntime: vi.fn() }))
import { useBackendRuntime } from '../../../../shared/composables/useBackendRuntime'
import { usePerformanceProfileSettings } from '../usePerformanceProfileSettings'

describe('performance profile restart flow', () => {
  let runtime, backendFetch, restartBackend, waitForBackendRuntime, api, wrapper
  beforeEach(() => {
    vi.useFakeTimers()
    runtime = {
      activeProfile: ref('balanced'), hasActiveOcrJob: ref(false), backendConnection: ref('connected'),
      backendInstanceId: ref('old'), effectiveLimits: ref(null), activeJob: ref(null),
      refreshBackendRuntime: vi.fn(async () => {}), startBackendRuntimePolling: vi.fn(),
      stopBackendRuntimePolling: vi.fn(), markBackendRestarting: vi.fn(), applyBackendRuntime: vi.fn(),
    }
    useBackendRuntime.mockReturnValue(runtime)
    backendFetch = vi.fn(async () => jsonResponse({ restart_token: 'reservation' }))
    restartBackend = vi.fn(async () => {})
    waitForBackendRuntime = vi.fn(async () => ({ backend_instance_id: 'new', performance: { profile: 'cool' } }))
    const mounted = mountComposable(() => usePerformanceProfileSettings({
      backendFetch, restartBackend, waitForBackendRuntime, performanceProfileOptions: PERFORMANCE_PROFILE_OPTIONS,
    }))
    api = mounted.result
    wrapper = mounted.wrapper
    api.selectedProfile.value = 'cool'
  })
  afterEach(() => { wrapper.unmount(); vi.clearAllTimers(); vi.useRealTimers() })

  it.each(['active OCR', 'disconnected'])('blocks restart during %s', async reason => {
    if (reason === 'active OCR') runtime.hasActiveOcrJob.value = true
    else runtime.backendConnection.value = 'disconnected'
    await api.applyPerformanceProfile()
    expect(api.canApplyProfile.value).toBe(false)
    expect(backendFetch).not.toHaveBeenCalled()
    expect(restartBackend).not.toHaveBeenCalled()
  })

  it('reserves, restarts and reconnects with the requested profile', async () => {
    const applying = api.applyPerformanceProfile()
    await vi.advanceTimersByTimeAsync(250)
    await applying
    expect(JSON.parse(backendFetch.mock.calls[0][1].body)).toEqual({ profile: 'cool' })
    expect(restartBackend).toHaveBeenCalledWith('cool', 'reservation')
    expect(waitForBackendRuntime).toHaveBeenCalledWith({ expectedProfile: 'cool', previousInstanceId: 'old' })
    expect(runtime.applyBackendRuntime).toHaveBeenCalledWith({ backend_instance_id: 'new', performance: { profile: 'cool' } })
    expect(api.profileMessage.value).toBe('Connected')
    expect(api.isApplyingProfile.value).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.profileMessage.value).toBe('')
    wrapper.unmount()
    expect(runtime.stopBackendRuntimePolling).toHaveBeenCalledOnce()
  })

  it('does not restart when reservation is rejected', async () => {
    backendFetch.mockResolvedValueOnce(jsonResponse({ detail: { message: 'OCR became active' } }, 409))
    const applying = api.applyPerformanceProfile()
    await vi.advanceTimersByTimeAsync(250)
    await applying
    expect(restartBackend).not.toHaveBeenCalled()
    expect(api.profileError.value).toContain('OCR became active')
    expect(api.isApplyingProfile.value).toBe(false)
  })

  it.each(['restart', 'reconnect'])('cancels the reservation after %s fails', async failure => {
    const failed = failure === 'restart' ? restartBackend : waitForBackendRuntime
    failed.mockRejectedValueOnce(new Error('Failed operation'))
    const applying = api.applyPerformanceProfile()
    await vi.advanceTimersByTimeAsync(250)
    await applying
    expect(backendFetch).toHaveBeenLastCalledWith('/system/restart/cancel', expect.objectContaining({ body: JSON.stringify({ restart_token: 'reservation' }) }))
    expect(api.profileError.value).toContain('Failed operation')
    expect(api.isApplyingProfile.value).toBe(false)
    expect(runtime.refreshBackendRuntime).toHaveBeenCalled()
  })

  it('does not launch a second restart while one is pending', async () => {
    const pending = deferred()
    restartBackend.mockReturnValueOnce(pending.promise)
    const applying = api.applyPerformanceProfile()
    await vi.advanceTimersByTimeAsync(250)
    await api.applyPerformanceProfile()
    expect(restartBackend).toHaveBeenCalledOnce()
    pending.resolve()
    await applying
  })
})
