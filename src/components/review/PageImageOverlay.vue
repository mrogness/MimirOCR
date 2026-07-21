<script setup>
import { computed } from 'vue'

const props = defineProps({
  selectedPage: { type: Object, default: null },
  selectedPageImageUrl: { type: String, default: '' },
  setImageRef: { type: Function, required: true },
  setOverlayPanelRef: { type: Function, required: true },
  imageDisplayWidth: { type: Number, required: true },
  imageDisplayHeight: { type: Number, required: true },
  renderedImageWidth: { type: Number, required: true },
  renderedImageHeight: { type: Number, required: true },
  panelViewportHeight: { type: Number, required: true },
  zoomLevel: { type: Number, required: true },
  usePolygonOverlay: { type: Boolean, required: true },
  linesWithGeometry: { type: Array, required: true },
  boxScaleX: { type: Number, required: true },
  boxScaleY: { type: Number, required: true },
  shouldRenderPolygon: { type: Function, required: true },
  polygonPointsString: { type: Function, required: true },
  overlayLineClass: { type: Function, required: true },
  suspiciousCharBoxes: { type: Array, default: () => [] },
  activeSuspiciousBoxId: { type: String, default: null },
})

const emit = defineEmits([
  'update:usePolygonOverlay',
  'zoom-out',
  'zoom-slider-input',
  'zoom-in',
  'fit-page-height',
  'trackpad-zoom',
  'clear-active-line',
  'set-active-line',
  'select-line',
  'page-image-load',
])

const MAX_OVERLAY_LINES = 700

const drawableLines = computed(() => {
  if (!Array.isArray(props.linesWithGeometry)) {
    return []
  }

  if (props.linesWithGeometry.length <= MAX_OVERLAY_LINES) {
    return props.linesWithGeometry
  }

  return props.linesWithGeometry.slice(0, MAX_OVERLAY_LINES)
})

const overlayWasTruncated = computed(
  () => Array.isArray(props.linesWithGeometry) && props.linesWithGeometry.length > drawableLines.value.length
)

const drawableLineById = computed(() => {
  const map = new Map()
  for (const line of drawableLines.value) {
    map.set(line.id, line)
  }
  return map
})

function clipPathIdForLine(lineId) {
  return `line-clip-${lineId}`
}

function canUsePolygonClip(line) {
  return (
    props.usePolygonOverlay &&
    line &&
    typeof props.shouldRenderPolygon === 'function' &&
    props.shouldRenderPolygon(line)
  )
}

function onOverlayPanelRef(el) {
  props.setOverlayPanelRef(el)
}

function onImageRef(el) {
  props.setImageRef(el)
}

function onZoomInput(event) {
  emit('zoom-slider-input', event)
}

function onPolygonOverlayToggle(event) {
  emit('update:usePolygonOverlay', event.target.checked)
}

function onPageImageLoad(event) {
  emit('page-image-load', event)
}

function onOverlayWheel(event) {
  // Trackpad pinch gestures arrive as wheel events with ctrl/meta pressed.
  if (!event.ctrlKey && !event.metaKey) {
    return
  }

  event.preventDefault()
  emit('trackpad-zoom', {
    deltaY: event.deltaY,
    clientX: event.clientX,
    clientY: event.clientY,
  })
}
</script>

<template>
  <article class="flex min-h-0 flex-col rounded border border-brand-200 bg-white p-3">
    <h2 class="text-sm font-semibold text-brand-700"></h2>
    <p class="mt-1 text-xs text-brand-500"></p>

    <div class="mt-2 flex flex-wrap items-center gap-2">
      <button class="rounded border border-brand-300 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100" @click="emit('zoom-out')">-</button>
      <input
        type="range"
        min="0.1"
        max="3"
        step="0.05"
        class="w-44"
        :value="zoomLevel"
        @input="onZoomInput"
      />
      <button class="rounded border border-brand-300 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100" @click="emit('zoom-in')">+</button>
      <button class="rounded border border-brand-300 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100" @click="emit('fit-page-height')">Fit Height</button>
      <span class="text-xs text-brand-500">{{ Math.round(zoomLevel * 100) }}%</span>
      <label class="ml-4 flex items-center gap-2 text-xs text-brand-600">
        <input :checked="usePolygonOverlay" type="checkbox" @change="onPolygonOverlayToggle" />
        Use raw polygon overlay
      </label>
      <span v-if="overlayWasTruncated" class="text-xs text-amber-700">
        Showing first {{ drawableLines.length }} overlays for responsiveness.
      </span>
    </div>

    <div
      :ref="onOverlayPanelRef"
      class="relative mt-3 min-h-0 flex-1 overflow-auto rounded border border-brand-200 bg-gray-50"
      @wheel="onOverlayWheel"
      @mouseleave="emit('clear-active-line')"
    >
      <img
        :ref="onImageRef"
        :src="selectedPageImageUrl"
        alt="OCR page"
        class="block h-auto max-w-none"
        :style="{ width: `${imageDisplayWidth}px`, height: `${imageDisplayHeight}px` }"
        @load="onPageImageLoad"
      />

      <svg
        class="absolute left-0 top-0"
        :width="renderedImageWidth"
        :height="renderedImageHeight"
      >
        <defs>
          <clipPath
            v-for="line in drawableLines"
            :id="clipPathIdForLine(line.id)"
            :key="`clip-${line.id}`"
          >
            <polygon
              v-if="canUsePolygonClip(line)"
              :points="polygonPointsString(line.polygon_points)"
            />
            <rect
              v-else-if="line.bounding_box"
              :x="line.bounding_box.x_min * boxScaleX"
              :y="line.bounding_box.y_min * boxScaleY"
              :width="(line.bounding_box.x_max - line.bounding_box.x_min) * boxScaleX"
              :height="(line.bounding_box.y_max - line.bounding_box.y_min) * boxScaleY"
            />
          </clipPath>
        </defs>

        <template v-for="line in drawableLines" :key="line.id">
          <polygon
            v-if="shouldRenderPolygon(line)"
            :points="polygonPointsString(line.polygon_points)"
            class="transition-colors duration-100"
            :class="overlayLineClass(line)"
            stroke-width="2"
            @mouseenter="emit('set-active-line', line.id)"
            @click="emit('select-line', line.id)"
          />
          <rect
            v-else
            class="transition-colors duration-100"
            :class="overlayLineClass(line)"
            stroke-width="2"
            :x="line.bounding_box.x_min * boxScaleX"
            :y="line.bounding_box.y_min * boxScaleY"
            :width="(line.bounding_box.x_max - line.bounding_box.x_min) * boxScaleX"
            :height="(line.bounding_box.y_max - line.bounding_box.y_min) * boxScaleY"
            @mouseenter="emit('set-active-line', line.id)"
            @click="emit('select-line', line.id)"
          />
        </template>

        <rect
          v-for="charBox in suspiciousCharBoxes"
          :key="charBox.id"
          :class="charBox.id === activeSuspiciousBoxId ? 'fill-amber-500/55' : 'fill-red-500/35'"
          :x="charBox.x * boxScaleX"
          :y="charBox.y * boxScaleY"
          :width="charBox.width * boxScaleX"
          :height="charBox.height * boxScaleY"
          :clip-path="`url(#${clipPathIdForLine(charBox.lineId)})`"
          pointer-events="none"
        />
      </svg>
    </div>
  </article>
</template>
