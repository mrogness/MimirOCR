<script setup>
import { computed, nextTick, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ExportSettingsSheet from '../components/review/ExportSettingsSheet.vue'
import PageImageOverlay from '../components/review/PageImageOverlay.vue'
import PredictedTextPanel from '../components/review/PredictedTextPanel.vue'
import ReviewTopBar from '../components/review/ReviewTopBar.vue'
import { useExportPdf } from '../composables/review/useExportPdf'
import { useLineEditing } from '../composables/review/useLineEditing'
import { useProjectReviewData } from '../composables/review/useProjectReviewData'
import { useReviewViewport } from '../composables/review/useReviewViewport'
import { useSuspiciousAnalysis } from '../composables/review/useSuspiciousAnalysis'
import { backendFetch, getBackendBaseUrl } from '../services/backend'

const route = useRoute()
const router = useRouter()

const projectId = computed(() => route.params.id)
const showSuspiciousHints = ref(true)
const suspiciousThreshold = ref(0.97)
const activeSuspiciousBoxId = ref(null)

const usePolygonOverlay = ref(true)
const {
  isExporting,
  showExportSettings,
  exportErrorMessage,
  exportSuccessMessage,
  exportSettings,
  exportProjectPdf,
  exportTrainingData,
} = useExportPdf({ projectId, backendFetch })

const {
  renderedImageWidth,
  renderedImageHeight,
  baseImageWidth,
  baseImageHeight,
  zoomLevel,
  panelViewportHeight,
  imageRef,
  overlayPanelRef,
  imageDisplayWidth,
  imageDisplayHeight,
  recalculatePanelViewportHeight,
  fitPageToViewportHeight,
  onPageImageLoad,
  onZoomSliderInput,
  zoomIn,
  zoomOut,
  applyTrackpadZoom,
  onWindowResize,
  resetViewportState,
} = useReviewViewport()

const {
  backendBaseUrl,
  pages,
  isLoading,
  errorMessage,
  selectedPageIndex,
  pageInputValue,
  activeLineId,
  selectedLineId,
  selectedPage,
  selectedPageLines,
  totalPages,
  currentPageNumber,
  selectedPageImageUrl,
  loadReviewData,
  refreshPagesPreservingSelection,
  goToFirstPage,
  goToPreviousPage,
  goToNextPage,
  goToLastPage,
  commitPageInput,
  setActiveLine,
  clearActiveLine,
  selectLine,
} = useProjectReviewData({
  projectId,
  backendFetch,
  getBackendBaseUrl,
  resetViewportState,
})

const lineRowRefs = new Map()

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

function setLineRowRef(lineId, el) {
  if (!lineId) {
    return
  }

  if (el) {
    lineRowRefs.set(lineId, el)
  } else {
    lineRowRefs.delete(lineId)
  }
}

function setImageRef(el) {
  imageRef.value = el
}

function setOverlayPanelRef(el) {
  overlayPanelRef.value = el
}

function scrollToSelectedLine() {
  const lineId = selectedLineId.value
  if (!lineId) {
    return
  }

  const rowEl = lineRowRefs.get(lineId)
  if (!rowEl) {
    return
  }

  rowEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

const {
  lineHasSuspiciousChars,
  suspiciousSegmentsForLine,
} = useSuspiciousAnalysis(selectedPageLines, suspiciousThreshold, { enabled: showSuspiciousHints })

const suspiciousTargets = computed(() => {
  if (!showSuspiciousHints.value) {
    return []
  }

  const targets = []
  for (const line of selectedPageLines.value) {
    const segments = suspiciousSegmentsForLine(line)
    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      if (!segments[segIndex]?.suspicious) {
        continue
      }
      targets.push({
        id: `${line.id}-${segIndex}`,
        lineId: line.id,
      })
    }
  }

  return targets
})

const currentSuspiciousIndex = computed(() => {
  if (!activeSuspiciousBoxId.value) {
    return 0
  }
  const idx = suspiciousTargets.value.findIndex((target) => target.id === activeSuspiciousBoxId.value)
  return idx >= 0 ? idx + 1 : 0
})

function goToNextSuspiciousCharacter() {
  const targets = suspiciousTargets.value
  if (!targets.length) {
    activeSuspiciousBoxId.value = null
    return
  }

  const currentIdx = activeSuspiciousBoxId.value
    ? targets.findIndex((target) => target.id === activeSuspiciousBoxId.value)
    : -1
  const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % targets.length : 0
  const target = targets[nextIdx]

  activeSuspiciousBoxId.value = target.id
  setActiveLine(target.lineId)
  selectLine(target.lineId)
}

const {
  lineSaveState,
  onLineInput,
  moveLine,
  commitLineOrderInput,
  deleteLine,
  clearPendingTimers,
} = useLineEditing({
  selectedPage,
  pages,
  selectedLineId,
  activeLineId,
  backendFetch,
  refreshPagesPreservingSelection,
})

function overlayLineClass(line) {
  if (line.id === activeLineId.value || line.id === selectedLineId.value) {
    return 'stroke-amber-500 fill-amber-300/20'
  }

  return 'stroke-emerald-500/80 fill-transparent'
}

function normalizeCharPositions(raw) {
  if (Array.isArray(raw)) {
    return raw
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_err) {
    return []
  }
}

function toFinite(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeConfidence(value) {
  const n = toFinite(value)
  if (n == null) {
    return null
  }
  if (n > 1 && n <= 100) {
    return n / 100
  }
  return n
}

function buildGeometricCharacterBounds(positions, options = {}) {
  const spanDomain = options.spanDomain
  const minStart = options.minStart
  const positionSpan = options.positionSpan
  const hasUsableSpan = options.hasUsableSpan

  const bounds = new Map()
  for (let index = 0; index < positions.length; index += 1) {
    const pos = positions[index] || {}
    const start =
      toFinite(pos.start) ??
      toFinite(pos.global_start_ext) ??
      toFinite(pos.global_start) ??
      toFinite(pos.local_start)
    const end =
      toFinite(pos.end) ??
      toFinite(pos.global_end_ext) ??
      toFinite(pos.global_end) ??
      toFinite(pos.local_end)

    if (start == null || end == null) {
      continue
    }

    const lowRaw = Math.min(start, end)
    const highRaw = Math.max(start, end)

    let lowNorm = null
    let highNorm = null

    // Prefer observed span normalization to avoid residual line-level drift when
    // model coordinates do not start at 0 or do not end at domain.
    if (hasUsableSpan && minStart != null && positionSpan != null && positionSpan > 0) {
      lowNorm = (lowRaw - minStart) / positionSpan
      highNorm = (highRaw - minStart) / positionSpan
    } else if (spanDomain != null && spanDomain > 0) {
      lowNorm = lowRaw / spanDomain
      highNorm = highRaw / spanDomain
    }

    if (lowNorm == null || highNorm == null) {
      continue
    }

    const left = Math.max(0, Math.min(1, lowNorm))
    const right = Math.max(0, Math.min(1, highNorm))
    if (right <= left) {
      continue
    }

    bounds.set(index, { low: left, high: right })
  }

  return bounds
}

function widenedRangeWithinNeighbors(boundsMap, index, minWidthNorm) {
  const current = boundsMap.get(index)
  if (!current) {
    return null
  }

  let left = current.low
  let right = current.high
  if (right <= left || !Number.isFinite(minWidthNorm) || minWidthNorm <= 0) {
    return { left, right }
  }

  const width = right - left
  if (width >= minWidthNorm) {
    return { left, right }
  }

  const prev = boundsMap.get(index - 1)
  const next = boundsMap.get(index + 1)
  const leftLimit = prev ? (prev.high + left) / 2 : 0
  const rightLimit = next ? (right + next.low) / 2 : 1

  if (rightLimit <= leftLimit) {
    return { left, right }
  }

  const center = (left + right) / 2
  let targetLeft = center - minWidthNorm / 2
  let targetRight = center + minWidthNorm / 2

  targetLeft = Math.max(leftLimit, targetLeft)
  targetRight = Math.min(rightLimit, targetRight)

  if (targetRight - targetLeft < minWidthNorm) {
    const available = rightLimit - leftLimit
    if (available <= 0) {
      return { left, right }
    }
    if (available <= minWidthNorm) {
      targetLeft = leftLimit
      targetRight = rightLimit
    } else {
      targetLeft = Math.max(leftLimit, Math.min(targetLeft, rightLimit - minWidthNorm))
      targetRight = targetLeft + minWidthNorm
    }
  }

  left = Math.max(0, Math.min(1, targetLeft))
  right = Math.max(0, Math.min(1, targetRight))
  if (right <= left) {
    return { low: current.low, high: current.high }
  }
  return { left, right }
}

const suspiciousCharBoxes = computed(() => {
  if (!showSuspiciousHints.value) {
    return []
  }

  const rows = []
  for (const line of selectedPageLines.value) {
    if (!hasValidBox(line.bounding_box)) {
      continue
    }

    const effectivePositions = normalizeCharPositions(line.char_positions)
    if (!effectivePositions.length) {
      continue
    }

    const segments = suspiciousSegmentsForLine(line)
    if (!segments.length) {
      continue
    }

    const lineWidth = line.bounding_box.x_max - line.bounding_box.x_min
    const lineHeight = line.bounding_box.y_max - line.bounding_box.y_min
      const useGeometricMode = usePolygonOverlay.value

    if (!Number.isFinite(lineWidth) || lineWidth <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0) {
      continue
    }

    const normalizedBounds = effectivePositions
      .map((pos) => {
        const start =
          toFinite(pos.start) ??
          toFinite(pos.global_start_ext) ??
          toFinite(pos.global_start) ??
          toFinite(pos.local_start)
        const end =
          toFinite(pos.end) ??
          toFinite(pos.global_end_ext) ??
          toFinite(pos.global_end) ??
          toFinite(pos.local_end)
        if (start == null || end == null) {
          return null
        }
        const low = Math.min(start, end)
        const high = Math.max(start, end)
        if (!Number.isFinite(low) || !Number.isFinite(high)) {
          return null
        }
        return { low, high }
      })
      .filter((entry) => entry != null)

    const minStart = normalizedBounds.length ? Math.min(...normalizedBounds.map((b) => b.low)) : null
    const maxEnd = normalizedBounds.length ? Math.max(...normalizedBounds.map((b) => b.high)) : null
    const positionSpan =
      minStart != null && maxEnd != null && maxEnd > minStart
        ? maxEnd - minStart
        : null
    const hasUsableSpan = positionSpan != null && positionSpan > 0

    const domainCandidates = effectivePositions
      .map((pos) => toFinite(pos.domain) ?? toFinite(pos.logits_length) ?? toFinite(pos.total_steps))
      .filter((v) => v != null && v > 0)
    const spanDomain = domainCandidates.length ? domainCandidates[0] : null
    const geometricBounds = buildGeometricCharacterBounds(effectivePositions, {
      spanDomain,
      minStart,
      positionSpan,
      hasUsableSpan,
    })
    const minCharBoxWidthNorm = Math.min(0.08, 12 / lineWidth)

    const count = Math.min(segments.length, effectivePositions.length)
    for (let segIndex = 0; segIndex < count; segIndex += 1) {
      const safePosIndex = segIndex
      const pos = effectivePositions[safePosIndex] || {}

      const segmentSuspicious = Boolean(segments[segIndex]?.suspicious)
      if (!segmentSuspicious) {
        continue
      }

      let leftNorm = null
      let rightNorm = null

      if (useGeometricMode && geometricBounds.has(safePosIndex)) {
        const bound = geometricBounds.get(safePosIndex)
        leftNorm = bound.low
        rightNorm = bound.high
        const widened = widenedRangeWithinNeighbors(geometricBounds, safePosIndex, minCharBoxWidthNorm)
        if (widened) {
          leftNorm = widened.left
          rightNorm = widened.right
        }
      }

      // Fallback mode: distribute characters evenly across the line bbox.
      // This is used when geometric mode is off, or when position spans are
      // degenerate/unusable for geometric placement.
      if (leftNorm == null || rightNorm == null) {
        const countForLayout = Math.max(1, effectivePositions.length)
        leftNorm = safePosIndex / countForLayout
        rightNorm = (safePosIndex + 1) / countForLayout
      }

      rows.push({
        id: `${line.id}-${segIndex}`,
        lineId: line.id,
        x: line.bounding_box.x_min + leftNorm * lineWidth,
        y: line.bounding_box.y_min,
        width: (rightNorm - leftNorm) * lineWidth,
        height: lineHeight,
      })
    }
  }

  return rows
})

function hasValidBox(bbox) {
  return (
    bbox &&
    Number.isFinite(bbox.x_min) &&
    Number.isFinite(bbox.y_min) &&
    Number.isFinite(bbox.x_max) &&
    Number.isFinite(bbox.y_max)
  )
}

function hasValidPolygon(points) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
  )
}

function shouldRenderPolygon(line) {
  if (usePolygonOverlay.value && hasValidPolygon(line.polygon_points)) {
    return true
  }
  return !hasValidBox(line.bounding_box) && hasValidPolygon(line.polygon_points)
}

function polygonPointsString(points) {
  return points
    .map((pt) => `${pt[0] * boxScaleX.value},${pt[1] * boxScaleY.value}`)
    .join(' ')
}

function boxStyle(bbox) {
  return {
    left: `${bbox.x_min * boxScaleX.value}px`,
    top: `${bbox.y_min * boxScaleY.value}px`,
    width: `${(bbox.x_max - bbox.x_min) * boxScaleX.value}px`,
    height: `${(bbox.y_max - bbox.y_min) * boxScaleY.value}px`
  }
}

watch(zoomLevel, async () => {
  await nextTick()
  if (imageRef.value) {
    renderedImageWidth.value = imageRef.value.clientWidth || imageDisplayWidth.value
    renderedImageHeight.value = imageRef.value.clientHeight || imageDisplayHeight.value
  }
})

watch(selectedPageIndex, () => {
  pageInputValue.value = String(currentPageNumber.value)
  lineRowRefs.clear()
  activeSuspiciousBoxId.value = null
  nextTick(() => {
    recalculatePanelViewportHeight()
  })
})

watch(suspiciousTargets, (targets) => {
  if (!targets.length) {
    activeSuspiciousBoxId.value = null
    return
  }
  if (!activeSuspiciousBoxId.value) {
    return
  }
  const stillExists = targets.some((target) => target.id === activeSuspiciousBoxId.value)
  if (!stillExists) {
    activeSuspiciousBoxId.value = null
  }
})

watch(selectedLineId, async () => {
  await nextTick()
  scrollToSelectedLine()
})

function backToProject() {
  router.push({ name: 'projectDetail', params: { id: projectId.value } })
}

onErrorCaptured((error) => {
  console.error('projectReviewView runtime error', error)
  errorMessage.value = `Review screen error: ${String(error)}`
  isLoading.value = false
  return false
})

onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  await loadReviewData()
  await nextTick()
  recalculatePanelViewportHeight()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  clearPendingTimers()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
    <section class="flex shrink-0 items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold">Output Review</h1>
        <p class="text-sm text-brand-500"></p>
      </div>
      <button
        class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
        @click="backToProject"
      >
        Back to Project Workspace
      </button>
    </section>

    <section v-if="isLoading" class="shrink-0 rounded border border-brand-200 bg-white p-4 text-brand-600">
      Loading review data...
    </section>

    <section v-else-if="errorMessage" class="shrink-0 rounded border border-red-200 bg-red-50 p-4 text-red-700">
      {{ errorMessage }}
    </section>

    <section v-else-if="pages.length === 0" class="shrink-0 rounded border border-brand-200 bg-white p-4 text-brand-700">
      No OCR pages stored yet. Run OCR from the project page first.
    </section>

    <section v-else class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <ReviewTopBar
        :selected-page-index="selectedPageIndex"
        :total-pages="totalPages"
        :page-input-value="pageInputValue"
        :is-exporting="isExporting"
        :export-error-message="exportErrorMessage"
        :export-success-message="exportSuccessMessage"
        @update:page-input-value="pageInputValue = $event"
        @first-page="goToFirstPage"
        @previous-page="goToPreviousPage"
        @next-page="goToNextPage"
        @last-page="goToLastPage"
        @commit-page-input="commitPageInput"
        @open-export-settings="showExportSettings = true"
        @export-pdf="exportProjectPdf"
      />

      <ExportSettingsSheet
        :show="showExportSettings"
        :settings="exportSettings"
        :is-exporting="isExporting"
        @close="showExportSettings = false"
        @export-pdf="exportProjectPdf"
        @export-training-data="exportTrainingData"
      />

      <div v-if="selectedPage" class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <PageImageOverlay
          :selected-page="selectedPage"
          :selected-page-image-url="selectedPageImageUrl"
          :set-image-ref="setImageRef"
          :set-overlay-panel-ref="setOverlayPanelRef"
          :image-display-width="imageDisplayWidth"
          :image-display-height="imageDisplayHeight"
          :rendered-image-width="renderedImageWidth"
          :rendered-image-height="renderedImageHeight"
          :panel-viewport-height="panelViewportHeight"
          :zoom-level="zoomLevel"
          :use-polygon-overlay="usePolygonOverlay"
          :lines-with-geometry="linesWithGeometry"
          :box-scale-x="boxScaleX"
          :box-scale-y="boxScaleY"
          :should-render-polygon="shouldRenderPolygon"
          :polygon-points-string="polygonPointsString"
          :overlay-line-class="overlayLineClass"
          :suspicious-char-boxes="suspiciousCharBoxes"
          :active-suspicious-box-id="activeSuspiciousBoxId"
          @update:use-polygon-overlay="usePolygonOverlay = $event"
          @zoom-out="zoomOut"
          @zoom-slider-input="onZoomSliderInput"
          @zoom-in="zoomIn"
          @trackpad-zoom="applyTrackpadZoom"
          @fit-page-height="fitPageToViewportHeight"
          @clear-active-line="clearActiveLine"
          @set-active-line="setActiveLine"
          @select-line="selectLine"
          @page-image-load="onPageImageLoad"
        />

        <PredictedTextPanel
          :selected-page-lines="selectedPageLines"
          :active-line-id="activeLineId"
          :selected-line-id="selectedLineId"
          :line-save-state="lineSaveState"
          :show-suspicious-hints="showSuspiciousHints"
          :suspicious-threshold="suspiciousThreshold"
          :suspicious-count="suspiciousTargets.length"
          :current-suspicious-index="currentSuspiciousIndex"
          :panel-viewport-height="panelViewportHeight"
          :line-has-suspicious-chars="lineHasSuspiciousChars"
          :suspicious-segments-for-line="suspiciousSegmentsForLine"
          :row-ref-fn="setLineRowRef"
          @update:show-suspicious-hints="showSuspiciousHints = $event"
          @update:suspicious-threshold="suspiciousThreshold = $event"
          @next-suspicious="goToNextSuspiciousCharacter"
          @set-active-line="setActiveLine"
          @clear-active-line="clearActiveLine"
          @select-line="selectLine"
          @move-line="moveLine"
          @commit-line-order-input="commitLineOrderInput"
          @delete-line="deleteLine"
          @line-input="onLineInput"
        />
      </div>
    </section>
  </div>
</template>
