<script setup>
import BinarizedPdfPreview from './BinarizedPdfPreview.vue'

defineProps({
  pdfUrl: { type: String, required: true },
  dpi: { type: [String, Number], required: true },
  threshold: { type: [String, Number], required: true },
  displayName: { type: String, default: '' },
  sourcePdfPreviewError: { type: String, default: '' },
  isUploading: { type: Boolean, default: false },
  isAnalyzingDpi: { type: Boolean, default: false },
  selectedPdf: { type: Object, default: null },
  hasActiveOcrJob: { type: Boolean, default: false },
  backendConnection: { type: String, default: '' },
  activeJobMessage: { type: String, default: '' },
  uploadError: { type: String, default: '' },
})

const emit = defineEmits(['submit'])
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
