<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'

import { usePdfBinarizationPreview } from '../../composables/preview/usePdfBinarizationPreview'
import { useReviewViewport } from '../../composables/review/useReviewViewport'

const props = defineProps({
  pdfUrl: { type: String, default: '' },
  dpi: { type: [String, Number], default: 300 },
  threshold: { type: [String, Number], default: 170 },
  displayName: { type: String, default: '' },
})

const currentPageNumber = ref(1)
const pageInputValue = ref('1')

let viewportResizeObserver = null

const {
  pageCount,
  previewImageUrl,
  previewAspectRatio,
  isLoadingDocument,
  isRenderingPage,
  isApplyingThreshold,
  errorMessage,
} = usePdfBinarizationPreview({
  pdfUrl: toRef(props, 'pdfUrl'),
  dpi: toRef(props, 'dpi'),
  threshold: toRef(props, 'threshold'),
  pageNumber: currentPageNumber,
})

const {
  zoomLevel,
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

const hasPdfUrl = computed(() => Boolean(String(props.pdfUrl || '').trim()))

const isReadyToShowImage = computed(
  () => hasPdfUrl.value && Boolean(previewImageUrl.value) && !errorMessage.value,
)

const canGoBackward = computed(() => pageCount.value > 0 && currentPageNumber.value > 1)
const canGoForward = computed(
  () => pageCount.value > 0 && currentPageNumber.value < pageCount.value,
)

function setImageRef(el) {
  imageRef.value = el
}

function setOverlayPanelRef(el) {
  overlayPanelRef.value = el
  nextTick(() => {
    recalculatePanelViewportHeight()
  })
}

function onOverlayWheel(event) {
  if (!event.ctrlKey && !event.metaKey) {
    return
  }

  event.preventDefault()
  applyTrackpadZoom({
    deltaY: event.deltaY,
    clientX: event.clientX,
    clientY: event.clientY,
  })
}

function selectPage(page) {
  if (pageCount.value <= 0) {
    currentPageNumber.value = 1
    pageInputValue.value = '1'
    return
  }

  const parsed = Number.parseInt(page, 10)
  const numericPage = Number.isFinite(parsed) ? parsed : 1
  const clamped = Math.max(1, Math.min(numericPage, pageCount.value))

  if (clamped === currentPageNumber.value) {
    pageInputValue.value = String(clamped)
    return
  }

  currentPageNumber.value = clamped
  pageInputValue.value = String(clamped)
  resetViewportState()
}

function goToFirstPage() {
  selectPage(1)
}

function goToPreviousPage() {
  selectPage(currentPageNumber.value - 1)
}

function goToNextPage() {
  selectPage(currentPageNumber.value + 1)
}

function goToLastPage() {
  selectPage(pageCount.value)
}

function onPageInput(event) {
  pageInputValue.value = event.target.value
}

function commitPageInput() {
  const parsed = Number.parseInt(pageInputValue.value, 10)
  if (!Number.isFinite(parsed)) {
    pageInputValue.value = String(currentPageNumber.value)
    return
  }

  selectPage(parsed)
}

watch(
  () => props.pdfUrl,
  (nextUrl, previousUrl) => {
    if (nextUrl === previousUrl) {
      return
    }

    currentPageNumber.value = 1
    pageInputValue.value = '1'
    resetViewportState()
  },
  { immediate: true },
)

watch(pageCount, (nextTotal) => {
  if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
    currentPageNumber.value = 1
    pageInputValue.value = '1'
    return
  }

  if (currentPageNumber.value > nextTotal) {
    currentPageNumber.value = nextTotal
  }

  pageInputValue.value = String(currentPageNumber.value)
})

function attachViewportResizeObserver() {
  if (viewportResizeObserver) {
    viewportResizeObserver.disconnect()
    viewportResizeObserver = null
  }

  if (!overlayPanelRef.value || typeof ResizeObserver === 'undefined') {
    return
  }

  viewportResizeObserver = new ResizeObserver(() => {
    onWindowResize()
  })

  viewportResizeObserver.observe(overlayPanelRef.value)
}

watch(overlayPanelRef, () => {
  attachViewportResizeObserver()
})

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  recalculatePanelViewportHeight()
  attachViewportResizeObserver()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (viewportResizeObserver) {
    viewportResizeObserver.disconnect()
    viewportResizeObserver = null
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden">

    <div class="max-w-full overflow-x-auto rounded border border-brand-300 bg-brand-50 p-2 shadow-sm">
      <div class="flex min-w-max flex-wrap items-center gap-2">
        <button
          class="shrink-0 rounded border border-brand-400 bg-white px-2 py-1 text-xs text-brand-900 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canGoBackward"
          @click="goToFirstPage"
        >
          ⏮
        </button>
        <button
          class="shrink-0 rounded border border-brand-400 bg-white px-2 py-1 text-xs text-brand-900 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canGoBackward"
          @click="goToPreviousPage"
        >
          ◀
        </button>
        <div class="shrink-0 flex items-center gap-1 rounded border border-brand-300 bg-white px-2 py-1 shadow-sm">
          <input
            :value="pageInputValue"
            type="text"
            inputmode="numeric"
            class="w-12 rounded border border-brand-300 bg-white px-1.5 py-0.5 text-xs text-brand-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            @input="onPageInput"
            @keydown.enter.prevent="commitPageInput"
            @blur="commitPageInput"
          />
          <span class="text-xs text-brand-700">/ {{ Math.max(0, pageCount) }}</span>
        </div>
        <button
          class="shrink-0 rounded border border-brand-400 bg-white px-2 py-1 text-xs text-brand-900 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canGoForward"
          @click="goToNextPage"
        >
          ▶
        </button>
        <button
          class="shrink-0 rounded border border-brand-400 bg-white px-2 py-1 text-xs text-brand-900 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canGoForward"
          @click="goToLastPage"
        >
          ⏭
        </button>

        <div class="mx-1 hidden h-5 w-px shrink-0 bg-brand-300 sm:block"></div>

        <button class="shrink-0 rounded border border-brand-400 bg-white px-2 py-1 text-xs text-brand-900 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500" @click="zoomOut">-</button>
        <input
          type="range"
          min="0.1"
          max="3"
          step="0.05"
          class="h-2 w-36 shrink-0 cursor-pointer accent-brand-700"
          :value="zoomLevel"
          @input="onZoomSliderInput"
        />
        <button class="shrink-0 rounded border border-brand-400 bg-white px-2 py-1 text-xs text-brand-900 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500" @click="zoomIn">+</button>
        <span class="shrink-0 text-xs text-brand-700">{{ Math.round(zoomLevel * 100) }}%</span>
        <button
          class="shrink-0 rounded border border-brand-400 bg-brand-700 px-2 py-1 text-xs text-white shadow-sm hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          @click="fitPageToViewportHeight"
        >
          Fit Height
        </button>
      </div>
    </div>

    <div class="min-h-0 min-w-0 flex-1 overflow-hidden rounded border border-brand-200 bg-brand-100 p-2">
      <div
        :ref="setOverlayPanelRef"
        class="relative h-full min-h-0 min-w-0 overflow-auto rounded border border-brand-200 bg-white"
        @wheel="onOverlayWheel"
      >
        <div
          v-if="errorMessage"
          class="flex h-full w-full items-center justify-center px-3 text-center text-xs text-red-700"
        >
          {{ errorMessage }}
        </div>

        <div
          v-else-if="isLoadingDocument || isRenderingPage"
          class="flex h-full w-full items-center justify-center px-3 text-center text-xs text-brand-600"
        >
          {{ isLoadingDocument ? 'Loading PDF...' : 'Rendering page preview...' }}
        </div>

        <img
          v-if="isReadyToShowImage"
          :ref="setImageRef"
          :src="previewImageUrl"
          alt="Binarized page preview"
          class="block h-auto max-w-none"
          :style="{ width: `${imageDisplayWidth}px`, height: `${imageDisplayHeight}px` }"
          draggable="false"
          @load="onPageImageLoad"
        />

        <div
          v-if="isApplyingThreshold && isReadyToShowImage"
          class="pointer-events-none absolute right-2 top-2 rounded bg-brand-900/85 px-2 py-1 text-[11px] text-white"
        >
          Applying threshold...
        </div>
      </div>
    </div>
  </div>
</template>
