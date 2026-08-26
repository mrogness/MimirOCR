<script setup>
import SuspiciousCharacterHint from './SuspiciousCharacterHint.vue'

const props = defineProps({
  line: { type: Object, required: true },
  index: { type: Number, required: true },
  totalLines: { type: Number, required: true },
  activeLineId: { type: Number, default: null },
  selectedLineId: { type: Number, default: null },
  lineSaveState: { type: Object, required: true },
  showSuspiciousHints: { type: Boolean, required: true },
  lineHasSuspiciousChars: { type: Boolean, required: true },
  suspiciousSegments: { type: Array, required: true },
  rowRefFn: { type: Function, required: true },
})

const emit = defineEmits([
  'set-active-line',
  'select-line',
  'move-line',
  'commit-line-order-input',
  'delete-line',
  'line-input',
])

function onInput(event) {
  emit('line-input', props.line, event.target.value)
}

function onCommitOrder(event) {
  emit('commit-line-order-input', props.line, event.target.value)
}
</script>

<template>
  <div
    :ref="(el) => rowRefFn(line.id, el)"
    class="mb-1 rounded px-1.5 py-1 transition-colors duration-100"
    :class="line.id === activeLineId || line.id === selectedLineId ? 'bg-amber-200/70 ring-1 ring-amber-400' : 'hover:bg-brand-100/70'"
    @mouseenter="emit('set-active-line', line.id)"
    @click="emit('select-line', line.id)"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <button
          class="rounded border border-brand-300 px-1.5 py-0.5 text-[11px] text-brand-700 hover:bg-brand-100 disabled:opacity-40"
          :disabled="index === 0"
          @click.stop="emit('move-line', line, -1)"
        >
          ▲
        </button>
        <button
          class="rounded border border-brand-300 px-1.5 py-0.5 text-[11px] text-brand-700 hover:bg-brand-100 disabled:opacity-40"
          :disabled="index >= totalLines - 1"
          @click.stop="emit('move-line', line, 1)"
        >
          ▼
        </button>
        <input
          :value="line.line_order || index + 1"
          type="number"
          min="1"
          :max="totalLines"
          class="w-14 rounded border border-brand-300 bg-white px-1 py-0.5 text-[11px] text-brand-900"
          @click.stop
          @keydown.enter.prevent="onCommitOrder"
          @blur="onCommitOrder"
        />
        <button
          class="rounded border border-red-300 px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
          title="Delete line"
          @click.stop="emit('delete-line', line)"
        >
          Delete
        </button>
      </div>
      <span v-if="lineSaveState[line.id]?.status === 'saving'" class="text-[11px] text-brand-500">Saving...</span>
      <span v-else-if="lineSaveState[line.id]?.status === 'saved'" class="text-[11px] text-emerald-600">Saved</span>
      <span v-else-if="lineSaveState[line.id]?.status === 'error'" class="text-[11px] text-red-600">Save failed</span>
    </div>
    <textarea
      class="mt-1 w-full rounded border border-brand-200 bg-white px-1.5 py-1 text-xs leading-4 text-brand-900"
      rows="1"
      style="field-sizing: content; resize: none;"
      :value="line.corrected_text || line.ocr_text || ''"
      @input="onInput"
      @focus="emit('set-active-line', line.id)"
      @click.stop
    />
    <div
      v-if="showSuspiciousHints && lineHasSuspiciousChars"
      class="mt-1 rounded border border-brand-200 bg-white px-1.5 pt-0.5 pb-0.75 text-[11px] leading-4 text-brand-900"
    >
      <template
        v-for="segment in suspiciousSegments"
        :key="segment.id"
      >
        <SuspiciousCharacterHint v-if="segment.suspicious" :segment="segment" />
        <span v-else>{{ segment.ch }}</span>
      </template>
    </div>
    <p v-if="lineSaveState[line.id]?.status === 'error'" class="mt-1 text-[11px] text-red-700">
      {{ lineSaveState[line.id]?.message }}
    </p>
  </div>
</template>
