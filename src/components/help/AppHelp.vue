<script setup>
import { computed, onBeforeUnmount, ref, useId } from 'vue'

const props = defineProps({
  label: {
    type: String,
    default: 'More information',
  },
  triggerText: {
    type: String,
    default: '?',
  },
  title: {
    type: String,
    default: '',
  },
  intro: {
    type: String,
    default: '',
  },
  linkHref: {
    type: String,
    default: '',
  },
  linkLabel: {
    type: String,
    default: '',
  },
  linkTarget: {
    type: String,
    default: '_self',
  },
  closeDelayMs: {
    type: Number,
    default: 100,
  },
})

const isOpen = ref(false)
const rootRef = ref(null)
const triggerRef = ref(null)
const panelId = useId()
const titleId = useId()
let closeTimer = null

const normalizedLinkHref = computed(() => String(props.linkHref || '').trim())
const normalizedLinkLabel = computed(() => String(props.linkLabel || '').trim())
const hasLink = computed(() => Boolean(normalizedLinkHref.value && normalizedLinkLabel.value))

function open() {
  cancelScheduledClose()
  isOpen.value = true
}

function close({ restoreFocus = false } = {}) {
  cancelScheduledClose()
  isOpen.value = false
  if (restoreFocus) {
    triggerRef.value?.focus()
  }
}

function cancelScheduledClose() {
  if (closeTimer != null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

function scheduleClose() {
  cancelScheduledClose()
  closeTimer = window.setTimeout(() => {
    isOpen.value = false
    closeTimer = null
  }, Math.max(0, Number(props.closeDelayMs) || 0))
}

function toggle() {
  cancelScheduledClose()
  isOpen.value = !isOpen.value
}

function handleFocusOut(event) {
  const next = event.relatedTarget
  const root = rootRef.value
  if (root && next instanceof Node && root.contains(next)) {
    return
  }
  scheduleClose()
}

function handleKeydown(event) {
  if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault()
    close({ restoreFocus: true })
  }
}

onBeforeUnmount(() => {
  cancelScheduledClose()
})
</script>

<template>
  <span
    ref="rootRef"
    class="relative inline-flex"
    @mouseenter="open"
    @mouseleave="scheduleClose"
    @focusin="open"
    @focusout="handleFocusOut"
    @keydown="handleKeydown"
  >
    <button
      ref="triggerRef"
      type="button"
      class="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-brand-300 bg-white px-1.5 text-xs font-semibold text-brand-700 shadow-sm hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
      :aria-label="label"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      :aria-describedby="isOpen ? panelId : undefined"
      @click="toggle"
    >
      <slot name="trigger">
        {{ triggerText }}
      </slot>
    </button>

    <div
      v-if="isOpen"
      :id="panelId"
      role="tooltip"
      class="absolute left-0 top-7 z-30 w-72 max-w-[calc(100vw-2rem)] rounded border border-brand-200 bg-white p-3 text-sm font-normal text-brand-700 shadow-lg"
      :aria-labelledby="title ? titleId : undefined"
      @mouseenter="open"
      @mouseleave="scheduleClose"
      @focusin="open"
      @focusout="handleFocusOut"
    >
      <div v-if="title || intro" class="space-y-1">
        <h3 v-if="title" :id="titleId" class="text-sm font-semibold text-brand-900">{{ title }}</h3>
        <p v-if="intro" class="text-sm text-brand-600">{{ intro }}</p>
      </div>

      <div v-if="$slots.default" class="mt-2 space-y-2">
        <slot />
      </div>

      <div v-if="hasLink" class="mt-2 border-t border-brand-100 pt-2">
        <a
          :href="normalizedLinkHref"
          :target="linkTarget"
          :rel="linkTarget === '_blank' ? 'noopener noreferrer' : undefined"
          class="text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
        >
          {{ normalizedLinkLabel }}
        </a>
      </div>
    </div>
  </span>
</template>
