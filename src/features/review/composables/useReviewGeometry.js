import { computed } from 'vue'
import {
  buildSuspiciousCharacterBoxes,
  hasValidBox,
  hasValidPolygon,
  polygonPointsString as formatPolygonPoints,
  shouldRenderPolygon as canRenderPolygon,
} from '../geometry'

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
    shouldRenderPolygon: (line) => canRenderPolygon(line, usePolygonOverlay.value),
    polygonPointsString: (points) => formatPolygonPoints(points, boxScaleX.value, boxScaleY.value),
  }
}
