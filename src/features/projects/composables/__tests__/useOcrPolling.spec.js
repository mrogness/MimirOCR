import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred, jsonResponse } from '../../../../test/helpers'

import { useOcrPolling } from '../useOcrPolling'


function createPollingHarness(overrides = {}) {
  const state = {
    ocrPhase: ref('idle'),
    ocrProgress: ref(0),
    uploadMessage: ref(''),
    uploadError: ref(''),
    totalPagesCounter: ref(0),
    rasterizedPagesCounter: ref(0),
    segmentedPagesCounter: ref(0),
    ocrPagesCounter: ref(0),
    processingStartMs: ref(null),
    processingEndMs: ref(null),
    currentJobId: ref(''),
    persistedElapsedSeconds: ref(null),
    processingNowMs: ref(null),
  }

  const timing = {
    startElapsedTimer: vi.fn(),
    stopElapsedTimer: vi.fn(),
  }

  const persistence = {
    persistActiveJob: vi.fn(),
    clearPersistedActiveJob: vi.fn(),
    readPersistedActiveJob: vi.fn(() => null),
  }

  const deps = {
    backendFetch: vi.fn(),
    project: ref({ id: 7 }),
    reloadProject: vi.fn(async () => {}),
    state,
    timing,
    persistence,
    onRecoveredRunNotice: vi.fn(),
    ...overrides,
  }

  return {
    deps,
    state,
    timing,
    persistence,
    polling: useOcrPolling(deps),
  }
}


describe('useOcrPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('updates run state and counters while job is running', async () => {
    const harness = createPollingHarness({
      backendFetch: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'running',
          phase: 'ocr',
          progress: 45,
          message: 'Working',
          created_at: '2026-10-01T10:00:00Z',
          total_pages: 12,
          rasterized_pages: 12,
          segmented_pages: 10,
          ocr_pages: 5,
        }),
      })),
    })

    await harness.polling.pollJob('job-7')

    expect(harness.state.ocrPhase.value).toBe('ocr')
    expect(harness.state.ocrProgress.value).toBe(45)
    expect(harness.state.totalPagesCounter.value).toBe(12)
    expect(harness.state.segmentedPagesCounter.value).toBe(10)
    expect(harness.timing.startElapsedTimer).toHaveBeenCalledTimes(1)
    expect(harness.persistence.persistActiveJob).toHaveBeenCalledWith(
      'job-7',
      Date.parse('2026-10-01T10:00:00Z'),
    )
  })

  it('handles failed jobs by stopping timers and surfacing backend error', async () => {
    const harness = createPollingHarness({
      backendFetch: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'failed',
          phase: 'failed',
          progress: 100,
          error: 'Worker crashed',
        }),
      })),
    })

    await harness.polling.pollJob('job-failed')

    expect(harness.timing.stopElapsedTimer).toHaveBeenCalledTimes(1)
    expect(harness.persistence.clearPersistedActiveJob).toHaveBeenCalledTimes(1)
    expect(harness.state.uploadError.value).toBe('Worker crashed')
    expect(harness.deps.reloadProject).toHaveBeenCalledTimes(1)
  })

  it('recovers from persisted job id and starts polling loop', async () => {
    const backendFetch = vi.fn(async (url) => {
      if (url.includes('/ocr/jobs/')) {
        return {
          ok: true,
          json: async () => ({ status: 'running', phase: 'running', progress: 5, message: 'Booting' }),
        }
      }
      return { ok: true, json: async () => ({ jobs: [] }) }
    })

    const harness = createPollingHarness({
      backendFetch,
      persistence: {
        persistActiveJob: vi.fn(),
        clearPersistedActiveJob: vi.fn(),
        readPersistedActiveJob: vi.fn(() => ({ jobId: 'job-resume', startedAtMs: 1234 })),
      },
    })

    await harness.polling.resumeLatestJobIfActive()

    expect(harness.state.currentJobId.value).toBe('job-resume')
    expect(harness.state.ocrPhase.value).toBe('running')

    await vi.advanceTimersByTimeAsync(1300)
    expect(backendFetch).toHaveBeenCalledWith('/ocr/jobs/job-resume', {}, { retries: 2 })
  })

  it.each(['succeeded', 'failed'])('does not restart polling for a recovered %s job', async status => {
    const harness = createPollingHarness({ backendFetch: vi.fn(async () => jsonResponse({ status, phase: status === 'succeeded' ? 'completed' : 'failed' })) })
    harness.persistence.readPersistedActiveJob.mockReturnValue({ jobId: 'finished' })
    await harness.polling.resumeLatestJobIfActive()
    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.deps.backendFetch).toHaveBeenCalledOnce()
    expect(harness.persistence.clearPersistedActiveJob).toHaveBeenCalledOnce()
    expect(harness.deps.reloadProject).toHaveBeenCalledOnce()
  })

  it('falls back from a missing persisted job to active job discovery', async () => {
    const harness = createPollingHarness({ backendFetch: vi.fn(async url => url.endsWith('/jobs')
      ? jsonResponse({ jobs: [{ job_id: 'active', status: 'running' }] }) : jsonResponse({}, 404)) })
    harness.persistence.readPersistedActiveJob.mockReturnValue({ jobId: 'expired' })
    await harness.polling.resumeLatestJobIfActive()
    expect(harness.persistence.clearPersistedActiveJob).toHaveBeenCalledOnce()
    expect(harness.state.currentJobId.value).toBe('active')
    expect(harness.deps.onRecoveredRunNotice).toHaveBeenCalledWith('Reconnected to in-progress OCR run.')
    harness.polling.cleanupPolling()
    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.deps.backendFetch).toHaveBeenCalledTimes(2)
  })

  it('stops after a connection failure and surfaces it to the user', async () => {
    const harness = createPollingHarness({ backendFetch: vi.fn().mockRejectedValue(new TypeError('Offline')) })
    harness.polling.startPolling('job')
    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.deps.backendFetch).toHaveBeenCalledOnce()
    expect(harness.state.uploadError.value).toContain('Lost connection')
  })

  it('does not overlap requests when a status response is slow', async () => {
    const pending = deferred()
    const harness = createPollingHarness({ backendFetch: vi.fn(() => pending.promise) })
    harness.polling.startPolling('job')
    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.deps.backendFetch).toHaveBeenCalledOnce()
    pending.resolve(jsonResponse({ status: 'running' }))
    await vi.advanceTimersByTimeAsync(0)
    harness.polling.cleanupPolling()
  })

  it('ignores an in-flight response after cleanup', async () => {
    const pending = deferred()
    const harness = createPollingHarness({ backendFetch: vi.fn(() => pending.promise) })
    harness.polling.startPolling('job')
    await vi.advanceTimersByTimeAsync(1200)
    harness.polling.cleanupPolling()
    pending.resolve(jsonResponse({ status: 'succeeded', phase: 'completed' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.deps.reloadProject).not.toHaveBeenCalled()
    expect(harness.state.ocrPhase.value).toBe('idle')
  })
})
