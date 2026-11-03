<script setup>
/**
 * @file Display page imagery with scaled line, polygon, selection, and suspicious-character
 * overlays.
 */
import { computed } from 'vue'

const props = defineProps({
  /** Persisted page record whose raster dimensions define the overlay coordinate space. */
  selectedPage: { type: Object, default: null },
  /** Backend image URL for the selected persisted review page. */
  selectedPageImageUrl: { type: String, default: '' },
  /** Callback receiving the rendered page image element for viewport measurement. */
  setImageRef: { type: Function, required: true },
  /** Callback receiving the scrollable overlay container element. */
  setOverlayPanelRef: { type: Function, required: true },
  /** Requested displayed image width in CSS pixels after applying zoom. */
  imageDisplayWidth: { type: Number, required: true },
  /** Requested displayed image height in CSS pixels after applying zoom. */
  imageDisplayHeight: { type: Number, required: true },
  /** Measured or computed displayed image width used by the overlay layout. */
  renderedImageWidth: { type: Number, required: true },
  /** Measured or computed displayed image height used by the overlay layout. */
  renderedImageHeight: { type: Number, required: true },
  /** Available review panel height in CSS pixels. */
  panelViewportHeight: { type: Number, required: true },
  /** Current image scale relative to its base dimensions. */
  zoomLevel: { type: Number, required: true },
  /** Whether valid line polygons should be preferred over rectangular overlays. */
  usePolygonOverlay: { type: Boolean, required: true },
  /** Review line records with usable polygon or bounding-box geometry. */
  linesWithGeometry: { type: Array, required: true },
  /** Horizontal multiplier from source page pixels to displayed image pixels. */
  boxScaleX: { type: Number, required: true },
  /** Vertical multiplier from source page pixels to displayed image pixels. */
  boxScaleY: { type: Number, required: true },
  /** Predicate deciding whether a line should use its polygon representation. */
  shouldRenderPolygon: { type: Function, required: true },
  /** Callback formatting source polygon points at the current display scale for SVG. */
  polygonPointsString: { type: Function, required: true },
  /** Callback selecting SVG highlight classes for an active or selected line. */
  overlayLineClass: { type: Function, required: true },
  /** Low-confidence character rectangles in source page pixels. */
  suspiciousCharBoxes: {
    type: Array,
    /** Create an independent empty rectangle array for this component instance. */
    default: () => [],
  },
  /** Currently targeted suspicious-character rectangle ID, or null when none is selected. */
  activeSuspiciousBoxId: { type: String, default: null },
})

const emit = defineEmits([
  /** Emit the boolean polygon-overlay preference. */
  'update:usePolygonOverlay',
  /** Request one bounded zoom-out step. */
  'zoom-out',
  /** Forward the zoom-slider DOM event for parsing by the parent viewport controller. */
  'zoom-slider-input',
  /** Request one bounded zoom-in step. */
  'zoom-in',
  /** Request a zoom that fits page height in the available image panel. */
  'fit-page-height',
  /** Emit wheel deltaY and clientX/clientY pointer coordinates for anchored trackpad zoom. */
  'trackpad-zoom',
  /** Request clearing transient line highlighting. */
  'clear-active-line',
  /** Emit the line ID to highlight transiently. */
  'set-active-line',
  /** Emit the persistent line ID selected by the user. */
  'select-line',
  /** Forward the image-load DOM event so the parent can initialize image measurements. */
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

/**
 * Build the SVG clipping-path ID associated with one review line.
 */
function clipPathIdForLine(lineId) {
  return `line-clip-${lineId}`
}

/**
 * Enable polygon clipping only when the overlay preference and supplied geometry predicate
 * permit it.
 */
function canUsePolygonClip(line) {
  return (
    props.usePolygonOverlay &&
    line &&
    typeof props.shouldRenderPolygon === 'function' &&
    props.shouldRenderPolygon(line)
  )
}

/**
 * Forward the overlay container element to the parent viewport controller.
 */
function onOverlayPanelRef(el) {
  props.setOverlayPanelRef(el)
}

/**
 * Forward the page image element to the parent viewport controller.
 */
function onImageRef(el) {
  props.setImageRef(el)
}

/**
 * Forward the original zoom-slider DOM event to the parent's zoom controller.
 */
function onZoomInput(event) {
  emit('zoom-slider-input', event)
}

/**
 * Emit the checkbox's boolean value as the requested polygon-overlay preference.
 */
function onPolygonOverlayToggle(event) {
  emit('update:usePolygonOverlay', event.target.checked)
}

/**
 * Forward image-load completion so the parent can measure dimensions and initialize zoom.
 */
function onPageImageLoad(event) {
  emit('page-image-load', event)
}

/**
 * Translate Ctrl/Cmd-wheel gestures into trackpad-zoom deltas and pointer coordinates while
 * preserving normal scrolling.
 */
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
