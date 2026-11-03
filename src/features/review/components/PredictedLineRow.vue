<script setup>
/**
 * @file Render one review line with editing, confidence, ordering, and deletion controls.
 */
import SuspiciousCharacterHint from './SuspiciousCharacterHint.vue'

const props = defineProps({
  /** Persisted review line whose text, ordering, and recognition metadata are displayed. */
  line: { type: Object, required: true },
  /** Zero-based display index of this line in the current page. */
  index: { type: Number, required: true },
  /** Number of lines on the current page, used to bound reorder controls. */
  totalLines: { type: Number, required: true },
  /** Transiently active line ID used by hover and image-overlay highlighting. */
  activeLineId: { type: Number, default: null },
  /** Selected persistent line ID shared by the text panel and image overlay. */
  selectedLineId: { type: Number, default: null },
  /** Per-line save-status/message map used to show pending, saving, saved, and error feedback. */
  lineSaveState: { type: Object, required: true },
  /** Whether low-confidence character hints and their navigation should be displayed. */
  showSuspiciousHints: { type: Boolean, required: true },
  /** Whether this row contains any suspicious character segments. */
  lineHasSuspiciousChars: { type: Boolean, required: true },
  /** Character display records with suspicious flags, confidence labels, and alternative candidates. */
  suspiciousSegments: { type: Array, required: true },
  /** Callback receiving a line ID and row element, or null on release, for synchronized scrolling. */
  rowRefFn: { type: Function, required: true },
})

const emit = defineEmits([
  /** Emit the line ID to highlight transiently. */
  'set-active-line',
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
 * Emit the line record and edited transcription for the parent's debounced save workflow.
 */
function onInput(event) {
  emit('line-input', props.line, event.target.value)
}

/**
 * Emit the line record and raw requested order for validation and persistence by the parent.
 */
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
