/**
 * @file Connect reactive review selection and display scaling to the pure geometry helpers.
 */
import { computed } from 'vue'
import {
  buildSuspiciousCharacterBoxes,
  hasValidBox,
  hasValidPolygon,
  polygonPointsString as formatPolygonPoints,
  shouldRenderPolygon as canRenderPolygon,
} from '../geometry'

/**
 * Derive renderable lines, image scale factors, and suspicious-character rectangles from
 * reactive review state.
 * @param {object} inputs - Selected page/lines, rendered dimensions, overlay flags, and confidence-segment lookup.
 * @returns {object} Computed geometry and polygon-rendering helpers.
 */
export function useReviewGeometry({
  selectedPage,
  selectedPageLines,
  renderedImageWidth,
  renderedImageHeight,
  usePolygonOverlay,
  showSuspiciousHints,
  suspiciousSegmentsForLine,
}) {
  const linesWithGeometry = computed(() => {
    if (!selectedPage.value || !Array.isArray(selectedPage.value.lines)) {
      return []
    }
    return selectedPage.value.lines.filter(
      (line) => hasValidPolygon(line.polygon_points) || hasValidBox(line.bounding_box)
    )
  })

  const boxScaleX = computed(() => {
    if (!selectedPage.value?.width || renderedImageWidth.value <= 0) {
      return 1
    }
    return renderedImageWidth.value / selectedPage.value.width
  })

  const boxScaleY = computed(() => {
    if (!selectedPage.value?.height || renderedImageHeight.value <= 0) {
      return 1
    }
    return renderedImageHeight.value / selectedPage.value.height
  })

  const suspiciousCharBoxes = computed(() => {
    if (!showSuspiciousHints.value) {
      return []
    }
    return buildSuspiciousCharacterBoxes(selectedPageLines.value, suspiciousSegmentsForLine, {
      usePolygonOverlay: usePolygonOverlay.value,
    })
  })

  return {
    linesWithGeometry,
    boxScaleX,
    boxScaleY,
    suspiciousCharBoxes,
    /**
     * Choose polygon rendering for a line using the current overlay preference and available
     * geometry.
     */
    shouldRenderPolygon: (line) => canRenderPolygon(line, usePolygonOverlay.value),
    /**
     * Format source polygon points for SVG using the current horizontal and vertical image
     * scale factors.
     */
    polygonPointsString: (points) => formatPolygonPoints(points, boxScaleX.value, boxScaleY.value),
  }
}
