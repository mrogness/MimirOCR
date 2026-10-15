import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useReviewGeometry } from '../useReviewGeometry'

function setup() {
  const selectedPage = ref({ width: 400, height: 800, lines: [{
    id: 1,
    bounding_box: { x_min: 0, y_min: 20, x_max: 200, y_max: 40 },
    polygon_points: [[0, 20], [200, 20], [200, 40]],
    char_positions: [{ start: 0, end: 10 }, { start: 10, end: 100 }],
  }] })
  const state = {
    selectedPage,
    selectedPageLines: computed(() => selectedPage.value?.lines || []),
    renderedImageWidth: ref(200), renderedImageHeight: ref(200),
    usePolygonOverlay: ref(true), showSuspiciousHints: ref(true),
    suspiciousSegmentsForLine: vi.fn(() => [{ suspicious: true }, { suspicious: false }]),
  }
  return { state, geometry: useReviewGeometry(state) }
}

describe('reactive review geometry', () => {
  it('recomputes display scale on image resize and page selection, with safe initial scales', () => {
    const { state, geometry } = setup()
    expect(geometry.boxScaleX.value).toBe(0.5)
    expect(geometry.boxScaleY.value).toBe(0.25)
    expect(geometry.polygonPointsString([[10, 20]])).toBe('5,5')
    state.renderedImageWidth.value = 400
    state.renderedImageHeight.value = 800
    expect(geometry.polygonPointsString([[10, 20]])).toBe('10,20')
    state.selectedPage.value = { width: 800, height: 1600, lines: [] }
    expect(geometry.boxScaleX.value).toBe(0.5)
    expect(geometry.boxScaleY.value).toBe(0.5)
    state.renderedImageWidth.value = 0
    state.renderedImageHeight.value = 0
    expect(geometry.boxScaleX.value).toBe(1)
    expect(geometry.boxScaleY.value).toBe(1)
    state.selectedPage.value = null
    expect(geometry.linesWithGeometry.value).toEqual([])
  })

  it('reacts to overlay mode and hint visibility without analyzing hidden markers', () => {
    const { state, geometry } = setup()
    const line = state.selectedPage.value.lines[0]
    expect(geometry.shouldRenderPolygon(line)).toBe(true)
    expect(geometry.suspiciousCharBoxes.value[0].width).toBe(20)
    state.usePolygonOverlay.value = false
    expect(geometry.shouldRenderPolygon(line)).toBe(false)
    expect(geometry.suspiciousCharBoxes.value[0].width).toBe(100)
    state.suspiciousSegmentsForLine.mockClear()
    state.showSuspiciousHints.value = false
    expect(geometry.suspiciousCharBoxes.value).toEqual([])
    expect(state.suspiciousSegmentsForLine).not.toHaveBeenCalled()
    state.showSuspiciousHints.value = true
    expect(geometry.suspiciousCharBoxes.value).toHaveLength(1)
  })

  it('updates drawable lines and marker placement after page data changes', () => {
    const { state, geometry } = setup()
    expect(geometry.linesWithGeometry.value).toHaveLength(1)
    expect(geometry.suspiciousCharBoxes.value[0].width).toBe(20)
    state.selectedPage.value.lines[0].char_positions[0].end = 50
    expect(geometry.suspiciousCharBoxes.value[0].width).toBe(100)
    state.selectedPage.value.lines.push({ id: 2 }, {
      id: 3, polygon_points: [[0, 0], [1, 0], [1, 1]],
    })
    expect(geometry.linesWithGeometry.value.map((line) => line.id)).toEqual([1, 3])
    state.selectedPage.value = { lines: null }
    expect(geometry.linesWithGeometry.value).toEqual([])
    expect(geometry.suspiciousCharBoxes.value).toEqual([])
  })
})
