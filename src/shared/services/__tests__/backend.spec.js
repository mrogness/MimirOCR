import { beforeEach, afterEach, vi } from 'vitest'
import { deferred, jsonResponse } from '../../../test/helpers'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'

describe('backend connection boundary', () => {
  let api
  let fetchMock
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    api = await import('../backend')
    invoke.mockReset().mockResolvedValue({ url: 'http://localhost:9000' })
    fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('shares connection discovery between concurrent callers and caches the result', async () => {
    const pending = deferred()
    invoke.mockReturnValueOnce(pending.promise)
    const a = api.getBackendBaseUrl()
    const b = api.getBackendBaseUrl()
    pending.resolve({ url: ' http://localhost:9000 ' })
    expect(await Promise.all([a, b])).toEqual(['http://localhost:9000', 'http://localhost:9000'])
    await api.getBackendBaseUrl()
    expect(invoke).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9000/system/runtime')
  })

  it('does not cache a connection invalidated while discovery was in flight', async () => {
    const pending = deferred()
    invoke.mockReturnValueOnce(pending.promise)
    const first = api.getBackendBaseUrl({ waitUntilReady: false })
    const rejected = expect(first).rejects.toThrow('connection changed')
    api.invalidateBackendConnection()
    pending.resolve({ url: 'http://localhost:8000' })
    await rejected
    expect(await api.getBackendBaseUrl({ waitUntilReady: false })).toBe('http://localhost:9000')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('rediscovers the address after transport failure and preserves request options', async () => {
    await api.getBackendBaseUrl({ waitUntilReady: false })
    invoke.mockResolvedValue({ url: 'http://localhost:9001' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const init = { method: 'PATCH', body: 'correction' }
    await api.backendFetch('/lines/1', init, { retries: 1 })
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:9001/lines/1', init)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('returns HTTP failures to the caller without transport retries', async () => {
    await api.getBackendBaseUrl({ waitUntilReady: false })
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Busy' }, 409))
    const response = await api.backendFetch('/ocr', {}, { retries: 4 })
    expect(response.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('limits transport retries and reports the startup issue', async () => {
    await api.getBackendBaseUrl({ waitUntilReady: false })
    invoke.mockResolvedValue({ url: 'http://localhost:9000', startup_error: 'Worker missing' })
    fetchMock.mockImplementation(async url => {
      if (url.endsWith('/system/runtime')) return jsonResponse({})
      throw new TypeError('Offline')
    })
    await expect(api.backendFetch('/projects/', {}, { retries: 1 })).rejects.toThrow('Worker missing')
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/projects/'))).toHaveLength(2)
  })

  it('times out a stalled native command and permits a later attempt', async () => {
    invoke.mockReturnValueOnce(new Promise(() => {}))
    const failed = expect(api.getBackendBaseUrl()).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(1800)
    await failed
    expect(await api.getBackendBaseUrl()).toBe('http://localhost:9000')
  })

  it('requires both a new instance and the requested profile after restart', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ backend_instance_id: 'old', performance: { profile: 'cool' } }))
      .mockResolvedValueOnce(jsonResponse({ backend_instance_id: 'new', performance: { profile: 'balanced' } }))
      .mockResolvedValueOnce(jsonResponse({ backend_instance_id: 'new', performance: { profile: 'cool' } }))
    const ready = api.waitForBackendRuntime({ expectedProfile: 'cool', previousInstanceId: 'old', attempts: 3, delayMs: 10 })
    await vi.advanceTimersByTimeAsync(20)
    expect((await ready).backend_instance_id).toBe('new')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports exhausted reconnection attempts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503))
    const failed = expect(api.waitForBackendRuntime({ expectedProfile: 'fast', attempts: 2, delayMs: 10 })).rejects.toThrow('did not reconnect')
    await vi.advanceTimersByTimeAsync(20)
    await failed
  })

  it('rejects automatic restart outside the desktop runtime', async () => {
    await expect(api.restartBackend('cool', 'token')).rejects.toThrow('Tauri application')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports native startup failure without probing an unavailable URL', async () => {
    invoke.mockResolvedValue({ startup_error: 'Missing sidecar' })
    const diagnostics = await api.getBackendConnectionDiagnostics()
    expect(diagnostics.startupError).toBe('Missing sidecar')
    expect(diagnostics.health.ok).toBe(false)
    expect(diagnostics.health.error).toContain('No backend URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports both endpoint results and native runtime paths', async () => {
    invoke.mockResolvedValue({
      url: 'http://localhost:9000', backend_mode: 'sidecar', backend_runtime: 'bundled',
      sidecar_selected_path: '/app/backend', sidecar_checked_paths: ['/app/backend'],
      app_data_dir: '/data', cache_dir: '/cache', temp_dir: '/tmp', db_path: '/data/db',
      uploads_dir: '/data/uploads', output_dir: '/data/output', uptime_seconds: '12',
    })
    fetchMock.mockImplementation(async url => jsonResponse({}, url.endsWith('/health') ? 503 : 200))
    const diagnostics = await api.getBackendConnectionDiagnostics()
    expect(diagnostics).toMatchObject({ backendPort: '9000', backendMode: 'sidecar', uptimeSeconds: 12, dbPath: '/data/db' })
    expect(diagnostics.health).toMatchObject({ ok: false, status: '503' })
    expect(diagnostics.projects).toMatchObject({ ok: true, status: '200' })
  })

  it('aborts stalled diagnostic probes and returns their errors', async () => {
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')))
    }))
    const pending = api.getBackendConnectionDiagnostics()
    await vi.advanceTimersByTimeAsync(2500)
    const diagnostics = await pending
    expect(diagnostics.health.status).toBe('error')
    expect(diagnostics.projects.error).toContain('Timed out')
    expect(vi.getTimerCount()).toBe(0)
  })
})
