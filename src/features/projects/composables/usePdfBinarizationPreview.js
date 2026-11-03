/**
 * @file Render PDF previews and apply the selected binarization threshold before OCR
 * submission.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const DEFAULT_DPI = 300
const DEFAULT_THRESHOLD = 170
const PREVIEW_MAX_PIXELS = 12000000
const PREVIEW_MAX_DIMENSION = 4096
const THRESHOLD_DEBOUNCE_MS = 110

let pdfWorkerConfigured = false

/**
 * Configure PDF.js to use the bundled worker URL once for the frontend session.
 */
function ensurePdfWorkerConfigured() {
  if (!pdfWorkerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
    pdfWorkerConfigured = true
  }
}

/**
 * Parse a positive integer processing DPI, falling back to the preview default for invalid
 * input.
 */
function sanitizeDpi(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_DPI
  }
  return parsed
}

/**
 * Accept an integer threshold from 1 through 256, otherwise use the preview default.
 */
function sanitizeThreshold(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 256) {
    return DEFAULT_THRESHOLD
  }
  return parsed
}

/**
 * Clamp a one-based page input to a positive page count, using page one for invalid input.
 */
function clampPageNumber(value, totalPages) {
  const parsed = Number.parseInt(value, 10)
  const safeTotal = Math.max(1, Number.parseInt(totalPages, 10) || 1)
  if (!Number.isFinite(parsed)) {
    return 1
  }
  return Math.max(1, Math.min(parsed, safeTotal))
}

/**
 * Compute a scale no larger than one that keeps preview width, height, and total pixels
 * within their limits.
 */
function safeScaleFactor(width, height) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const byDimension = Math.min(1, PREVIEW_MAX_DIMENSION / w, PREVIEW_MAX_DIMENSION / h)
  const byPixels = Math.min(1, Math.sqrt(PREVIEW_MAX_PIXELS / (w * h)))
  return Math.min(byDimension, byPixels)
}

/**
 * Convert a canvas to a PNG Blob asynchronously and reject if the browser returns no blob.
 */
function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('Failed to create preview image'))
    }, 'image/png')
  })
}

/**
 * Render a selected PDF page to a bounded grayscale cache and derive threshold previews from
 * it. Reuse cached pixels for threshold changes and cancel stale work on navigation or
 * teardown.
 * @param {object} inputs - Reactive PDF URL, DPI, threshold, and one-based page number.
 * @returns {object} Preview image URL/aspect ratio, page count, busy flags, and error feedback.
 */
export function usePdfBinarizationPreview({ pdfUrl, dpi, threshold, pageNumber }) {
  ensurePdfWorkerConfigured()

  const pageCount = ref(0)
  const previewImageUrl = ref('')
  const previewAspectRatio = ref(0.75)
  const isLoadingDocument = ref(false)
  const isRenderingPage = ref(false)
  const isApplyingThreshold = ref(false)
  const errorMessage = ref('')

  let activePdfUrl = ''
  let activePdfLoadingTask = null
  let activePdfDocument = null
  let activeRenderTask = null

  let activeRenderRequestId = 0
  let activeThresholdRequestId = 0
  let thresholdTimer = null

  let grayscaleCache = null

  /**
   * Cancel the pending debounced threshold update and clear its handle.
   */
  function clearThresholdTimer() {
    if (thresholdTimer != null) {
      window.clearTimeout(thresholdTimer)
      thresholdTimer = null
    }
  }

  /**
   * Release the current preview's browser object URL and clear the displayed URL.
   */
  function revokePreviewImageUrl() {
    if (previewImageUrl.value) {
      URL.revokeObjectURL(previewImageUrl.value)
      previewImageUrl.value = ''
    }
  }

  /**
   * Publish a replacement preview URL and release the previous object's browser resources.
   */
  function replacePreviewImageUrl(nextUrl) {
    const previousUrl = previewImageUrl.value
    previewImageUrl.value = nextUrl
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl)
    }
  }

  /**
   * Cancel and await the current PDF.js render task, treating cancellation rejection as
   * normal teardown.
   */
  async function cancelActiveRenderTask() {
    const task = activeRenderTask
    activeRenderTask = null
    if (!task) {
      return
    }

    if (typeof task.cancel === 'function') {
      task.cancel()
    }

    try {
      await task.promise
    } catch (_err) {
      // Cancellation is expected when a newer request supersedes the render.
    }
  }

  /**
   * Cancel page rendering and destroy active PDF loading/document tasks while tolerating
   * teardown errors.
   */
  async function destroyActivePdfDocument() {
    await cancelActiveRenderTask()

    const loadingTask = activePdfLoadingTask
    activePdfLoadingTask = null
    if (loadingTask && typeof loadingTask.destroy === 'function') {
      try {
        await loadingTask.destroy()
      } catch (_err) {
        // Ignore teardown errors while switching to a new PDF.
      }
    }

    const doc = activePdfDocument
    activePdfDocument = null
    if (doc && typeof doc.destroy === 'function') {
      try {
        await doc.destroy()
      } catch (_err) {
        // Ignore teardown errors while switching to a new PDF.
      }
    }

    activePdfUrl = ''
  }

  /**
   * Reuse the current PDF or load a new one, publishing page count only for the current
   * request. Destroy a newly loaded document if a newer render superseded it.
   */
  async function ensurePdfDocument(url, requestId) {
    if (activePdfDocument && activePdfUrl === url) {
      return activePdfDocument
    }

    await destroyActivePdfDocument()

    isLoadingDocument.value = true
    const loadingTask = pdfjsLib.getDocument({ url })
    activePdfLoadingTask = loadingTask

    try {
      const documentProxy = await loadingTask.promise
      if (requestId !== activeRenderRequestId) {
        if (typeof documentProxy.destroy === 'function') {
          await documentProxy.destroy().catch(() => {})
        }
        return null
      }

      activePdfDocument = documentProxy
      activePdfUrl = url
      pageCount.value = Number.parseInt(documentProxy.numPages, 10) || 0
      return documentProxy
    } finally {
      if (requestId === activeRenderRequestId) {
        isLoadingDocument.value = false
      }
    }
  }

  /**
   * Build a binary PNG from cached grayscale pixels for the current render generation.
   * Release an obsolete output URL and leave newer request state untouched.
   */
  async function applyThresholdToCurrentPage(thresholdValue, requestId) {
    const cache = grayscaleCache
    if (!cache || requestId !== activeRenderRequestId) {
      return
    }

    isApplyingThreshold.value = true

    try {
      const { grayscale, width, height } = cache
      const binaryPixels = new Uint8ClampedArray(width * height * 4)

      for (let i = 0; i < grayscale.length; i += 1) {
        const value = grayscale[i] > thresholdValue ? 255 : 0
        const offset = i * 4
        binaryPixels[offset] = value
        binaryPixels[offset + 1] = value
        binaryPixels[offset + 2] = value
        binaryPixels[offset + 3] = 255
      }

      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = width
      outputCanvas.height = height

      const outputContext = outputCanvas.getContext('2d', { alpha: false })
      if (!outputContext) {
        throw new Error('Canvas context unavailable')
      }

      const outputImageData = new ImageData(binaryPixels, width, height)
      outputContext.putImageData(outputImageData, 0, 0)

      const blob = await canvasToPngBlob(outputCanvas)
      const nextUrl = URL.createObjectURL(blob)
      if (requestId !== activeRenderRequestId) {
        URL.revokeObjectURL(nextUrl)
        return
      }

      replacePreviewImageUrl(nextUrl)
    } finally {
      if (requestId === activeRenderRequestId) {
        isApplyingThreshold.value = false
      }
    }
  }

  /**
   * Render the selected one-based page at a memory-bounded DPI scale, cache grayscale pixels,
   * and apply the threshold. Reset on an empty URL and suppress expected cancellation errors
   * from superseded requests.
   */
  async function renderCurrentPage() {
    const url = String(pdfUrl.value || '').trim()
    const requestId = ++activeRenderRequestId
    activeThresholdRequestId += 1
    clearThresholdTimer()
    errorMessage.value = ''

    if (!url) {
      await destroyActivePdfDocument()
      grayscaleCache = null
      pageCount.value = 0
      previewAspectRatio.value = 0.75
      revokePreviewImageUrl()
      isLoadingDocument.value = false
      isRenderingPage.value = false
      isApplyingThreshold.value = false
      return
    }

    isRenderingPage.value = true

    try {
      await cancelActiveRenderTask()

      const documentProxy = await ensurePdfDocument(url, requestId)
      if (!documentProxy || requestId !== activeRenderRequestId) {
        return
      }

      const sanitizedPage = clampPageNumber(pageNumber.value, pageCount.value)
      const sanitizedDpi = sanitizeDpi(dpi.value)
      const cacheKey = `${activePdfUrl}::${sanitizedPage}::${sanitizedDpi}`

      if (grayscaleCache?.key === cacheKey) {
        previewAspectRatio.value = grayscaleCache.aspectRatio
        await applyThresholdToCurrentPage(sanitizeThreshold(threshold.value), requestId)
        return
      }

      const page = await documentProxy.getPage(sanitizedPage)
      if (requestId !== activeRenderRequestId) {
        return
      }

      const nominalScale = sanitizedDpi / 72
      const nominalViewport = page.getViewport({ scale: nominalScale })
      const scaleFactor = safeScaleFactor(nominalViewport.width, nominalViewport.height)
      const viewport = page.getViewport({ scale: nominalScale * scaleFactor })

      const width = Math.max(1, Math.floor(viewport.width))
      const height = Math.max(1, Math.floor(viewport.height))
      previewAspectRatio.value = width / height

      const renderCanvas = document.createElement('canvas')
      renderCanvas.width = width
      renderCanvas.height = height

      const renderContext = renderCanvas.getContext('2d', { alpha: false })
      if (!renderContext) {
        throw new Error('Canvas context unavailable')
      }

      renderContext.fillStyle = '#ffffff'
      renderContext.fillRect(0, 0, width, height)

      const renderTask = page.render({
        canvasContext: renderContext,
        viewport,
        background: 'rgb(255,255,255)',
      })
      activeRenderTask = renderTask

      await renderTask.promise
      if (activeRenderTask === renderTask) {
        activeRenderTask = null
      }

      if (requestId !== activeRenderRequestId) {
        return
      }

      const imageData = renderContext.getImageData(0, 0, width, height)
      const rgba = imageData.data
      const grayscale = new Uint8ClampedArray(width * height)

      for (let src = 0, idx = 0; src < rgba.length; src += 4, idx += 1) {
        const red = rgba[src]
        const green = rgba[src + 1]
        const blue = rgba[src + 2]
        grayscale[idx] = Math.round(0.299 * red + 0.587 * green + 0.114 * blue)
      }

      grayscaleCache = {
        key: cacheKey,
        grayscale,
        width,
        height,
        aspectRatio: width / height,
      }

      await applyThresholdToCurrentPage(sanitizeThreshold(threshold.value), requestId)
    } catch (error) {
      const message =
        error?.name === 'RenderingCancelledException'
          ? ''
          : 'Unable to render binarization preview.'
      if (requestId === activeRenderRequestId) {
        errorMessage.value = message
      }
    } finally {
      if (requestId === activeRenderRequestId) {
        isRenderingPage.value = false
      }
    }
  }

  /**
   * Debounce threshold changes and apply only the latest requested threshold to the current
   * cached page.
   */
  function scheduleThresholdUpdate() {
    const requestId = activeRenderRequestId
    activeThresholdRequestId += 1
    const thresholdRequestId = activeThresholdRequestId
    clearThresholdTimer()

    thresholdTimer = window.setTimeout(async () => {
      if (thresholdRequestId !== activeThresholdRequestId) {
        return
      }
      await applyThresholdToCurrentPage(sanitizeThreshold(threshold.value), requestId)
    }, THRESHOLD_DEBOUNCE_MS)
  }

  watch(
    [pdfUrl, pageNumber, dpi],
    () => {
      void renderCurrentPage()
    },
    { immediate: true },
  )

  watch(
    threshold,
    () => {
      scheduleThresholdUpdate()
    },
  )

  onBeforeUnmount(() => {
    activeRenderRequestId += 1
    activeThresholdRequestId += 1
    clearThresholdTimer()
    revokePreviewImageUrl()
    grayscaleCache = null
    void destroyActivePdfDocument()
  })

  return {
    pageCount,
    previewImageUrl,
    previewAspectRatio,
    isLoadingDocument,
    isRenderingPage,
    isApplyingThreshold,
    errorMessage,
  }
}
