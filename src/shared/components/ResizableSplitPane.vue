<script setup>
/**
 * @file Two-pane layout with pointer and keyboard resizing, saved widths, and a stacked
 * narrow-window mode.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  /** Initial left-pane width in CSS pixels before a saved preference or clamping is applied. */
  initialLeftWidth: {
    // Widths are CSS pixels; the parent receives the applied left width in resize events.
    type: Number,
    default: 480,
  },
  /** Minimum preferred left-pane width in CSS pixels. */
  minLeftWidth: {
    type: Number,
    default: 320,
  },
  /** Maximum preferred left-pane width in CSS pixels. */
  maxLeftWidth: {
    type: Number,
    default: 800,
  },
  /** Minimum preferred right-pane width in CSS pixels when clamping the left pane. */
  minRightWidth: {
    type: Number,
    default: 420,
  },
  /** Maximum preferred right-pane width in CSS pixels when clamping the left pane. */
  maxRightWidth: {
    type: Number,
    default: 1400,
  },
  /** Optional localStorage key for preserving the user's selected pane width. */
  storageKey: {
    type: String,
    default: '',
  },
  /** Stack panes and disable dragging below this container width in CSS pixels. */
  disabledBreakpoint: {
    type: Number,
    default: 768,
  },
})

const emit = defineEmits([
  /** Emit the currently applied left-pane width in CSS pixels during resizing. */
  'resize',
  /** Emit the final persisted left-pane width in CSS pixels after a resize interaction. */
  'resize-end',
])

const containerRef = ref(null)
const leftWidth = ref(props.initialLeftWidth)
const isDragging = ref(false)
const isStacked = ref(false)

const DIVIDER_WIDTH = 8
const KEYBOARD_STEP = 20

let resizeObserver = null
let removePointerListeners = null

const gridStyle = computed(() => ({
  gridTemplateColumns: `${leftWidth.value}px ${DIVIDER_WIDTH}px minmax(0, 1fr)`,
}))

/**
 * Read a finite saved left-pane width from localStorage when a storage key is configured.
 */
function getSavedWidth() {
  if (!props.storageKey) {
    return null
  }

  const savedWidth = Number(localStorage.getItem(props.storageKey))

  return Number.isFinite(savedWidth) ? savedWidth : null
}

/**
 * Persist the current left-pane width only when a storage key is configured.
 */
function saveWidth() {
  if (!props.storageKey) {
    return
  }

  localStorage.setItem(props.storageKey, String(leftWidth.value))
}

/** Clamp the left pane against both panes' limits and the current container width. */
function clampLeftWidth(requestedWidth) {
  const containerWidth = containerRef.value?.clientWidth ?? 0

  if (containerWidth <= 0) {
    return requestedWidth
  }

  const minimumAllowed = Math.max(
    props.minLeftWidth,
    containerWidth - DIVIDER_WIDTH - props.maxRightWidth,
  )

  const maximumAllowed = Math.min(
    props.maxLeftWidth,
    containerWidth - DIVIDER_WIDTH - props.minRightWidth,
  )

  /*
   * The window may temporarily be narrower than the combined minimum widths.
   * In that case, prioritize keeping the left pane usable without producing
   * an invalid clamp range.
   */
  if (maximumAllowed < minimumAllowed) {
    return Math.max(
      0,
      Math.min(
        requestedWidth,
        containerWidth - DIVIDER_WIDTH - props.minRightWidth,
      ),
    )
  }

  return Math.min(
    maximumAllowed,
    Math.max(minimumAllowed, requestedWidth),
  )
}

/**
 * Clamp a requested width, reject nonfinite results, update layout state, and emit the
 * applied pixel width.
 */
function setLeftWidth(requestedWidth) {
  const nextWidth = clampLeftWidth(requestedWidth)

  if (!Number.isFinite(nextWidth)) {
    return
  }

  leftWidth.value = nextWidth
  emit('resize', nextWidth)
}

/**
 * Convert pointer position relative to the container into a left-pane width during active
 * dragging.
 */
function handlePointerMove(event) {
  if (!isDragging.value || !containerRef.value) {
    return
  }

  const containerRect = containerRef.value.getBoundingClientRect()
  const requestedWidth = event.clientX - containerRect.left

  setLeftWidth(requestedWidth)
}

/** Release global pointer listeners, persist width, and announce the final size. */
function stopDragging() {
  if (!isDragging.value) {
    return
  }

  isDragging.value = false
  document.body.classList.remove('select-none', 'cursor-col-resize')

  removePointerListeners?.()
  removePointerListeners = null

  saveWidth()
  emit('resize-end', leftWidth.value)
}

/**
 * Begin pointer resizing outside stacked mode, prevent text selection, and attach global
 * move/end listeners.
 */
function startDragging(event) {
  if (isStacked.value || !containerRef.value) {
    return
  }

  event.preventDefault()

  isDragging.value = true
  document.body.classList.add('select-none', 'cursor-col-resize')

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', stopDragging)
  window.addEventListener('pointercancel', stopDragging)

  /**
   * Detach the global pointer move/up/cancel handlers registered for the current drag.
   */
  removePointerListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopDragging)
    window.removeEventListener('pointercancel', stopDragging)
  }
}

/**
 * Resize with arrow keys or jump to bounds with Home/End, then persist and emit the final
 * width.
 */
function handleSeparatorKeydown(event) {
  if (isStacked.value) {
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    setLeftWidth(leftWidth.value - KEYBOARD_STEP)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    setLeftWidth(leftWidth.value + KEYBOARD_STEP)
  } else if (event.key === 'Home') {
    event.preventDefault()
    setLeftWidth(props.minLeftWidth)
  } else if (event.key === 'End') {
    event.preventDefault()
    setLeftWidth(props.maxLeftWidth)
  } else {
    return
  }

  saveWidth()
  emit('resize-end', leftWidth.value)
}

/**
 * Restore the configured initial width through clamping, persist it, and emit resize
 * completion.
 */
function resetWidth() {
  setLeftWidth(props.initialLeftWidth)
  saveWidth()
  emit('resize-end', leftWidth.value)
}

/**
 * Choose stacked layout below the breakpoint and reclamp pane width when returning to split
 * layout.
 */
function updateStackedState(width = containerRef.value?.clientWidth ?? 0) {
  if (width <= 0) {
    return
  }

  isStacked.value = width < props.disabledBreakpoint

  if (!isStacked.value) {
    setLeftWidth(leftWidth.value)
  }
}

/**
 * Read the ResizeObserver's first content width and update stacked/split state.
 */
function handleContainerResize(entries) {
  const width = entries[0]?.contentRect.width ?? 0
  updateStackedState(width)
}

watch(
  () => props.disabledBreakpoint,
  () => {
    updateStackedState()
  },
)

onMounted(() => {
  const savedWidth = getSavedWidth()

  if (savedWidth !== null) {
    leftWidth.value = savedWidth
  }

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(handleContainerResize)
    resizeObserver.observe(containerRef.value)

    updateStackedState()
  }
})

onBeforeUnmount(() => {
  removePointerListeners?.()
  resizeObserver?.disconnect()

  document.body.classList.remove('select-none', 'cursor-col-resize')
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:grid"
    :style="isStacked ? undefined : gridStyle"
  >
    <!-- Left pane -->
    <section
      class="min-h-0 min-w-0 overflow-auto md:h-full"
      :class="{
        'border-b border-slate-200 dark:border-slate-700 md:border-b-0':
          isStacked,
      }"
    >
      <!-- @slot Content of the resizable left pane. -->
      <slot name="left" />
    </section>

    <!-- Draggable separator -->
    <div
      v-show="!isStacked"
      role="separator"
      aria-label="Resize project details and PDF preview"
      aria-orientation="vertical"
      :aria-valuemin="minLeftWidth"
      :aria-valuemax="maxLeftWidth"
      :aria-valuenow="Math.round(leftWidth)"
      tabindex="0"
      class="
        group relative z-20 hidden h-full
        cursor-col-resize touch-none outline-none
        md:block
      "
      @pointerdown="startDragging"
      @keydown="handleSeparatorKeydown"
      @dblclick="resetWidth"
    >
      <!-- Visible divider line -->
      <div
        class="
          absolute inset-y-0 left-1/2 w-px -translate-x-1/2
          bg-slate-300 transition-[width,background-color]
          group-hover:w-0.5 group-hover:bg-sky-500
          group-focus-visible:w-0.5 group-focus-visible:bg-sky-500
          dark:bg-slate-700 dark:group-hover:bg-sky-400
          dark:group-focus-visible:bg-sky-400
        "
        :class="{
          'w-0.5 bg-sky-500 dark:bg-sky-400': isDragging,
        }"
      />

      <!-- Optional drag handle -->
      <div
        class="
          pointer-events-none absolute left-1/2 top-1/2
          flex h-12 w-3 -translate-x-1/2 -translate-y-1/2
          items-center justify-center rounded-full
          border border-slate-300 bg-white opacity-0 shadow-sm
          transition-opacity
          group-hover:opacity-100 group-focus-visible:opacity-100
          dark:border-slate-600 dark:bg-slate-800
        "
        :class="{ 'opacity-100': isDragging }"
      >
        <div class="flex gap-0.5">
          <span class="h-4 w-px bg-slate-400 dark:bg-slate-500" />
          <span class="h-4 w-px bg-slate-400 dark:bg-slate-500" />
        </div>
      </div>
    </div>

    <!-- Right pane -->
    <section class="min-h-0 min-w-0 overflow-hidden md:h-full">
      <!-- @slot Content of the remaining right pane. -->
      <slot name="right" />
    </section>
  </div>
</template>
