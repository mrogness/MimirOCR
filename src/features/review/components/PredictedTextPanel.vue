<script setup>
/**
 * @file Present recognized lines and relay review interactions to the parent workspace.
 */
import PredictedLineRow from './PredictedLineRow.vue'

const props = defineProps({
  /** Current page's review lines in displayed reading order. */
  selectedPageLines: { type: Array, required: true },
  /** Transiently active line ID used by hover and image-overlay highlighting. */
  activeLineId: { type: Number, default: null },
  /** Selected persistent line ID shared by the text panel and image overlay. */
  selectedLineId: { type: Number, default: null },
  /** Per-line save-status/message map used to show pending, saving, saved, and error feedback. */
  lineSaveState: { type: Object, required: true },
  /** Whether low-confidence character hints and their navigation should be displayed. */
  showSuspiciousHints: { type: Boolean, required: true },
  /** Character-confidence cutoff on the 0..1 probability scale. */
  suspiciousThreshold: { type: Number, required: true },
  /** Number of suspicious character targets on the current page. */
  suspiciousCount: { type: Number, default: 0 },
  /** One-based position of the active suspicious target, or zero when none is active. */
  currentSuspiciousIndex: { type: Number, default: 0 },
  /** Available review panel height in CSS pixels. */
  panelViewportHeight: { type: Number, required: true },
  /** Callback reporting whether a review line has any suspicious character segments. */
  lineHasSuspiciousChars: { type: Function, required: true },
  /** Callback returning the cached character-analysis records for a given review line. */
  suspiciousSegmentsForLine: { type: Function, required: true },
  /** Callback receiving a line ID and row element, or null on release, for synchronized scrolling. */
  rowRefFn: { type: Function, required: true },
})

const emit = defineEmits([
  /** Emit whether suspicious-character hints should be visible. */
  'update:showSuspiciousHints',
  /** Emit the numeric confidence cutoff on the 0..1 probability scale. */
  'update:suspiciousThreshold',
  /** Request advancing to the next suspicious character on this page. */
  'next-suspicious',
  /** Emit the line ID to highlight transiently. */
  'set-active-line',
  /** Request clearing transient line highlighting. */
  'clear-active-line',
  /** Emit the persistent line ID selected by the user. */
  'select-line',
  /** Emit a review line and relative order offset for a reorder operation. */
  'move-line',
  /** Emit a review line and raw absolute-order input for parent validation. */
  'commit-line-order-input',
  /** Emit the review line whose deletion is requested. */
  'delete-line',
  /** Emit a review line and its edited transcription string. */
  'line-input',
])

/**
 * Emit the checkbox state as the requested suspicious-character visibility setting.
 */
function onToggleSuspiciousHints(event) {
  emit('update:showSuspiciousHints', event.target.checked)
}

/**
 * Convert the confidence-threshold input to a number and emit the new cutoff.
 */
function onThresholdInput(event) {
  emit('update:suspiciousThreshold', Number(event.target.value))
}

/**
 * Relay a review line and relative order offset to the parent editing workflow.
 */
function onMoveLine(line, offset) {
  emit('move-line', line, offset)
}

/**
 * Relay a review line and raw absolute-order input to the parent editing workflow.
 */
function onCommitLineOrderInput(line, value) {
  emit('commit-line-order-input', line, value)
}

/**
 * Relay a review line and corrected text to the parent's save handler.
 */
function onLineInput(line, value) {
  emit('line-input', line, value)
}
</script>

<template>
  <article class="flex min-h-0 flex-col rounded border border-brand-200 bg-white p-3">
    <h2 class="text-sm font-semibold text-brand-700">Predicted Text</h2>
    <p class="mt-1 text-xs text-brand-500">Edit text in lines to correct OCR errors.</p>
    <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-brand-600">
      <label class="flex items-center gap-2">
        <input :checked="showSuspiciousHints" type="checkbox" @change="onToggleSuspiciousHints" />
        Flag suspicious characters
      </label>
      <label class="flex items-center gap-2">
        <span>Threshold</span>
        <input
          :value="suspiciousThreshold"
          type="range"
          min="0.75"
          max="0.99"
          step="0.01"
          class="w-28"
          @input="onThresholdInput"
        />
        <span>{{ Math.round(suspiciousThreshold * 100) }}%</span>
      </label>
      <button
        class="rounded border border-brand-300 px-2 py-1 font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="suspiciousCount <= 0"
        @click="emit('next-suspicious')"
      >
        Find Next Suspicious
      </button>
      <span class="text-xs text-brand-600">
        {{ suspiciousCount > 0 ? `${currentSuspiciousIndex || 1}/${suspiciousCount}` : '0/0' }}
      </span>
    </div>

    <div
      class="mt-3 min-h-0 flex-1 overflow-auto rounded border border-brand-200 bg-brand-50/40 p-2 font-mono text-sm"
      @mouseleave="emit('clear-active-line')"
    >
      <PredictedLineRow
        v-for="(line, index) in selectedPageLines"
        :key="line.id"
        :line="line"
        :index="index"
        :total-lines="selectedPageLines.length"
        :active-line-id="activeLineId"
        :selected-line-id="selectedLineId"
        :line-save-state="lineSaveState"
        :show-suspicious-hints="showSuspiciousHints"
        :line-has-suspicious-chars="lineHasSuspiciousChars(line)"
        :suspicious-segments="suspiciousSegmentsForLine(line)"
        :row-ref-fn="rowRefFn"
        @set-active-line="emit('set-active-line', $event)"
        @select-line="emit('select-line', $event)"
        @move-line="onMoveLine"
        @commit-line-order-input="onCommitLineOrderInput"
        @delete-line="emit('delete-line', $event)"
        @line-input="onLineInput"
      />
    </div>
  </article>
</template>
