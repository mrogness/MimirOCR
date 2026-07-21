<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { useProjectsView } from '../composables/views/useProjectsView'
import { backendFetch } from '../services/backend'
import { getDefaultWorkerCount, getSavedWorkerCount } from '../services/appSettings'

const route = useRoute()
const router = useRouter()

const {
  project,
  isLoadingProject,
  projectError,
  renameInput,
  renameError,
  isRenaming,
  pdfRef,
  selectedPdf,
  uploadError,
  uploadMessage,
  isUploading,
  dpiInput,
  thresholdInput,
  strictTopToBottom,
  spreadMode,
  ocrPhase,
  ocrProgress,
  currentJobId,
  recoveredRunNotice,
  totalPagesCounter,
  rasterizedPagesCounter,
  segmentedPagesCounter,
  ocrPagesCounter,
  workerCount,
  isProjectRoute,
  canOpenReview,
  elapsedDisplay,
  onPdfSelected,
  uploadPdfAndStartOcr,
  openCreateProjectFlow,
  openReviewView,
} = useProjectsView({
  route,
  router,
  backendFetch,
  getDefaultWorkerCount,
  getSavedWorkerCount,
})

const selectedPdfPreviewUrl = ref('')
const sourcePdfPreviewUrl = ref('')
const sourcePdfPreviewError = ref('')
const renderedPreviewImageUrl = ref('')
const isRenderingPreview = ref(false)
const previewRenderError = ref('')
const previewFrameRef = ref(null)
const previewActionsRef = ref(null)
const isWideViewport = ref(false)
const previewFrameHeight = ref(0)
const previewAspectRatio = ref(0.75)
const previewActionsWidth = ref(0)

let previewFrameResizeObserver = null
let previewActionsResizeObserver = null

const selectedPdfInputId = 'project-upload-pdf-input'

const activePdfPreviewUrl = computed(() => selectedPdfPreviewUrl.value || sourcePdfPreviewUrl.value)
const activePreviewImageUrl = computed(() => renderedPreviewImageUrl.value)

function toDisplayPdfName(name) {
  const value = String(name || '').trim()
  if (!value) {
    return ''
  }

  const match = value.match(/^(?:\d+_)?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_(.+)$/i)
  if (match && match[1]) {
    return match[1]
  }

  return value
}

const activePdfDisplayName = computed(() => {
  if (selectedPdf.value?.name) {
    return toDisplayPdfName(selectedPdf.value.name)
  }
  if (project.value?.source_pdf_name) {
    return toDisplayPdfName(project.value.source_pdf_name)
  }
  return ''
})

const previewColumnWidthPx = computed(() => {
  const measuredControlsWidth = previewActionsWidth.value > 0 ? previewActionsWidth.value + 24 : 0
  const controlsMinWidth = Math.max(220, Math.round(measuredControlsWidth))
  const horizontalChrome = 16
  const imageWidth = previewFrameHeight.value > 0 ? previewFrameHeight.value * previewAspectRatio.value : 0
  const preferred = imageWidth > 0 ? imageWidth + horizontalChrome : controlsMinWidth
  return Math.max(controlsMinWidth, Math.round(preferred))
})

const topCardsGridStyle = computed(() => {
  if (!isWideViewport.value) {
    return {}
  }

  return {
    gridTemplateColumns: `minmax(22rem, 1fr) minmax(22rem, ${previewColumnWidthPx.value}px)`,
  }
})

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc

function clearSelectedPdfPreviewUrl() {
  if (selectedPdfPreviewUrl.value) {
    URL.revokeObjectURL(selectedPdfPreviewUrl.value)
    selectedPdfPreviewUrl.value = ''
  }
}

function clearSourcePdfPreviewUrl() {
  if (sourcePdfPreviewUrl.value) {
    URL.revokeObjectURL(sourcePdfPreviewUrl.value)
    sourcePdfPreviewUrl.value = ''
  }
}

function clearRenderedPreviewImageUrl() {
  if (renderedPreviewImageUrl.value) {
    URL.revokeObjectURL(renderedPreviewImageUrl.value)
    renderedPreviewImageUrl.value = ''
  }
}

async function renderFirstPdfPageToImage(pdfUrl) {
  clearRenderedPreviewImageUrl()
  previewRenderError.value = ''

  if (!pdfUrl) {
    return
  }

  isRenderingPreview.value = true
  try {
    const loadingTask = pdfjsLib.getDocument({ url: pdfUrl })
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.5 })
    if (viewport.width > 0 && viewport.height > 0) {
      previewAspectRatio.value = viewport.width / viewport.height
    }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas context unavailable')
    }

    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))

    await page.render({ canvasContext: context, viewport }).promise

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('Failed to render PDF preview image'))
        }
      }, 'image/png')
    })

    renderedPreviewImageUrl.value = URL.createObjectURL(blob)
  } catch (_err) {
    previewRenderError.value = 'Unable to render PDF preview.'
  } finally {
    isRenderingPreview.value = false
  }
}

function updateViewportMode() {
  isWideViewport.value = window.innerWidth >= 1280
}

function attachPreviewFrameObserver() {
  if (previewFrameResizeObserver) {
    previewFrameResizeObserver.disconnect()
    previewFrameResizeObserver = null
  }

  if (!previewFrameRef.value || typeof ResizeObserver === 'undefined') {
    return
  }

  previewFrameResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) {
      return
    }
    previewFrameHeight.value = Math.max(0, entry.contentRect.height)
  })

  previewFrameResizeObserver.observe(previewFrameRef.value)
}

function attachPreviewActionsObserver() {
  if (previewActionsResizeObserver) {
    previewActionsResizeObserver.disconnect()
    previewActionsResizeObserver = null
  }

  if (!previewActionsRef.value || typeof ResizeObserver === 'undefined') {
    return
  }

  previewActionsResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) {
      return
    }
    previewActionsWidth.value = Math.max(0, entry.contentRect.width)
  })

  previewActionsResizeObserver.observe(previewActionsRef.value)
}

async function loadSourcePdfPreview() {
  clearSourcePdfPreviewUrl()
  sourcePdfPreviewError.value = ''

  if (!project.value?.id || !project.value?.source_pdf_name) {
    return
  }

  try {
    const response = await backendFetch(`/projects/${project.value.id}/source-pdf`)
    if (!response.ok) {
      return
    }
    const blob = await response.blob()
    if (blob.type && blob.type !== 'application/pdf') {
      return
    }
    sourcePdfPreviewUrl.value = URL.createObjectURL(blob)
  } catch (_err) {
    sourcePdfPreviewError.value = 'Unable to load previous PDF preview.'
  }
}

watch(selectedPdf, (file) => {
  clearSelectedPdfPreviewUrl()
  if (file instanceof File && file.type === 'application/pdf') {
    selectedPdfPreviewUrl.value = URL.createObjectURL(file)
  }
})

watch(
  activePdfPreviewUrl,
  (url) => {
    renderFirstPdfPageToImage(url)
  },
  { immediate: true }
)

watch(previewFrameRef, () => {
  attachPreviewFrameObserver()
})

watch(previewActionsRef, () => {
  attachPreviewActionsObserver()
})

watch(
  [
    () => project.value?.id ?? null,
    () => project.value?.source_pdf_name ?? null,
  ],
  ([projectId, sourcePdfName], [prevProjectId, prevSourcePdfName]) => {
    const sourceChanged = projectId !== prevProjectId || sourcePdfName !== prevSourcePdfName
    if (!sourceChanged) {
      return
    }

    if (!selectedPdf.value) {
      loadSourcePdfPreview()
      return
    }
    // Keep preview for previously uploaded PDF ready if user clears selection.
    loadSourcePdfPreview()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportMode)
  if (previewFrameResizeObserver) {
    previewFrameResizeObserver.disconnect()
    previewFrameResizeObserver = null
  }
  if (previewActionsResizeObserver) {
    previewActionsResizeObserver.disconnect()
    previewActionsResizeObserver = null
  }

  clearSelectedPdfPreviewUrl()
  clearSourcePdfPreviewUrl()
  clearRenderedPreviewImageUrl()
})

onMounted(() => {
  updateViewportMode()
  window.addEventListener('resize', updateViewportMode)
  attachPreviewFrameObserver()
  attachPreviewActionsObserver()
})
</script>

<template>
  <div class="projects-page flex h-full min-h-0 flex-col gap-4">
    <section class="flex shrink-0 items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold">Project Workspace</h1>
        <p class="text-sm text-brand-500">Upload PDFs and monitor OCR processing progress.</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
          @click="openCreateProjectFlow"
        >
          Back to Dashboard
        </button>
      </div>
    </section>

    <section v-if="!isProjectRoute" class="rounded border border-brand-200 bg-white p-5 text-brand-700">
      Pick a project from the dashboard to start, or create a new one.
    </section>

    <section v-else-if="isLoadingProject" class="rounded border border-brand-200 bg-white p-5 text-brand-600">
      Loading project...
    </section>

    <section v-else-if="projectError" class="rounded border border-red-200 bg-red-50 p-5 text-red-700">
      {{ projectError }}
    </section>

    <template v-else>
      <div class="flex min-h-0 flex-1 flex-col gap-4">
      <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:items-stretch" :style="topCardsGridStyle">
        <section class="min-h-0 rounded border border-brand-200 bg-white p-5">
          <h2 class="text-lg font-semibold">Project Details</h2>

          <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div class="flex-1">
              <label class="block text-sm font-medium text-brand-700">Project Name</label>
              <input v-model="renameInput" type="text" class="mt-1 w-full rounded border border-brand-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <p v-if="isRenaming" class="mt-2 text-xs text-brand-500">Saving name...</p>
          <p v-if="renameError" class="mt-2 text-sm text-red-600">{{ renameError }}</p>

          <div class="mt-2 border-t border-brand-100 pt-2">
            <h3 class="text-base font-semibold text-brand-800">OCR Settings</h3>
            <p class="mt-1 text-sm text-brand-500">Adjust processing options before uploading a PDF.</p>

            <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-brand-700">DPI</label>
                <input v-model="dpiInput" type="number" min="1" class="mt-1 w-full rounded border border-brand-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-brand-700">Binarization Threshold</label>
                <input v-model="thresholdInput" type="number" min="1" max="256" class="mt-1 w-full rounded border border-brand-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-brand-700">Page Layout</label>
                <select v-model="spreadMode" class="mt-1 w-full rounded border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900">
                  <option value="split-spread">Split Left/Right Spread</option>
                  <option value="single">Single Page Per Scan</option>
                </select>
              </div>
              <div class="flex items-end">
                <label class="flex items-center gap-2 text-sm text-brand-700">
                  <input v-model="strictTopToBottom" type="checkbox" />
                  Strict top-to-bottom line sorting
                </label>
              </div>
            </div>
          </div>

          <div class="mt-5 border-t border-brand-100 pt-4">
            <label
              :for="selectedPdfInputId"
              class="block cursor-pointer rounded border border-dashed border-brand-300 bg-brand-50/50 px-3 py-3 hover:bg-brand-100/50"
            >
              <div class="min-w-0">
                <p class="text-xs font-medium uppercase tracking-wide text-brand-500">PDF File</p>
                <p class="mt-1 truncate text-sm text-brand-800">
                  {{ activePdfDisplayName || 'Click to select a PDF file' }}
                </p>
              </div>
            </label>

            <input
              :id="selectedPdfInputId"
              type="file"
              accept=".pdf, application/pdf"
              ref="pdfRef"
              @change="onPdfSelected"
              class="hidden"
            />

            <p v-if="project?.source_pdf_name && !selectedPdf" class="mt-2 text-xs text-brand-500">
              Showing previously uploaded file for this project.
            </p>
          </div>
        </section>

        <section class="flex min-h-0 flex-col rounded border border-brand-200 bg-white p-5">
          <h2 class="text-lg font-semibold">Preview Selection and Submit</h2>
          <p class="mt-1 text-sm text-brand-500">Preview your selected file and start OCR processing.</p>

          <div class="mt-4 flex min-h-0 flex-1 flex-col gap-3">
            <p v-if="sourcePdfPreviewError" class="text-xs text-red-600">
              {{ sourcePdfPreviewError }}
            </p>

            <p v-if="previewRenderError" class="text-xs text-red-600">
              {{ previewRenderError }}
            </p>

            <div ref="previewFrameRef" class="min-h-0 flex-1 rounded border border-brand-900 bg-brand-700 p-1">
              <div v-if="activePdfPreviewUrl" class="flex h-full min-h-0 flex-col gap-2">
                <div class="min-h-0 flex-1 overflow-hidden rounded border border-brand-900 bg-brand-100">
                  <div v-if="isRenderingPreview" class="flex h-full w-full items-center justify-center text-xs text-brand-500">
                    Rendering preview...
                  </div>
                  <img
                    v-else-if="activePreviewImageUrl"
                    :src="activePreviewImageUrl"
                    alt="Selected PDF first-page preview"
                    class="mx-auto block h-full w-auto max-w-none"
                    draggable="false"
                  />
                  <div v-else class="flex h-full w-full items-center justify-center text-xs text-brand-500">
                    PDF preview unavailable
                  </div>
                </div>
              </div>
              <div v-else class="flex h-full min-h-0 items-center justify-center rounded border border-dashed border-brand-300 text-xs text-brand-500">
                PDF preview appears here
              </div>
            </div>

            <div ref="previewActionsRef" class="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                class="rounded bg-brand-900 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isUploading || !selectedPdf"
                @click="uploadPdfAndStartOcr"
              >
                {{ isUploading ? 'Submitting...' : 'Submit and Process' }}
              </button>
            </div>
          </div>

          <p v-if="uploadError" class="mt-2 text-sm text-red-600">{{ uploadError }}</p>
        </section>
      </div>

      <section class="shrink-0 rounded border border-brand-200 bg-white p-5">
        <h2 class="text-lg font-semibold">OCR Progress</h2>
        <p v-if="recoveredRunNotice" class="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {{ recoveredRunNotice }}
        </p>
        <p class="mt-1 text-sm text-brand-600">Elapsed: {{ elapsedDisplay }}</p>

        <div class="mt-3 h-3 w-full overflow-hidden rounded bg-brand-200">
          <div class="h-full bg-emerald-600 transition-all duration-300" :style="{ width: `${ocrProgress}%` }"></div>
        </div>
        <p class="mt-2 text-sm text-brand-700">{{ ocrProgress }}%</p>

        <div v-if="totalPagesCounter > 0" class="mt-3 grid grid-cols-1 gap-2 text-xs text-brand-700 sm:grid-cols-3">
          <p class="rounded border border-brand-200 bg-brand-50 px-2 py-1">
            Rasterized: {{ rasterizedPagesCounter }}/{{ totalPagesCounter }}
          </p>
          <p class="rounded border border-brand-200 bg-brand-50 px-2 py-1">
            Segmented: {{ segmentedPagesCounter }}/{{ totalPagesCounter }}
          </p>
          <p class="rounded border border-brand-200 bg-brand-50 px-2 py-1">
            OCR: {{ ocrPagesCounter }}/{{ totalPagesCounter }}
          </p>
        </div>

        <div class="mt-4">
          <button
            class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canOpenReview"
            @click="openReviewView"
          >
            Open OCR Review
          </button>
          <p class="mt-1 text-xs text-brand-500" v-if="!canOpenReview">
            OCR review is available after at least one successful OCR run.
          </p>
        </div>
      </section>
      </div>
    </template>

  </div>
</template>
