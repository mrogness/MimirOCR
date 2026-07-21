<script setup>
const props = defineProps({
  show: { type: Boolean, required: true },
  settings: { type: Object, required: true },
  isExporting: { type: Boolean, required: true },
})

const emit = defineEmits(['close', 'export-pdf', 'export-training-data'])
</script>

<template>
  <div>
    <div
      v-if="show"
      class="fixed inset-0 z-40 bg-black/25"
      @click="emit('close')"
    />

    <section
      v-if="show"
      class="fixed inset-x-0 bottom-0 z-50 border-t border-brand-200 bg-white p-4 shadow-2xl"
    >
      <div class="mx-auto w-full max-w-6xl space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-brand-700">PDF Export Settings</h3>
          <button
            class="rounded border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
            @click="emit('close')"
          >
            Close
          </button>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="text-xs text-brand-700">
            <span class="mb-1 block">Font</span>
            <select v-model="settings.font_family" class="w-full rounded border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900">
              <option value="Times-Roman">Times</option>
              <option value="Helvetica">Helvetica</option>
              <option value="Courier">Courier</option>
            </select>
          </label>

          <label class="text-xs text-brand-700">
            <span class="mb-1 block">Text Size</span>
            <input
              v-model.number="settings.font_size"
              type="number"
              min="6"
              max="24"
              step="0.5"
              class="w-full rounded border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900"
            />
          </label>

          <label class="text-xs text-brand-700">
            <span class="mb-1 block">Line Spacing</span>
            <input
              v-model.number="settings.line_spacing"
              type="number"
              min="1"
              max="2"
              step="0.05"
              class="w-full rounded border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900"
            />
          </label>

          <label class="text-xs text-brand-700">
            <span class="mb-1 block">Margin (inches)</span>
            <input
              v-model.number="settings.margin_in"
              type="number"
              min="0.3"
              max="2"
              step="0.1"
              class="w-full rounded border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900"
            />
          </label>

          <label class="text-xs text-brand-700">
            <span class="mb-1 block">Paper Size</span>
            <select v-model="settings.page_size" class="w-full rounded border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900">
              <option value="letter">Letter</option>
              <option value="a4">A4</option>
            </select>
          </label>

          <label class="flex items-center gap-2 pt-6 text-sm text-brand-700">
            <input v-model="settings.fit_text_to_page" type="checkbox" />
            Auto-fit text to each output page
          </label>

          <label class="flex items-center gap-2 pt-6 text-sm text-brand-700">
            <input v-model="settings.normalize_long_s" type="checkbox" />
            Convert Gothic long s (ſ) to s
          </label>

          <label class="flex items-center gap-2 pt-6 text-sm text-brand-700">
            <input v-model="settings.normalize_low_double_quote" type="checkbox" />
            Convert all low double quote (U+201E) to regular quote (")
          </label>

          <label class="flex items-center gap-2 text-sm text-brand-700 md:col-span-2 xl:col-span-4">
            <input v-model="settings.normalize_double_oblique_hyphen" type="checkbox" />
            Convert double oblique hyphen (⸗) to regular hyphen (-)
          </label>
        </div>

        <div class="flex items-center justify-end gap-2">
          <button
            class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isExporting"
            @click="emit('export-training-data')"
          >
            {{ isExporting ? 'Exporting...' : 'Export Training Data (Temporary)' }}
          </button>
          <button
            class="rounded border border-brand-300 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
            @click="emit('close')"
          >
            Cancel
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
    </section>
  </div>
</template>
