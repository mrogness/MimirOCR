import { ref, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, vi } from 'vitest'
import { mountComposable, deferred, stubObjectUrls } from '../../../../test/helpers'

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.js' }))
import { getDocument } from 'pdfjs-dist'
import { usePdfBinarizationPreview } from '../usePdfBinarizationPreview'

describe('PDF preview orchestration', () => {
  let doc, page, putImageData, wrappers, count
  function preview() {
    const inputs = { pdfUrl: ref('blob:pdf'), dpi: ref(72), threshold: ref(170), pageNumber: ref(1) }
    const mounted = mountComposable(() => usePdfBinarizationPreview(inputs))
    wrappers.push(mounted.wrapper)
    return { ...inputs, ...mounted.result }
  }
  beforeEach(() => {
    vi.useFakeTimers()
    wrappers = []
    count = 0
    putImageData = vi.fn()
    stubObjectUrls()
    vi.stubGlobal('ImageData', class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return {
        fillRect() {}, putImageData,
        getImageData: () => ({ data: Uint8ClampedArray.from({ length: this.width * this.height * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % 2 ? 200 : 100)) }),
      }
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) { callback(new Blob(['png'])) })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++count}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    page = {
      getViewport: vi.fn(({ scale }) => ({ width: 2 * scale, height: scale })),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    }
    doc = { numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) }
    getDocument.mockReset().mockImplementation(() => ({ promise: Promise.resolve(doc), destroy: vi.fn(async () => {}) }))
  })
  afterEach(async () => {
    wrappers.forEach(wrapper => wrapper.unmount())
    await flushPromises()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('thresholds actual pixel values and reuses the rendered page for threshold changes', async () => {
    const api = preview()
    await flushPromises()
    expect(api.pageCount.value).toBe(2)
    expect([...putImageData.mock.calls[0][0].data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
    api.threshold.value = 220
    await nextTick()
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(page.render).toHaveBeenCalledOnce()
    expect([...putImageData.mock.lastCall[0].data]).toEqual([0, 0, 0, 255, 0, 0, 0, 255])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })

  it('debounces threshold changes and clamps page requests', async () => {
    const api = preview()
    await flushPromises()
    putImageData.mockClear()
    api.threshold.value = 180
    await nextTick()
    await vi.advanceTimersByTimeAsync(50)
    api.threshold.value = 200
    await nextTick()
    await vi.advanceTimersByTimeAsync(110)
    expect(putImageData).toHaveBeenCalledOnce()
    api.pageNumber.value = 99
    await flushPromises()
    expect(doc.getPage).toHaveBeenLastCalledWith(2)
  })

  it('discards a superseded PDF load rather than replacing the newer preview', async () => {
    const old = deferred()
    const oldDoc = { ...doc, numPages: 50, destroy: vi.fn(async () => {}) }
    getDocument.mockImplementationOnce(() => ({ promise: old.promise, destroy: vi.fn(async () => {}) }))
    const api = preview()
    await flushPromises()
    api.pdfUrl.value = 'blob:new-pdf'
    await flushPromises()
    const currentUrl = api.previewImageUrl.value
    old.resolve(oldDoc)
    await flushPromises()
    expect(api.pageCount.value).toBe(2)
    expect(api.previewImageUrl.value).toBe(currentUrl)
    expect(oldDoc.destroy).toHaveBeenCalledOnce()
  })

  it('cancels active rendering and destroys resources on unmount', async () => {
    const pending = deferred()
    const cancel = vi.fn(() => pending.reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })))
    page.render.mockReturnValue({ promise: pending.promise, cancel })
    const api = preview()
    await flushPromises()
    wrappers[0].unmount()
    await flushPromises()
    expect(cancel).toHaveBeenCalledOnce()
    expect(doc.destroy).toHaveBeenCalledOnce()
    expect(api.errorMessage.value).toBe('')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('shows an error for an unreadable PDF and clears it after a new selection', async () => {
    getDocument.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('Corrupt PDF')), destroy: vi.fn(async () => {}) }))
    const api = preview()
    await flushPromises()
    expect(api.errorMessage.value).toContain('Unable to render')
    api.pdfUrl.value = 'blob:valid'
    await flushPromises()
    expect(api.errorMessage.value).toBe('')
    expect(api.isRenderingPage.value).toBe(false)
    api.pdfUrl.value = ''
    await flushPromises()
    expect(api.previewImageUrl.value).toBe('')
    expect(api.pageCount.value).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })
})
