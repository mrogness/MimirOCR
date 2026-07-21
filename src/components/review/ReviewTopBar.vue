<script setup>
const props = defineProps({
  selectedPageIndex: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  pageInputValue: { type: String, required: true },
  isExporting: { type: Boolean, required: true },
  exportErrorMessage: { type: String, default: '' },
  exportSuccessMessage: { type: String, default: '' },
})

const emit = defineEmits([
  'update:pageInputValue',
  'first-page',
  'previous-page',
  'next-page',
  'last-page',
  'commit-page-input',
  'open-export-settings',
  'export-pdf',
])

function onPageInput(event) {
  emit('update:pageInputValue', event.target.value)
}

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

    <p v-if="exportErrorMessage" class="mt-2 text-xs text-red-700">{{ exportErrorMessage }}</p>
    <p v-else-if="exportSuccessMessage" class="mt-2 text-xs text-emerald-700">{{ exportSuccessMessage }}</p>
  </div>
</template>
