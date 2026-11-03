<script setup>
/**
 * @file Present the selected PDF and submission controls.
 */
import BinarizedPdfPreview from './BinarizedPdfPreview.vue'

defineProps({
  /** URL of the selected or stored PDF used by the preview renderer. */
  pdfUrl: { type: String, required: true },
  /** Requested PDF rasterization resolution in dots per inch; preview size remains memory-bounded. */
  dpi: { type: [String, Number], required: true },
  /** Black/white threshold in the supported 1..256 range. */
  threshold: { type: [String, Number], required: true },
  /** Human-readable source PDF filename shown above the preview. */
  displayName: { type: String, default: '' },
  /** Error message from loading the project's previously stored PDF preview. */
  sourcePdfPreviewError: { type: String, default: '' },
  /** Whether PDF upload and initial OCR job submission are in progress. */
  isUploading: { type: Boolean, default: false },
  /** Whether source scan-resolution analysis is currently pending. */
  isAnalyzingDpi: { type: Boolean, default: false },
  /** Browser File selected for the next upload, or null when using only the stored source preview. */
  selectedPdf: { type: Object, default: null },
  /** Whether any project currently owns the shared backend OCR runtime. */
  hasActiveOcrJob: { type: Boolean, default: false },
  /** Shared backend connection phase, such as connecting, connected, restarting, or disconnected. */
  backendConnection: { type: String, default: '' },
  /** Explanation of a runtime reservation or active job that blocks another OCR run. */
  activeJobMessage: { type: String, default: '' },
  /** User-facing PDF upload or OCR job-start error. */
  uploadError: { type: String, default: '' },
})

const emit = defineEmits([
  /** Request upload and OCR processing of the currently selected PDF. */
  'submit',
])
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded border border-brand-200 bg-white p-5">
    <h2 class="text-lg font-semibold">Preview Selection and Submit</h2>
    <p class="mt-1 text-sm text-brand-500">Preview your selected file and start OCR processing.</p>

    <div class="mt-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
      <p v-if="sourcePdfPreviewError" class="text-xs text-red-600">{{ sourcePdfPreviewError }}</p>

      <div class="min-h-0 min-w-0 flex-1 overflow-hidden rounded border border-brand-900 bg-brand-700 p-1">
        <BinarizedPdfPreview :pdf-url="pdfUrl" :dpi="dpi" :threshold="threshold" :display-name="displayName" />
      </div>

      <div class="mt-auto flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <button
          class="rounded bg-brand-900 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isUploading || isAnalyzingDpi || !selectedPdf || hasActiveOcrJob || backendConnection !== 'connected'"
          @click="emit('submit')"
        >
          {{ isAnalyzingDpi ? 'Analyzing PDF...' : isUploading ? 'Submitting...' : 'Submit and Process' }}
        </button>
        <p v-if="activeJobMessage" class="text-xs text-amber-700">{{ activeJobMessage }}</p>
      </div>
    </div>

    <p v-if="uploadError" class="mt-2 text-sm text-red-600">{{ uploadError }}</p>
  </section>
</template>
