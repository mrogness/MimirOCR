<script setup>
/**
 * @file Present page navigation, display options, and review/export actions.
 */
const props = defineProps({
  /** Zero-based index of the currently selected review page. */
  selectedPageIndex: { type: Number, required: true },
  /** Number of source pages in the current document or review dataset. */
  totalPages: { type: Number, required: true },
  /** Parent-owned one-based page-number input text awaiting validation/commit. */
  pageInputValue: { type: String, required: true },
  /** Whether a pending text edit or committed review action is available to undo. */
  canUndo: { type: Boolean, default: false },
  /** Whether an undo operation is currently being persisted. */
  isUndoing: { type: Boolean, default: false },
  /** Action-specific label for the undo control. */
  undoLabel: { type: String, default: 'Undo' },
  /** User-facing error from attempting to undo a review operation. */
  undoErrorMessage: { type: String, default: '' },
  /** Whether a PDF or training-data download is currently being prepared. */
  isExporting: { type: Boolean, required: true },
  /** User-facing export preparation or download failure. */
  exportErrorMessage: { type: String, default: '' },
  /** Feedback naming the most recently downloaded export. */
  exportSuccessMessage: { type: String, default: '' },
})

const emit = defineEmits([
  /** Emit edited one-based page-number input text without navigating immediately. */
  'update:pageInputValue',
  /** Request selection of the first review page. */
  'first-page',
  /** Request selection of the preceding review page. */
  'previous-page',
  /** Request selection of the following review page. */
  'next-page',
  /** Request selection of the last review page. */
  'last-page',
  /** Request validation and navigation using the current page-number input. */
  'commit-page-input',
  /** Request undo of the latest available review operation. */
  'undo',
  /** Request display of the PDF/training export settings sheet. */
  'open-export-settings',
  /** Request a PDF export using the current parent-owned settings. */
  'export-pdf',
])

/**
 * Emit page-input text for parent-owned state without navigating yet.
 */
function onPageInput(event) {
  emit('update:pageInputValue', event.target.value)
}

/**
 * Request that the parent validate and apply the current page-input value.
 */
function onCommitPageInput() {
  emit('commit-page-input')
}
</script>

<template>
  <div class="rounded border border-brand-200 bg-white p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="rounded border border-brand-300 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="selectedPageIndex <= 0"
          @click="emit('first-page')"
        >
          ⏮
        </button>
        <button
          class="rounded border border-brand-300 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="selectedPageIndex <= 0"
          @click="emit('previous-page')"
        >
          ◀
        </button>

        <div class="flex items-center gap-2 rounded border border-brand-200 bg-brand-50 px-3 py-1.5">
          <input
            :value="pageInputValue"
            type="text"
            inputmode="numeric"
            class="w-14 rounded border border-brand-300 bg-white px-2 py-1 text-sm text-brand-900"
            @input="onPageInput"
            @keydown.enter.prevent="onCommitPageInput"
            @blur="onCommitPageInput"
          />
          <span class="text-sm text-brand-700">/ {{ totalPages }}</span>
        </div>

        <button
          class="rounded border border-brand-300 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="selectedPageIndex >= totalPages - 1"
          @click="emit('next-page')"
        >
          ▶
        </button>
        <button
          class="rounded border border-brand-300 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="selectedPageIndex >= totalPages - 1"
          @click="emit('last-page')"
        >
          ⏭
        </button>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <button
          class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="!canUndo || isUndoing"
          :title="undoLabel"
          :aria-label="undoLabel"
          @click="emit('undo')"
        >
          {{ isUndoing ? 'Undoing...' : 'Undo' }}
        </button>
        <button
          class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
          @click="emit('open-export-settings')"
        >
          Export Settings
        </button>
        <button
          class="rounded bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="isExporting"
          @click="emit('export-pdf')"
        >
          {{ isExporting ? 'Exporting...' : 'Export PDF' }}
        </button>
      </div>
    </div>

    <p v-if="undoErrorMessage" class="mt-2 text-xs text-red-700">{{ undoErrorMessage }}</p>
    <p v-if="exportErrorMessage" class="mt-2 text-xs text-red-700">{{ exportErrorMessage }}</p>
    <p v-if="exportSuccessMessage" class="mt-2 text-xs text-emerald-700">{{ exportSuccessMessage }}</p>
  </div>
</template>
