<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  initialLeftWidth: {
    type: Number,
    default: 480,
  },
  minLeftWidth: {
    type: Number,
    default: 320,
  },
  maxLeftWidth: {
    type: Number,
    default: 800,
  },
  minRightWidth: {
    type: Number,
    default: 420,
  },
  maxRightWidth: {
    type: Number,
    default: 1400,
  },
  storageKey: {
    type: String,
    default: '',
  },
  disabledBreakpoint: {
    type: Number,
    default: 768,
  },
})

const emit = defineEmits(['resize', 'resize-end'])

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

const separatorStyle = computed(() => ({
  left: `${leftWidth.value}px`,
}))

function getSavedWidth() {
  if (!props.storageKey) {
    return null
  }

  const savedWidth = Number(localStorage.getItem(props.storageKey))

  return Number.isFinite(savedWidth) ? savedWidth : null
}

function saveWidth() {
  if (!props.storageKey) {
    return
  }

  localStorage.setItem(props.storageKey, String(leftWidth.value))
}

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

function setLeftWidth(requestedWidth) {
  const nextWidth = clampLeftWidth(requestedWidth)

  if (!Number.isFinite(nextWidth)) {
    return
  }

  leftWidth.value = nextWidth
  emit('resize', nextWidth)
}

function handlePointerMove(event) {
  if (!isDragging.value || !containerRef.value) {
    return
  }

  const containerRect = containerRef.value.getBoundingClientRect()
  const requestedWidth = event.clientX - containerRect.left

  setLeftWidth(requestedWidth)
}

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

  removePointerListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopDragging)
    window.removeEventListener('pointercancel', stopDragging)
  }
}

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

function resetWidth() {
  setLeftWidth(props.initialLeftWidth)
  saveWidth()
  emit('resize-end', leftWidth.value)
}

function handleContainerResize(entries) {
  const width = entries[0]?.contentRect.width ?? 0

  isStacked.value = width < props.disabledBreakpoint

  if (!isStacked.value) {
    setLeftWidth(leftWidth.value)
  }
}

onMounted(() => {
  const savedWidth = getSavedWidth()

  if (savedWidth !== null) {
    leftWidth.value = savedWidth
  }

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(handleContainerResize)
    resizeObserver.observe(containerRef.value)

    setLeftWidth(leftWidth.value)
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
      <slot name="right" />
    </section>
  </div>
</template>