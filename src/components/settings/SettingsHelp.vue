<script setup>
import { ref, useId } from 'vue'

defineProps({
  label: {
    type: String,
    default: 'More information',
  },
})

const isOpen = ref(false)
const helpId = useId()

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    close()
  }
}
</script>

<template>
  <span
    class="relative inline-flex"
    @mouseenter="open"
    @mouseleave="close"
    @focusin="open"
    @focusout="close"
    @keydown="handleKeydown"
  >
    <button
      type="button"
      class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-xs font-semibold text-brand-600 hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
      :aria-label="label"
      :aria-describedby="isOpen ? helpId : undefined"
      @click="isOpen = !isOpen"
    >
      ?
    </button>

    <div
      v-if="isOpen"
      :id="helpId"
      role="tooltip"
      class="absolute left-0 top-7 z-30 w-64 rounded border border-brand-200 bg-white p-3 text-sm font-normal text-brand-700 shadow-lg"
    >
      <slot />
    </div>
  </span>
</template>
