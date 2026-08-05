<script setup>
defineProps({
  recoveredRunNotice: { type: String, default: '' },
  elapsedDisplay: { type: String, default: '' },
  ocrProgress: { type: Number, default: 0 },
  totalPages: { type: Number, default: 0 },
  rasterizedPages: { type: Number, default: 0 },
  segmentedPages: { type: Number, default: 0 },
  ocrPages: { type: Number, default: 0 },
  canOpenReview: { type: Boolean, default: false },
})

const emit = defineEmits(['open-review'])
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
        Open OCR Review
      </button>
      <p v-if="!canOpenReview" class="mt-1 text-xs text-brand-500">
        OCR review is available after at least one successful OCR run.
      </p>
    </div>
  </section>
</template>
