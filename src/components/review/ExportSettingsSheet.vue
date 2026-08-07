<script setup>
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, required: true },
  settings: { type: Object, required: true },
  isExporting: { type: Boolean, required: true },
})

const emit = defineEmits(['close', 'export-pdf', 'export-training-data'])

function closeDialog() {
  if (!props.isExporting) {
    emit('close')
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.show) {
    closeDialog()
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-6"
        @click.self="closeDialog"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-dialog-title"
          class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-brand-200 bg-white shadow-2xl"
        >
          <header
            class="flex shrink-0 items-start justify-between border-b border-brand-200 px-6 py-4"
          >
            <div>
              <h2 id="export-dialog-title" class="text-lg font-semibold text-brand-900">
                Export Project
              </h2>
              <p class="mt-1 text-sm text-brand-600">
                Configure how your corrected transcription is exported.
              </p>
            </div>

            <button
              type="button"
              :disabled="isExporting"
              class="rounded-md p-1.5 text-brand-500 hover:bg-brand-100 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close export dialog"
              @click="closeDialog"
            >
              ✕
            </button>
          </header>

          <!-- Only the settings body scrolls when the dialog is taller than the window. -->
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div class="space-y-7">
              <fieldset>
                <legend
                  class="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600"
                >
                  Layout
                </legend>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label
                    class="cursor-pointer rounded-lg border p-4 transition-colors"
                    :class="
                      settings.layout_mode === 'source-lines'
                        ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                        : 'border-brand-200 bg-white hover:border-brand-300 hover:bg-brand-50'
                    "
                  >
                    <div class="flex items-start gap-3">
                      <input
                        v-model="settings.layout_mode"
                        type="radio"
                        value="source-lines"
                        class="mt-1"
                      />
                      <div>
                        <div class="font-medium text-brand-900">Preserve line layout</div>
                        <p class="mt-1 text-xs leading-5 text-brand-600">
                          Keep OCR lines and approximate indentation from the original pages.
                        </p>
                      </div>
                    </div>
                  </label>

                  <label
                    class="cursor-pointer rounded-lg border p-4 transition-colors"
                    :class="
                      settings.layout_mode === 'reading'
                        ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                        : 'border-brand-200 bg-white hover:border-brand-300 hover:bg-brand-50'
                    "
                  >
                    <div class="flex items-start gap-3">
                      <input
                        v-model="settings.layout_mode"
                        type="radio"
                        value="reading"
                        class="mt-1"
                      />
                      <div>
                        <div class="font-medium text-brand-900">Reflow for reading</div>
                        <p class="mt-1 text-xs leading-5 text-brand-600">
                          Combine OCR lines into paragraphs that flow naturally across output pages.
                        </p>
                      </div>
                    </div>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend
                  class="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600"
                >
                  Document
                </legend>

                <div class="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label class="text-sm text-brand-700">
                    <span class="mb-1.5 block font-medium">Font</span>
                    <select
                      v-model="settings.font_family"
                      class="w-full rounded-md border border-brand-300 bg-white px-3 py-2 text-brand-900"
                    >
                      <option value="Times-Roman">Times</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Courier">Courier</option>
                    </select>
                  </label>

                  <label class="text-sm text-brand-700">
                    <span class="mb-1.5 block font-medium">
                      {{
                        settings.layout_mode === 'source-lines' && settings.fit_text_to_page
                          ? 'Preferred text size'
                          : 'Text size'
                      }}
                    </span>
                    <input
                      v-model.number="settings.font_size"
                      type="number"
                      min="6"
                      max="24"
                      step="0.5"
                      class="w-full rounded-md border border-brand-300 bg-white px-3 py-2 text-brand-900"
                    />
                    <p
                      v-if="settings.layout_mode === 'source-lines' && settings.fit_text_to_page"
                      class="mt-1.5 text-xs leading-5 text-brand-600"
                    >
                      Text may be reduced from this size when necessary to fit the page.
                    </p>
                  </label>

                  <label class="text-sm text-brand-700">
                    <span class="mb-1.5 block font-medium">Line spacing</span>
                    <input
                      v-model.number="settings.line_spacing"
                      type="number"
                      min="1"
                      max="2"
                      step="0.05"
                      class="w-full rounded-md border border-brand-300 bg-white px-3 py-2 text-brand-900"
                    />
                  </label>

                  <label class="text-sm text-brand-700">
                    <span class="mb-1.5 block font-medium">Paper size</span>
                    <select
                      v-model="settings.page_size"
                      class="w-full rounded-md border border-brand-300 bg-white px-3 py-2 text-brand-900"
                    >
                      <option value="letter">Letter</option>
                      <option value="a4">A4</option>
                    </select>
                  </label>

                  <label class="text-sm text-brand-700">
                    <span class="mb-1.5 block font-medium">Margins (inches)</span>
                    <input
                      v-model.number="settings.margin_in"
                      type="number"
                      min="0.3"
                      max="2"
                      step="0.1"
                      class="w-full rounded-md border border-brand-300 bg-white px-3 py-2 text-brand-900"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend
                  class="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600"
                >
                  Layout Options
                </legend>

                <div v-if="settings.layout_mode === 'source-lines'">
                  <label class="flex items-start gap-3 text-sm text-brand-800">
                    <input
                      v-model="settings.fit_text_to_page"
                      type="checkbox"
                      class="mt-1"
                    />
                    <div>
                      <div class="font-medium">Automatically fit text to each page</div>
                      <p class="mt-0.5 text-xs leading-5 text-brand-600">
                        Reduce the text size when necessary to keep source lines on their
                        corresponding output page.
                      </p>
                    </div>
                  </label>

                  <div
                    v-if="!settings.fit_text_to_page"
                    class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                  >
                    <p class="text-xs leading-5 text-amber-800">
                      Text that exceeds the available page area may not appear in the exported
                      PDF when automatic fitting is disabled.
                    </p>
                  </div>
                </div>

                <label v-else class="flex items-start gap-3 text-sm text-brand-800">
                  <input
                    v-model="settings.join_historical_line_breaks"
                    type="checkbox"
                    class="mt-1"
                  />
                  <div>
                    <div class="font-medium">Join words split across lines</div>
                    <p class="mt-0.5 text-xs leading-5 text-brand-600">
                      Rejoin words divided across historical line breaks using the double
                      oblique hyphen (⸗).
                    </p>
                  </div>
                </label>
              </fieldset>

              <fieldset>
                <legend
                  class="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600"
                >
                  Text Modernization
                </legend>

                <div class="space-y-3">
                  <label class="flex items-start gap-3 text-sm text-brand-800">
                    <input v-model="settings.normalize_long_s" type="checkbox" class="mt-1" />
                    <div>
                      <div class="font-medium">Convert long s</div>
                      <p class="mt-0.5 text-xs text-brand-600">
                        Convert Gothic long s (ſ) to modern s.
                      </p>
                    </div>
                  </label>

                  <label class="flex items-start gap-3 text-sm text-brand-800">
                    <input
                      v-model="settings.normalize_low_double_quote"
                      type="checkbox"
                      class="mt-1"
                    />
                    <div>
                      <div class="font-medium">Normalize low double quotes</div>
                      <p class="mt-0.5 text-xs text-brand-600">
                        Convert low double quote („) to a regular quote (&quot;).
                      </p>
                    </div>
                  </label>

                  <label class="flex items-start gap-3 text-sm text-brand-800">
                    <input
                      v-model="settings.normalize_double_oblique_hyphen"
                      type="checkbox"
                      class="mt-1"
                    />
                    <div>
                      <div class="font-medium">Normalize double oblique hyphens</div>
                      <p class="mt-0.5 text-xs text-brand-600">
                        Convert double oblique hyphen (⸗) to a regular hyphen (-).
                      </p>
                    </div>
                  </label>
                </div>
              </fieldset>
            </div>
          </div>

          <footer
            class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-brand-200 bg-brand-50 px-6 py-4"
          >
            <button
              type="button"
              :disabled="isExporting"
              class="rounded-md border border-brand-300 bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
              @click="emit('export-training-data')"
            >
              {{ isExporting ? 'Exporting...' : 'Export Training Data (Temporary)' }}
            </button>

            <div class="ml-auto flex items-center gap-2">
              <button
                type="button"
                :disabled="isExporting"
                class="rounded-md border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                @click="closeDialog"
              >
                Cancel
              </button>

              <button
                type="button"
                :disabled="isExporting"
                class="rounded-md bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
                @click="emit('export-pdf')"
              >
                {{ isExporting ? 'Exporting...' : 'Export PDF' }}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
