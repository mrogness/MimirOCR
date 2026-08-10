<script setup>
import AppHelp from '../help/AppHelp.vue'

defineProps({
  isAnalyzingDpi: { type: Boolean, default: false },
  dpiAnalysis: { type: Object, default: null },
  dpiAnalysisError: { type: String, default: '' },
  dpiInput: { type: [String, Number], default: '300' },
  thresholdInput: { type: [String, Number], default: '170' },
  spreadMode: { type: String, default: 'split-spread' },
  strictTopToBottom: { type: Boolean, default: false },
  ijDisambiguation: { type: Boolean, default: true },
})

const emit = defineEmits([
  'update:dpi-input',
  'update:threshold-input',
  'update:spread-mode',
  'update:strict-top-to-bottom',
  'update:ij-disambiguation',
])
</script>

<template>
  <div class="mt-5 border-t border-brand-100 pt-4">
    <h3 class="text-base font-semibold text-brand-800">OCR Settings</h3>
    <p class="mt-1 text-sm text-brand-500">Adjust processing options before submitting OCR.</p>

    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-2">
            <label class="block text-sm font-medium text-brand-700">Processing DPI</label>
            <AppHelp label="About processing DPI" title="Processing DPI"
              intro="The DPI (dots per inch) setting affects the quality and file size of the images taken from input PDFs."
              link-href="/info#Processing-DPI" link-label="More details in Info" trigger-text="?">
              <p>
                Changing the processing DPI will affect the quality of the OCR results. Higher DPI values can improve
                accuracy but may increase processing time and file size.
              </p>
              <p>
                Using a higher processing DPI than an input PDF was originally scanned at has no benefit and may slow
                down processing.
              </p>
            </AppHelp>
          </div>

          <span v-if="isAnalyzingDpi" class="text-xs text-brand-500">Analyzing PDF…</span>
        </div>

        <input :value="dpiInput" type="number" min="1" :disabled="isAnalyzingDpi"
          class="mt-1 w-full rounded border border-brand-300 px-3 py-2 text-sm disabled:cursor-wait disabled:bg-brand-50 disabled:text-brand-500"
          @input="emit('update:dpi-input', $event.target.value)" />

        <p v-if="dpiAnalysisError" class="mt-1 text-xs text-amber-700">
          {{ dpiAnalysisError }} Using the current DPI value.
        </p>

        <template v-else-if="dpiAnalysis">
          <p v-if="dpiAnalysis.detected_median_dpi" class="mt-1 text-xs text-brand-600">
            Detected median:
            <strong>{{ dpiAnalysis.detected_median_dpi }} DPI</strong>
            across {{ dpiAnalysis.pages_with_scan_estimate }} of {{ dpiAnalysis.page_count }} pages. Recommended:
            <strong>{{ dpiAnalysis.recommended_dpi }} DPI</strong>.
          </p>

          <p v-else class="mt-1 text-xs text-brand-600">
            No dominant raster scan was detected. Using the {{ dpiAnalysis.recommended_dpi }} DPI fallback.
          </p>

          <p v-if="dpiAnalysis.ignored_probable_watermark_images > 0" class="mt-1 text-xs text-brand-500">
            Ignored {{ dpiAnalysis.ignored_probable_watermark_images }} small repeated watermark or logo image
            occurrences.
          </p>

          <details v-if="dpiAnalysis.warnings?.length" class="mt-1 text-xs text-brand-500">
            <summary class="cursor-pointer">Analysis details</summary>
            <ul class="mt-1 list-disc space-y-1 pl-4">
              <li v-for="warning in dpiAnalysis.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </details>
        </template>
      </div>

      <div>
        <div class="flex items-center gap-2">
          <label class="block text-sm font-medium text-brand-700">Binarization Threshold</label>
          <AppHelp label="About Binarization Threshold" title="Binarization Threshold"
            intro="The binarization threshold affects how grayscale images are converted to black and white."
            link-href="/info#Binarization-Threshold" link-label="More details in Info" trigger-text="?">
            <p>
              Adjusting the binarization threshold can improve OCR accuracy for images with varying contrast. This
              value can be between 0 and 256, where lower values make the image darker and higher values make it
              lighter.
            </p>
            <p>
              Note: In an OCR run, binarization is only applied after lines of text have been extracted from the
              images, before OCR is performed on each line.
            </p>
          </AppHelp>
        </div>
        <input :value="thresholdInput" type="number" min="0" max="256" step="5"
          class="mt-1 w-full rounded border border-brand-300 px-3 py-2 text-sm"
          @input="emit('update:threshold-input', $event.target.value)" />
      </div>

      <div>
        <label class="block text-sm font-medium text-brand-700">Page Layout</label>
        <select :value="spreadMode"
          class="mt-1 w-full rounded border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900"
          @change="emit('update:spread-mode', $event.target.value)">
          <option value="split-spread">Split Left/Right Spread</option>
          <option value="single">Single Page Per Scan</option>
        </select>
      </div>

      <div class="flex items-end">
        <label class="flex items-center gap-2 text-sm text-brand-700">
          <input :checked="strictTopToBottom" type="checkbox"
            @change="emit('update:strict-top-to-bottom', $event.target.checked)" />
          Strict top-to-bottom line sorting
        </label>
      </div>

      <div class="sm:col-span-2">
        <label class="flex items-center gap-2 text-sm text-brand-700">
          <input :checked="ijDisambiguation" type="checkbox"
            @change="emit('update:ij-disambiguation', $event.target.checked)" />
          Resolve Fraktur I/J from Lexicon
          <AppHelp label="About I/J disambiguation" title="Resolve Fraktur I/J from Lexicon"
            intro="When enabled, Mimir will attempt to resolve ambiguous Fraktur I/J characters using a lexicon."
            link-href="/info#I-J-Disambiguation" link-label="More details in Info" trigger-text="?">
            <p>
              This option can improve OCR accuracy for input texts. To address the fraktur convention that I and J
              are visually identical. When enabled, Mimir will use a lexicon to help determine the correct
              character based on context. Does not solve all I/J ambiguities, but can improve results for some texts.
            </p>
          </AppHelp>
        </label>
      </div>
    </div>
  </div>
</template>
