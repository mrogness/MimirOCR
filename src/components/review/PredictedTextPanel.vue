<script setup>
import PredictedLineRow from './PredictedLineRow.vue'

const props = defineProps({
  selectedPageLines: { type: Array, required: true },
  activeLineId: { type: Number, default: null },
  selectedLineId: { type: Number, default: null },
  lineSaveState: { type: Object, required: true },
  showSuspiciousHints: { type: Boolean, required: true },
  suspiciousThreshold: { type: Number, required: true },
  suspiciousCount: { type: Number, default: 0 },
  currentSuspiciousIndex: { type: Number, default: 0 },
  panelViewportHeight: { type: Number, required: true },
  lineHasSuspiciousChars: { type: Function, required: true },
  suspiciousSegmentsForLine: { type: Function, required: true },
  rowRefFn: { type: Function, required: true },
})

const emit = defineEmits([
  'update:showSuspiciousHints',
  'update:suspiciousThreshold',
  'next-suspicious',
  'set-active-line',
  'clear-active-line',
  'select-line',
  'move-line',
  'commit-line-order-input',
  'delete-line',
  'line-input',
])

function onToggleSuspiciousHints(event) {
  emit('update:showSuspiciousHints', event.target.checked)
}

function onThresholdInput(event) {
  emit('update:suspiciousThreshold', Number(event.target.value))
}

function onMoveLine(line, offset) {
  emit('move-line', line, offset)
}

function onCommitLineOrderInput(line, value) {
  emit('commit-line-order-input', line, value)
}

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
