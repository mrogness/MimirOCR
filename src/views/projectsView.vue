<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ResizableSplitPane from '../components/layout/ResizableSplitPane.vue'
import OcrProgressPanel from '../components/projects/OcrProgressPanel.vue'
import OcrSettingsPanel from '../components/projects/OcrSettingsPanel.vue'
import PdfSelectionPreview from '../components/projects/PdfSelectionPreview.vue'
import ProjectDetailsPanel from '../components/projects/ProjectDetailsPanel.vue'
import { useProjectsView } from '../composables/views/useProjectsView'
import { backendFetch } from '../services/backend'

const route = useRoute()
const router = useRouter()

const {
  project,
  isLoadingProject,
  projectError,
  renameInput,
  renameError,
  isRenaming,
  selectedPdf,
  uploadError,
  isUploading,
  isAnalyzingDpi,
  dpiAnalysis,
  dpiAnalysisError,
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
  hasActiveOcrJob,
  backendConnection,
  activeJobMessage,
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
})

const selectedPdfPreviewUrl = ref('')
const sourcePdfPreviewUrl = ref('')
const sourcePdfPreviewError = ref('')

const activePdfPreviewUrl = computed(() => selectedPdfPreviewUrl.value || sourcePdfPreviewUrl.value)
const hasActivePdfPreview = computed(() => Boolean(String(activePdfPreviewUrl.value || '').trim()))
const showProgressSection = computed(() => currentJobId.value || ocrPhase.value !== 'idle' || canOpenReview.value)
const splitPaneDisabledBreakpoint = computed(() => (hasActivePdfPreview.value ? 768 : 100000))

function toDisplayPdfName(name) {
  const value = String(name || '').trim()
  if (!value) {
    return ''
  }

  const match = value.match(/^(?:\d+_)?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_(.+)$/i)
  return match?.[1] || value
}

const activePdfDisplayName = computed(() => {
  if (selectedPdf.value?.name) {
    return toDisplayPdfName(selectedPdf.value.name)
  }
  return toDisplayPdfName(project.value?.source_pdf_name)
})

function clearSelectedPdfPreviewUrl() {
  if (!selectedPdfPreviewUrl.value) {
    return
  }
  URL.revokeObjectURL(selectedPdfPreviewUrl.value)
  selectedPdfPreviewUrl.value = ''
}

function clearSourcePdfPreviewUrl() {
  if (!sourcePdfPreviewUrl.value) {
    return
  }
  URL.revokeObjectURL(sourcePdfPreviewUrl.value)
  sourcePdfPreviewUrl.value = ''
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
  [
    () => project.value?.id ?? null,
    () => project.value?.source_pdf_name ?? null,
  ],
  ([projectId, sourcePdfName], [previousProjectId, previousSourcePdfName]) => {
    if (projectId === previousProjectId && sourcePdfName === previousSourcePdfName) {
      return
    }
    void loadSourcePdfPreview()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearSelectedPdfPreviewUrl()
  clearSourcePdfPreviewUrl()
})
</script>

<template>
  <div class="projects-page flex h-full min-h-0 flex-col gap-4">
    <section class="flex shrink-0 items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold">Project Workspace</h1>
        <p class="text-sm text-brand-500">Upload PDFs and monitor OCR processing progress.</p>
      </div>
      <button
        class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
        @click="openCreateProjectFlow"
      >
        Back to Dashboard
      </button>
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
        <div class="min-h-0 flex-1 overflow-hidden">
          <ResizableSplitPane
            class="h-full"
            :initial-left-width="480"
            :min-left-width="340"
            :max-left-width="760"
            :min-right-width="480"
            :max-right-width="1600"
            :disabled-breakpoint="splitPaneDisabledBreakpoint"
            storage-key="mimir-project-view-details-width"
          >
            <template #left>
              <section class="h-full min-h-0 min-w-0 overflow-y-auto rounded border border-brand-200 bg-white p-5">
                <ProjectDetailsPanel
                  :project="project"
                  :rename-input="renameInput"
                  :rename-error="renameError"
                  :is-renaming="isRenaming"
                  :selected-pdf="selectedPdf"
                  :active-pdf-display-name="activePdfDisplayName"
                  @update:rename-input="renameInput = $event"
                  @pdf-selected="onPdfSelected"
                />

                <OcrSettingsPanel
                  v-if="hasActivePdfPreview"
                  :is-analyzing-dpi="isAnalyzingDpi"
                  :dpi-analysis="dpiAnalysis"
                  :dpi-analysis-error="dpiAnalysisError"
                  :dpi-input="dpiInput"
                  :threshold-input="thresholdInput"
                  :spread-mode="spreadMode"
                  :strict-top-to-bottom="strictTopToBottom"
                  @update:dpi-input="dpiInput = $event"
                  @update:threshold-input="thresholdInput = $event"
                  @update:spread-mode="spreadMode = $event"
                  @update:strict-top-to-bottom="strictTopToBottom = $event"
                />
              </section>
            </template>

            <template #right>
              <PdfSelectionPreview
                v-if="hasActivePdfPreview"
                :pdf-url="activePdfPreviewUrl"
                :dpi="dpiInput"
                :threshold="thresholdInput"
                :display-name="activePdfDisplayName"
                :source-pdf-preview-error="sourcePdfPreviewError"
                :is-uploading="isUploading"
                :is-analyzing-dpi="isAnalyzingDpi"
                :selected-pdf="selectedPdf"
                :has-active-ocr-job="hasActiveOcrJob"
                :backend-connection="backendConnection"
                :active-job-message="activeJobMessage"
                :upload-error="uploadError"
                @submit="uploadPdfAndStartOcr"
              />
            </template>
          </ResizableSplitPane>
        </div>

        <OcrProgressPanel
          v-if="showProgressSection"
          :recovered-run-notice="recoveredRunNotice"
          :elapsed-display="elapsedDisplay"
          :ocr-progress="ocrProgress"
          :total-pages="totalPagesCounter"
          :rasterized-pages="rasterizedPagesCounter"
          :segmented-pages="segmentedPagesCounter"
          :ocr-pages="ocrPagesCounter"
          :can-open-review="canOpenReview"
          @open-review="openReviewView"
        />
      </div>
    </template>
  </div>
</template>
