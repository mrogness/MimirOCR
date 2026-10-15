import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref, unref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PageImageOverlay from '../PageImageOverlay.vue'
import { useReviewGeometry } from '../../composables/useReviewGeometry'

function setup() {
  const selectedPage = ref({ width: 400, height: 800, lines: [{
    id: 7,
    bounding_box: { x_min: 10, y_min: 20, x_max: 210, y_max: 40 },
    polygon_points: [[10, 20], [210, 20], [210, 40]],
    char_positions: [{ start: 0, end: 10 }, { start: 10, end: 100 }],
  }] })
  const state = {
    selectedPage,
    selectedPageLines: computed(() => selectedPage.value.lines),
    renderedImageWidth: ref(200), renderedImageHeight: ref(200),
    usePolygonOverlay: ref(true), showSuspiciousHints: ref(true),
    suspiciousSegmentsForLine: () => [{ suspicious: true }, { suspicious: false }],
  }
  const geometry = useReviewGeometry(state)
  const wrapper = mount(defineComponent({
    setup: () => () => h(PageImageOverlay, {
      ...Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, unref(value)])),
      selectedPage: selectedPage.value,
      selectedPageImageUrl: '/page.png',
      setImageRef: vi.fn(), setOverlayPanelRef: vi.fn(),
      imageDisplayWidth: 200, imageDisplayHeight: 200, panelViewportHeight: 200,
      renderedImageWidth: state.renderedImageWidth.value,
      renderedImageHeight: state.renderedImageHeight.value,
      zoomLevel: 0.5, usePolygonOverlay: state.usePolygonOverlay.value,
      overlayLineClass: () => '',
      'onUpdate:usePolygonOverlay': (enabled) => { state.usePolygonOverlay.value = enabled },
    }),
  }))
  return { state, overlay: wrapper.findComponent(PageImageOverlay) }
}

describe('review geometry rendered by PageImageOverlay', () => {
  it('scales polygons and suspicious markers once, preserving line selection events', async () => {
    const { overlay } = setup()
    const polygon = overlay.get('svg > polygon')
    expect(polygon.attributes('points')).toBe('5,5 105,5 105,10')
    const marker = overlay.get('rect[pointer-events="none"]')
    expect(marker.attributes()).toMatchObject({ x: '5', y: '5', width: '10', height: '5', 'clip-path': 'url(#line-clip-7)' })
    await polygon.trigger('mouseenter')
    await polygon.trigger('click')
    expect(overlay.emitted('set-active-line')).toEqual([[7]])
    expect(overlay.emitted('select-line')).toEqual([[7]])
  })

  it('switches to scaled boxes and even marker placement through the visible toggle', async () => {
    const { overlay } = setup()
    await overlay.get('input[type="checkbox"]').setValue(false)
    expect(overlay.find('svg > polygon').exists()).toBe(false)
    expect(overlay.get('svg > rect:not([pointer-events])').attributes()).toMatchObject({ x: '5', y: '5', width: '100', height: '5' })
    expect(overlay.get('clipPath rect').attributes()).toMatchObject({ x: '5', y: '5', width: '100', height: '5' })
    expect(overlay.get('rect[pointer-events="none"]').attributes('width')).toBe('50')
    expect(overlay.emitted('update:usePolygonOverlay')).toEqual([[false]])
  })
})
