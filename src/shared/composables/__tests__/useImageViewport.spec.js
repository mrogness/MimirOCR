import { useImageViewport } from '../useImageViewport'

function viewport() {
  const api = useImageViewport()
  api.overlayPanelRef.value = {
    clientWidth: 500, clientHeight: 600, scrollLeft: 100, scrollTop: 200,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  }
  return api
}

describe('image viewport interactions', () => {
  it('fits a loaded page using natural dimensions and keeps rendered scales consistent', () => {
    const api = viewport()
    api.onPageImageLoad({ target: { naturalWidth: 1000, naturalHeight: 2000 } })
    expect(api.zoomLevel.value).toBe(0.3)
    expect(api.imageDisplayWidth.value).toBe(300)
    expect(api.renderedImageWidth.value).toBe(300)
    expect(api.renderedImageHeight.value).toBe(600)
    api.onZoomSliderInput({ target: { value: '2' } })
    api.onPageImageLoad({ target: { naturalWidth: 1000, naturalHeight: 2000 } })
    expect(api.zoomLevel.value).toBe(2)
  })

  it('bounds zoom and resets manual zoom for a different dataset', () => {
    const api = viewport()
    api.baseImageWidth.value = 1000
    api.baseImageHeight.value = 2000
    api.onZoomSliderInput({ target: { value: '99' } })
    expect(api.zoomLevel.value).toBe(3)
    api.onZoomSliderInput({ target: { value: '-9' } })
    expect(api.zoomLevel.value).toBe(0.3)
    api.resetViewportState()
    expect(api.hasManualZoom.value).toBe(false)
    expect(api.hasInitializedZoom.value).toBe(false)
    expect(api.zoomLevel.value).toBe(1)
  })

  it('keeps the pointer anchor stable while trackpad zoom changes scroll offsets', async () => {
    const api = viewport()
    await api.applyTrackpadZoom({ deltaY: -Math.log(2) * 100, clientX: 60, clientY: 70 })
    expect(api.zoomLevel.value).toBe(2)
    expect(api.overlayPanelRef.value.scrollLeft).toBe(250)
    expect(api.overlayPanelRef.value.scrollTop).toBe(450)
    await api.applyTrackpadZoom({ deltaY: NaN, clientX: 0, clientY: 0 })
    expect(api.zoomLevel.value).toBe(2)
  })
})
