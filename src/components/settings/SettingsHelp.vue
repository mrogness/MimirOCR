<script setup>
import { onBeforeUnmount, ref, useId } from 'vue'

defineProps({
  label: {
    type: String,
    default: 'More information',
  },
})

const isOpen = ref(false)
const helpId = useId()
const root = ref(null)

function toggle() {
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function handleDocumentClick(event) {
  if (isOpen.value && root.value && !root.value.contains(event.target)) {
    close()
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    close()
  }
}

document.addEventListener('click', handleDocumentClick)
document.addEventListener('keydown', handleKeydown)

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <span ref="root" class="relative inline-flex">
    <button
      type="button"
      class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-brand-300 text-xs font-semibold text-brand-600 hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
      :aria-label="label"
      :aria-expanded="isOpen"
      :aria-controls="helpId"
      @click.stop="toggle"
    >
      ?
    </button>

    <div
      v-if="isOpen"
      :id="helpId"
      role="note"
      class="absolute left-0 top-7 z-30 w-72 rounded border border-brand-200 bg-white p-3 text-sm font-normal text-brand-700 shadow-lg"
    >
      <slot />
    </div>
  </span>
</template>
