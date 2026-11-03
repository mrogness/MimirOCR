<script setup>
/**
 * @file Present OCR phase, progress, counters, elapsed time, and review navigation.
 */
defineProps({
  /** Transient message explaining that an active OCR run was recovered after navigation or reload. */
  recoveredRunNotice: { type: String, default: '' },
  /** Preformatted elapsed processing time for the current or most recent run. */
  elapsedDisplay: { type: String, default: '' },
  /** Overall OCR progress percentage supplied by the backend workflow. */
  ocrProgress: { type: Number, default: 0 },
  /** Number of source pages in the current document or review dataset. */
  totalPages: { type: Number, default: 0 },
  /** Count of source pages whose rasterization has completed. */
  rasterizedPages: { type: Number, default: 0 },
  /** Count of source pages whose line segmentation has completed. */
  segmentedPages: { type: Number, default: 0 },
  /** Count of source pages whose text recognition has completed. */
  ocrPages: { type: Number, default: 0 },
  /** Whether the project has a successful OCR result available for review navigation. */
  canOpenReview: { type: Boolean, default: false },
})

const emit = defineEmits([
  /** Request navigation to the current project's completed OCR review. */
  'open-review',
])
</script>

<template>
  <section class="shrink-0 rounded border border-brand-200 bg-white p-5">
    <h2 class="text-lg font-semibold">OCR Progress</h2>
    <p
      v-if="recoveredRunNotice"
      class="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
    >
      {{ recoveredRunNotice }}
    </p>
    <p class="mt-1 text-sm text-brand-600">Elapsed: {{ elapsedDisplay }}</p>

    <div class="mt-3 h-3 w-full overflow-hidden rounded bg-brand-200">
      <div class="h-full bg-emerald-600 transition-all duration-300" :style="{ width: `${ocrProgress}%` }"></div>
    </div>
    <p class="mt-2 text-sm text-brand-700">{{ ocrProgress }}%</p>

    <div v-if="totalPages > 0" class="mt-3 grid grid-cols-1 gap-2 text-xs text-brand-700 sm:grid-cols-3">
      <p class="rounded border border-brand-200 bg-brand-50 px-2 py-1">
        Rasterized: {{ rasterizedPages }}/{{ totalPages }}
      </p>
      <p class="rounded border border-brand-200 bg-brand-50 px-2 py-1">
        Segmented: {{ segmentedPages }}/{{ totalPages }}
      </p>
      <p class="rounded border border-brand-200 bg-brand-50 px-2 py-1">OCR: {{ ocrPages }}/{{ totalPages }}</p>
    </div>

    <div class="mt-4">
      <button
        class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canOpenReview"
        @click="emit('open-review')"
      >
        Open Output Review
      </button>
      <p v-if="!canOpenReview" class="mt-1 text-xs text-brand-500">
        Output review is available after at least one successful OCR run.
      </p>
    </div>
  </section>
</template>
