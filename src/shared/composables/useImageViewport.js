/**
 * @file Manage review image zoom, pan, and viewport interaction state.
 */
import { computed, nextTick, ref } from 'vue'

/**
 * Create image sizing, zoom, and viewport state for one review workspace.
 * @returns {object} Element refs, display dimensions, zoom controls, and viewport helpers.
 */
export function useImageViewport() {
  const MIN_ZOOM = 0.1
  const MAX_ZOOM = 3

  const renderedImageWidth = ref(1)
  const renderedImageHeight = ref(1)
  const baseImageWidth = ref(1)
  const baseImageHeight = ref(1)
  const zoomLevel = ref(1)
  const hasManualZoom = ref(false)
  const hasInitializedZoom = ref(false)
  const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 900)
  const panelViewportHeight = ref(360)

  const imageRef = ref(null)
  const overlayPanelRef = ref(null)

  const imageDisplayWidth = computed(() => Math.max(1, Math.round(baseImageWidth.value * zoomLevel.value)))
  const imageDisplayHeight = computed(() => Math.max(1, Math.round(baseImageHeight.value * zoomLevel.value)))

  /**
   * Compute a lower zoom bound that can show the whole page in the available panel, capped at
   * natural size and the absolute minimum.
   */
  function minZoomForFullPageInPanel() {
    const panel = overlayPanelRef.value
    const width = baseImageWidth.value
    const height = baseImageHeight.value

    if (!panel || width <= 0 || height <= 0) {
      return MIN_ZOOM
    }

    const availableWidth = Math.max(1, panel.clientWidth)
    const availableHeight = Math.max(1, panel.clientHeight)
    const fitWidth = availableWidth / width
    const fitHeight = availableHeight / height
    const fitWholePage = Math.min(fitWidth, fitHeight)

    return Math.max(MIN_ZOOM, Math.min(1, fitWholePage))
  }

  /**
   * Normalize zoom to three decimal places within the current fit-derived minimum and maximum
   * scale.
   */
  function clampZoom(nextZoom) {
    const minZoom = minZoomForFullPageInPanel()
    const numeric = Number.isFinite(nextZoom) ? nextZoom : 1
    return Math.max(minZoom, Math.min(MAX_ZOOM, Number(numeric.toFixed(3))))
  }

  /**
   * Calculate the scale needed to fit page height inside the panel padding, returning natural
   * size when dimensions are unavailable.
   */
  function fitZoomForViewportHeight() {
    const panel = overlayPanelRef.value
    if (!panel || baseImageHeight.value <= 0) {
      return 1
    }

    const viewportPadding = 16
    const availableHeight = Math.max(120, panel.clientHeight - viewportPadding)
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, availableHeight / baseImageHeight.value))
  }

  /**
   * Measure remaining browser height below the overlay panel and apply the minimum/fallback
   * panel height.
   */
  function recalculatePanelViewportHeight() {
    const referenceEl = overlayPanelRef.value
    if (!referenceEl) {
      panelViewportHeight.value = Math.max(260, viewportHeight.value - 300)
      return
    }

    const rect = referenceEl.getBoundingClientRect()
    const viewportPadding = 12
    const available = Math.max(220, window.innerHeight - rect.top - viewportPadding)
    panelViewportHeight.value = Math.floor(available)
  }

  /**
   * Apply a clamped height-fit zoom only when the image and overlay panel have usable
   * dimensions.
   */
  function fitPageToViewportHeight() {
    if (!overlayPanelRef.value || baseImageHeight.value <= 0) {
      return
    }

    zoomLevel.value = clampZoom(fitZoomForViewportHeight())
  }

  /**
   * Capture natural image dimensions, initialize fit zoom unless the user has already zoomed,
   * and publish displayed dimensions.
   */
  function onPageImageLoad(event) {
    const img = event.target
    baseImageWidth.value = img?.naturalWidth || img?.clientWidth || 1
    baseImageHeight.value = img?.naturalHeight || img?.clientHeight || 1

    if (!hasInitializedZoom.value && !hasManualZoom.value) {
      fitPageToViewportHeight()
      hasInitializedZoom.value = true
    }

    renderedImageWidth.value = imageDisplayWidth.value
    renderedImageHeight.value = imageDisplayHeight.value
  }

  /**
   * Mark zoom as manually controlled and clamp the parsed slider value.
   */
  function onZoomSliderInput(event) {
    hasManualZoom.value = true
    const next = Number.parseFloat(event.target.value)
    zoomLevel.value = clampZoom(next)
  }

  /**
   * Increase zoom by 0.2 within bounds and remember the user's manual zoom preference.
   */
  function zoomIn() {
    hasManualZoom.value = true
    zoomLevel.value = clampZoom(zoomLevel.value + 0.2)
  }

  /**
   * Decrease zoom by 0.2 within bounds and remember the user's manual zoom preference.
   */
  function zoomOut() {
    hasManualZoom.value = true
    zoomLevel.value = clampZoom(zoomLevel.value - 0.2)
  }

  /**
   * Apply smooth exponential wheel zoom while preserving the source point beneath the pointer
   * after Vue updates the layout.
   */
  async function applyTrackpadZoom({ deltaY, clientX, clientY }) {
    if (!overlayPanelRef.value || !Number.isFinite(deltaY)) {
      return
    }

    const panel = overlayPanelRef.value
    const rect = panel.getBoundingClientRect()
    const oldZoom = zoomLevel.value || 1

    // Exponential scaling gives smooth zoom for small trackpad deltas.
    const zoomFactor = Math.exp(-deltaY * 0.01)
    const nextZoom = clampZoom(oldZoom * zoomFactor)
    if (nextZoom === oldZoom) {
      return
    }

    const localX = clientX - rect.left
    const localY = clientY - rect.top
    const anchorX = panel.scrollLeft + localX
    const anchorY = panel.scrollTop + localY

    hasManualZoom.value = true
    zoomLevel.value = nextZoom
    await nextTick()

    const scale = nextZoom / oldZoom
    panel.scrollLeft = Math.max(0, anchorX * scale - localX)
    panel.scrollTop = Math.max(0, anchorY * scale - localY)
  }

  /**
   * Refresh viewport measurements and clamp the current zoom to the resized panel's bounds.
   */
  function onWindowResize() {
    viewportHeight.value = window.innerHeight
    recalculatePanelViewportHeight()
    if (baseImageHeight.value > 0) {
      zoomLevel.value = clampZoom(zoomLevel.value)
    }
  }

  /**
   * Clear manual/initialized zoom flags and return to natural scale before loading another
   * dataset.
   */
  function resetViewportState() {
    hasManualZoom.value = false
    hasInitializedZoom.value = false
    zoomLevel.value = 1
  }

  return {
    renderedImageWidth,
    renderedImageHeight,
    baseImageWidth,
    baseImageHeight,
    zoomLevel,
    hasManualZoom,
    hasInitializedZoom,
    viewportHeight,
    panelViewportHeight,
    imageRef,
    overlayPanelRef,
    imageDisplayWidth,
    imageDisplayHeight,
    fitZoomForViewportHeight,
    recalculatePanelViewportHeight,
    fitPageToViewportHeight,
    onPageImageLoad,
    onZoomSliderInput,
    zoomIn,
    zoomOut,
    applyTrackpadZoom,
    onWindowResize,
    resetViewportState,
  }
}
