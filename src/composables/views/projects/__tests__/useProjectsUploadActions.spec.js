import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectsUploadActions } from '../useProjectsUploadActions'


function createUploadHarness(overrides = {}) {
  const project = ref({ id: 11 })
  const selectedPdf = ref(new File(['pdf'], 'book.pdf', { type: 'application/pdf' }))
  const uploadError = ref('')
  const uploadMessage = ref('')
  const ocrPhase = ref('idle')
  const ocrProgress = ref(0)
  const currentJobId = ref('')
  const totalPagesCounter = ref(0)
  const rasterizedPagesCounter = ref(0)
  const segmentedPagesCounter = ref(0)
  const ocrPagesCounter = ref(0)
  const persistedElapsedSeconds = ref(null)
  const processingStartMs = ref(null)
  const processingEndMs = ref(null)
  const activeJob = ref(null)

  const deps = {
    backendFetch: vi.fn(),
    project,
    selectedPdf,
    uploadError,
    uploadMessage,
    ocrPhase,
    ocrProgress,
    currentJobId,
    totalPagesCounter,
    rasterizedPagesCounter,
    segmentedPagesCounter,
    ocrPagesCounter,
    persistedElapsedSeconds,
    processingStartMs,
    processingEndMs,
    activeJob,
    refreshBackendRuntime: vi.fn(async () => {}),
    startElapsedTimer: vi.fn(),
    stopElapsedTimer: vi.fn(),
    persistActiveJob: vi.fn(),
    pollJob: vi.fn(async () => {}),
    startPolling: vi.fn(),
    asUserMessage: vi.fn((error, fallback) => `${fallback} ${String(error)}`),
    loadProject: vi.fn(async () => {}),
    ...overrides,
  }

  return {
    deps,
    selectedPdf,
    uploadError,
    uploadMessage,
    ocrPhase,
    ocrProgress,
    currentJobId,
    upload: useProjectsUploadActions(deps),
  }
}


describe('useProjectsUploadActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads PDF, starts OCR job, and enters polling', async () => {
    const backendFetch = vi.fn(async (url) => {
      if (url.includes('/upload-pdf')) {
        return {
          ok: true,
          json: async () => ({ upload_id: 'upload-1', filename: 'book.pdf' }),
        }
      }
      if (url.includes('/ocr/projects/11/jobs')) {
        return {
          ok: true,
          json: async () => ({ job_id: 'job-1' }),
        }
      }
      throw new Error(`Unexpected call: ${url}`)
    })

    const harness = createUploadHarness({ backendFetch })

    await harness.upload.uploadPdfAndStartOcr()

    expect(harness.deps.currentJobId.value).toBe('job-1')
    expect(harness.deps.persistActiveJob).toHaveBeenCalledWith('job-1', expect.any(Number))
    expect(harness.deps.pollJob).toHaveBeenCalledWith('job-1')
    expect(harness.deps.startPolling).toHaveBeenCalledWith('job-1')
    expect(harness.deps.uploadMessage.value).toContain('OCR job started')
    expect(harness.upload.isUploading.value).toBe(false)
  })

  it('blocks upload when another OCR job is active', async () => {
    const harness = createUploadHarness({ activeJob: ref({ job_id: 'busy' }) })

    await harness.upload.uploadPdfAndStartOcr()

    expect(harness.uploadError.value).toContain('already running')
    expect(harness.deps.backendFetch).not.toHaveBeenCalled()
  })

  it('handles start failures and resets state', async () => {
    const backendFetch = vi.fn(async (url) => {
      if (url.includes('/upload-pdf')) {
        return {
          ok: true,
          json: async () => ({ upload_id: 'upload-1', filename: 'book.pdf' }),
        }
      }
      if (url.includes('/ocr/projects/11/jobs')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ detail: 'backend down' }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    const harness = createUploadHarness({ backendFetch })

    await harness.upload.uploadPdfAndStartOcr()

    expect(harness.deps.stopElapsedTimer).toHaveBeenCalledTimes(1)
    expect(harness.ocrPhase.value).toBe('idle')
    expect(harness.ocrProgress.value).toBe(0)
    expect(harness.uploadError.value).toContain('backend down')
  })
})
