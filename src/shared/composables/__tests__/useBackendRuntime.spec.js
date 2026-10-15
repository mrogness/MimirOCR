import { beforeEach, afterEach, vi } from 'vitest'
import { deferred, jsonResponse } from '../../../test/helpers'

vi.mock('../../services/backend', () => ({ backendFetch: vi.fn() }))
import { backendFetch } from '../../services/backend'

describe('shared backend runtime polling', () => {
  let api
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    api = (await import('../useBackendRuntime')).useBackendRuntime()
    backendFetch.mockReset().mockResolvedValue(jsonResponse({ backend_instance_id: 'one', performance: { profile: 'cool' } }))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })
  afterEach(() => { api.stopBackendRuntimePolling(); api.stopBackendRuntimePolling(); vi.clearAllTimers(); vi.useRealTimers() })

  it('shares an in-flight refresh and exposes runtime status', async () => {
    const pending = deferred()
    backendFetch.mockReturnValueOnce(pending.promise)
    const a = api.refreshBackendRuntime()
    const b = api.refreshBackendRuntime()
    expect(backendFetch).toHaveBeenCalledOnce()
    pending.resolve(jsonResponse({ backend_instance_id: 'two', active_job: { job_id: 'job' }, performance: { profile: 'fast' } }))
    await Promise.all([a, b])
    expect(api.backendConnection.value).toBe('connected')
    expect(api.backendInstanceId.value).toBe('two')
    expect(api.activeProfile.value).toBe('fast')
    expect(api.hasActiveOcrJob.value).toBe(true)
  })

  it('keeps polling until the last subscriber leaves', async () => {
    api.startBackendRuntimePolling()
    api.startBackendRuntimePolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(backendFetch).toHaveBeenCalledOnce()
    api.stopBackendRuntimePolling()
    await vi.advanceTimersByTimeAsync(5000)
    expect(backendFetch).toHaveBeenCalledTimes(2)
    api.stopBackendRuntimePolling()
    await vi.advanceTimersByTimeAsync(20000)
    expect(backendFetch).toHaveBeenCalledTimes(2)
  })

  it('uses a slower polling interval while hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    api.startBackendRuntimePolling()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(14999)
    expect(backendFetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(backendFetch).toHaveBeenCalledTimes(2)
  })

  it('reports disconnection and recovers on the next refresh', async () => {
    backendFetch.mockRejectedValueOnce(new TypeError('Offline'))
    await expect(api.refreshBackendRuntime()).rejects.toThrow('Offline')
    expect(api.backendConnection.value).toBe('disconnected')
    expect(api.runtimeError.value).toContain('Offline')
    await api.refreshBackendRuntime()
    expect(api.backendConnection.value).toBe('connected')
    expect(api.runtimeError.value).toBe('')
  })

  it('does not let an old refresh overwrite the restarting state', async () => {
    const pending = deferred()
    backendFetch.mockReturnValueOnce(pending.promise)
    const refreshing = api.refreshBackendRuntime()
    api.markBackendRestarting()
    pending.resolve(jsonResponse({ backend_instance_id: 'old', performance: { profile: 'balanced' } }))
    await refreshing
    expect(api.backendConnection.value).toBe('restarting')
    api.applyBackendRuntime({ backend_instance_id: 'new', performance: { profile: 'cool' } })
    expect(api.backendConnection.value).toBe('connected')
    expect(api.backendInstanceId.value).toBe('new')
  })
})
