<script setup>
/**
 * @file Reusable help presentation for application views.
 */
import { Teleport, computed, onBeforeUnmount, ref, useId } from 'vue'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/vue'

const props = defineProps({
  /** Accessible label for the help trigger. */
  label: {
    type: String,
    default: 'More information',
  },
  /** Fallback help-trigger text when no custom trigger slot is supplied. */
  triggerText: {
    type: String,
    default: '?',
  },
  /** Optional heading displayed by this reusable section or help popover. */
  title: {
    type: String,
    default: '',
  },
  /** Optional opening explanation inside the help popover. */
  intro: {
    type: String,
    default: '',
  },
  /** Optional help/reference link URL rendered when a link label is also supplied. */
  linkHref: {
    type: String,
    default: '',
  },
  /** Visible text for the optional help/reference link. */
  linkLabel: {
    type: String,
    default: '',
  },
  /** Browsing context target for the optional help/reference link. */
  linkTarget: {
    type: String,
    default: '_self',
  },
  /** Nonnegative delay in milliseconds before dismissing help after pointer/focus leaves. */
  closeDelayMs: {
    type: Number,
    default: 100,
  },
})

const isOpen = ref(false)
const rootRef = ref(null)
const triggerRef = ref(null)
const floatingRef = ref(null)
const panelId = useId()
const titleId = useId()
let closeTimer = null

const { floatingStyles, update } = useFloating(triggerRef, floatingRef, {
  placement: 'bottom-start',
  strategy: 'fixed',
  middleware: [
    offset(8),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
  ],
  whileElementsMounted: autoUpdate,
})

const normalizedLinkHref = computed(() => String(props.linkHref || '').trim())
const normalizedLinkLabel = computed(() => String(props.linkLabel || '').trim())
const hasLink = computed(() => Boolean(normalizedLinkHref.value && normalizedLinkLabel.value))

/**
 * Cancel pending dismissal, show the help popover, and refresh its floating position.
 */
function open() {
  cancelScheduledClose()
  isOpen.value = true
  update()
}

/**
 * Cancel pending dismissal, hide help, and optionally restore keyboard focus to the trigger.
 */
function close({ restoreFocus = false } = {}) {
  cancelScheduledClose()
  isOpen.value = false
  if (restoreFocus) {
    triggerRef.value?.focus()
  }
}

/**
 * Clear the delayed popover-dismissal timeout when one is active.
 */
function cancelScheduledClose() {
  if (closeTimer != null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

/**
 * Replace the dismissal timer using the configured nonnegative close delay in milliseconds.
 */
function scheduleClose() {
  cancelScheduledClose()
  closeTimer = window.setTimeout(() => {
    isOpen.value = false
    closeTimer = null
  }, Math.max(0, Number(props.closeDelayMs) || 0))
}

/**
 * Cancel pending dismissal and switch the help popover's visibility.
 */
function toggle() {
  cancelScheduledClose()
  isOpen.value = !isOpen.value
}

/**
 * Keep help open while focus moves within its trigger/panel; otherwise schedule dismissal.
 */
function handleFocusOut(event) {
  const next = event.relatedTarget
  if (!(next instanceof Node)) {
    scheduleClose()
    return
  }

  const root = rootRef.value
  const floating = floatingRef.value
  if ((root && root.contains(next)) || (floating && floating.contains(next))) {
    return
  }
  scheduleClose()
}

/**
 * Close an open help popover on Escape and return focus to its trigger.
 */
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
      <!-- @slot Custom help-trigger content replacing the fallback trigger text. -->
      <slot name="trigger">
        {{ triggerText }}
      </slot>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        :id="panelId"
        ref="floatingRef"
        role="tooltip"
        class="z-30 w-72 max-w-[calc(100vw-2rem)] rounded border border-brand-200 bg-white p-3 text-sm font-normal text-brand-700 shadow-lg"
        :style="floatingStyles"
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
          <!-- @slot Additional explanatory content inside the floating help panel. -->
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
    </Teleport>
  </span>
</template>
