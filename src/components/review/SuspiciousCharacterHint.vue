<script setup>
import { Teleport, ref, useId } from 'vue'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/vue'

defineProps({
  segment: { type: Object, required: true },
})

const isOpen = ref(false)
const triggerRef = ref(null)
const tooltipRef = ref(null)
const tooltipId = useId()

const { floatingStyles, update } = useFloating(triggerRef, tooltipRef, {
  placement: 'top-start',
  strategy: 'fixed',
  middleware: [
    offset(6),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
  ],
  whileElementsMounted: autoUpdate,
})

function openTooltip() {
  isOpen.value = true
  update()
}

function closeTooltip() {
  isOpen.value = false
}
</script>

<template>
  <span
    ref="triggerRef"
    class="suspicious-character cursor-help rounded-sm focus:outline-none focus:ring-2 focus:ring-red-400/70"
    tabindex="0"
    :aria-describedby="isOpen ? tooltipId : undefined"
    @mouseenter="openTooltip"
    @mouseleave="closeTooltip"
    @focus="openTooltip"
    @blur="closeTooltip"
    @keydown.esc.stop="closeTooltip"
  >{{ segment.ch }}</span>

  <Teleport to="body">
    <div
      v-if="isOpen"
      :id="tooltipId"
      ref="tooltipRef"
      role="tooltip"
      class="pointer-events-none z-40 w-60 max-w-[calc(100vw-1rem)] rounded border border-brand-200 bg-white p-2.5 text-left font-sans text-xs font-normal leading-4 text-brand-700 shadow-lg"
      :style="floatingStyles"
    >
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-brand-500">Displayed character</span>
        <span class="font-mono text-sm font-semibold text-brand-900">{{ segment.ch }}</span>
      </div>
      <div class="mt-1 flex items-baseline justify-between gap-3">
        <span class="text-brand-500">
          {{ segment.confidenceKind === 'line' ? 'Line confidence' : 'Character confidence' }}
        </span>
        <span class="font-semibold text-brand-900">{{ segment.confidenceLabel }}</span>
      </div>

      <div
        v-if="segment.modelCharacter && segment.modelCharacter !== segment.ch"
        class="mt-2 rounded bg-amber-50 px-2 py-1 text-amber-900"
      >
        OCR originally returned <span class="font-mono font-semibold">{{ segment.modelCharacter }}</span>;
        a text-normalization rule displayed <span class="font-mono font-semibold">{{ segment.ch }}</span>.
      </div>

      <div v-if="segment.candidates.length" class="mt-2 border-t border-brand-100 pt-2">
        <p class="font-semibold text-brand-800">OCR candidates</p>
        <ul class="mt-1 space-y-0.5">
          <li
            v-for="candidate in segment.candidates"
            :key="candidate.ch"
            class="flex items-baseline justify-between gap-3"
          >
            <span class="font-mono text-sm text-brand-900">{{ candidate.ch }}</span>
            <span class="tabular-nums text-brand-600">{{ candidate.confidenceLabel }}</span>
          </li>
        </ul>
      </div>
      <p v-else class="mt-2 border-t border-brand-100 pt-2 text-brand-500">
        Candidate characters were not saved for this OCR run.
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.suspicious-character {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: #dc2626;
  text-decoration-thickness: 1.5px;
  text-underline-offset: 3px;
}
</style>
