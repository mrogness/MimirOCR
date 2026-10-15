<script setup>
import { computed, nextTick, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ExportSettingsSheet from './components/ExportSettingsSheet.vue'
import PageImageOverlay from './components/PageImageOverlay.vue'
import PredictedTextPanel from './components/PredictedTextPanel.vue'
import ReviewTopBar from './components/ReviewTopBar.vue'
import { useExportPdf } from './composables/useExportPdf'
import { useLineEditing } from './composables/useLineEditing'
import { useProjectReviewData } from './composables/useProjectReviewData'
import { useImageViewport } from '../../shared/composables/useImageViewport'
import { useReviewGeometry } from './composables/useReviewGeometry'
import { useSuspiciousAnalysis } from './composables/useSuspiciousAnalysis'
import { backendFetch, getBackendBaseUrl } from '../../shared/services/backend'

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
} = useExportPdf({ projectId, backendFetch, beforeExport: () => flushPendingSaves() })

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
} = useImageViewport()

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
  selectPage,
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

const {
  linesWithGeometry,
  boxScaleX,
  boxScaleY,
  suspiciousCharBoxes,
  shouldRenderPolygon,
  polygonPointsString,
} = useReviewGeometry({
  selectedPage,
  selectedPageLines,
  renderedImageWidth,
  renderedImageHeight,
  usePolygonOverlay,
  showSuspiciousHints,
  suspiciousSegmentsForLine,
})

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
  canUndo,
  undoLabel,
  isUndoing,
  undoErrorMessage,
  undoLastAction,
  clearUndoHistory,
  clearPendingTimers,
  flushPendingSaves,
} = useLineEditing({
  selectedPage,
  pages,
  selectedLineId,
  activeLineId,
  backendFetch,
  refreshPagesPreservingSelection,
  selectPageById: (pageId) => {
    const pageIndex = pages.value.findIndex((page) => page.id === pageId)
    if (pageIndex >= 0) {
      selectPage(pageIndex)
    }
  },
})

function buildDatasetSignature(sourcePages) {
  if (!Array.isArray(sourcePages)) {
    return ''
  }

  return sourcePages
    .map((page) => {
      const lineIds = Array.isArray(page.lines)
        ? [...page.lines].map((line) => line.id).sort((a, b) => a - b).join(',')
        : ''
      return `${page.id}:${lineIds}`
    })
    .sort()
    .join('|')
}

function onWindowKeydownForUndo(event) {
  const usesUndoShortcut =
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'z'

  if (!usesUndoShortcut || !canUndo.value) {
    return
  }

  event.preventDefault()
  undoLastAction()
}

const previousDatasetSignature = ref('')

watch(
  () => pages.value,
  (nextPages, previousPages) => {
    const nextSignature = buildDatasetSignature(nextPages)
    if (!Array.isArray(previousPages) || previousPages.length === 0) {
      previousDatasetSignature.value = nextSignature
      return
    }

    if (previousDatasetSignature.value && nextSignature !== previousDatasetSignature.value) {
      clearUndoHistory()
    }
    previousDatasetSignature.value = nextSignature
  }
)

watch(
  () => projectId.value,
  async (nextId, previousId) => {
    if (nextId === previousId) {
      return
    }

    clearPendingTimers()
    clearUndoHistory()
    previousDatasetSignature.value = ''

    await loadReviewData()
    await nextTick()
    recalculatePanelViewportHeight()
    previousDatasetSignature.value = buildDatasetSignature(pages.value)
  }
)

function overlayLineClass(line) {
  if (line.id === activeLineId.value || line.id === selectedLineId.value) {
    return 'stroke-amber-500 fill-amber-300/20'
  }

  return 'stroke-emerald-500/80 fill-transparent'
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
  window.addEventListener('keydown', onWindowKeydownForUndo)
  await loadReviewData()
  await nextTick()
  recalculatePanelViewportHeight()
  previousDatasetSignature.value = buildDatasetSignature(pages.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onWindowKeydownForUndo)
  clearPendingTimers()
  clearUndoHistory()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4  overflow-y-auto ">
    <section class="flex shrink-0 items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold">Output Review</h1>
        <p class="text-sm text-brand-500"></p>
      </div>
      <button class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
        @click="backToProject">
        Back to Project Workspace
      </button>
    </section>

    <section v-if="isLoading" class="shrink-0 rounded border border-brand-200 bg-white p-4 text-brand-600">
      Loading review data...
    </section>

    <section v-else-if="errorMessage" class="shrink-0 rounded border border-red-200 bg-red-50 p-4 text-red-700">
      {{ errorMessage }}
    </section>

    <section v-else-if="pages.length === 0"
      class="shrink-0 rounded border border-brand-200 bg-white p-4 text-brand-700">
      No OCR pages stored yet. Run OCR from the project page first.
    </section>

    <section v-else class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <ReviewTopBar :selected-page-index="selectedPageIndex" :total-pages="totalPages"
        :page-input-value="pageInputValue" :can-undo="canUndo" :is-undoing="isUndoing" :undo-label="undoLabel"
        :undo-error-message="undoErrorMessage" :is-exporting="isExporting" :export-error-message="exportErrorMessage"
        :export-success-message="exportSuccessMessage" @update:page-input-value="pageInputValue = $event"
        @first-page="goToFirstPage" @previous-page="goToPreviousPage" @next-page="goToNextPage"
        @last-page="goToLastPage" @commit-page-input="commitPageInput" @undo="undoLastAction"
        @open-export-settings="showExportSettings = true"
        @export-pdf="exportProjectPdf" />

      <ExportSettingsSheet :show="showExportSettings" :settings="exportSettings" :is-exporting="isExporting"
        @close="showExportSettings = false" @export-pdf="exportProjectPdf" @export-training-data="exportTrainingData" />

      <div v-if="selectedPage" class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <PageImageOverlay :selected-page="selectedPage" :selected-page-image-url="selectedPageImageUrl"
          :set-image-ref="setImageRef" :set-overlay-panel-ref="setOverlayPanelRef"
          :image-display-width="imageDisplayWidth" :image-display-height="imageDisplayHeight"
          :rendered-image-width="renderedImageWidth" :rendered-image-height="renderedImageHeight"
          :panel-viewport-height="panelViewportHeight" :zoom-level="zoomLevel" :use-polygon-overlay="usePolygonOverlay"
          :lines-with-geometry="linesWithGeometry" :box-scale-x="boxScaleX" :box-scale-y="boxScaleY"
          :should-render-polygon="shouldRenderPolygon" :polygon-points-string="polygonPointsString"
          :overlay-line-class="overlayLineClass" :suspicious-char-boxes="suspiciousCharBoxes"
          :active-suspicious-box-id="activeSuspiciousBoxId" @update:use-polygon-overlay="usePolygonOverlay = $event"
          @zoom-out="zoomOut" @zoom-slider-input="onZoomSliderInput" @zoom-in="zoomIn"
          @trackpad-zoom="applyTrackpadZoom" @fit-page-height="fitPageToViewportHeight"
          @clear-active-line="clearActiveLine" @set-active-line="setActiveLine" @select-line="selectLine"
          @page-image-load="onPageImageLoad" />

        <PredictedTextPanel :selected-page-lines="selectedPageLines" :active-line-id="activeLineId"
          :selected-line-id="selectedLineId" :line-save-state="lineSaveState"
          :show-suspicious-hints="showSuspiciousHints" :suspicious-threshold="suspiciousThreshold"
          :suspicious-count="suspiciousTargets.length" :current-suspicious-index="currentSuspiciousIndex"
          :panel-viewport-height="panelViewportHeight" :line-has-suspicious-chars="lineHasSuspiciousChars"
          :suspicious-segments-for-line="suspiciousSegmentsForLine" :row-ref-fn="setLineRowRef"
          @update:show-suspicious-hints="showSuspiciousHints = $event"
          @update:suspicious-threshold="suspiciousThreshold = $event" @next-suspicious="goToNextSuspiciousCharacter"
          @set-active-line="setActiveLine" @clear-active-line="clearActiveLine" @select-line="selectLine"
          @move-line="moveLine" @commit-line-order-input="commitLineOrderInput" @delete-line="deleteLine"
          @line-input="onLineInput" />
      </div>
    </section>
  </div>
</template>
