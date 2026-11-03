<script setup>
/** @file Present host paths, connection probes, and startup details in an expandable diagnostics panel. */
defineProps({
  /** Whether the diagnostics details panel is expanded. */
  isOpen: Boolean,
  /** Whether a diagnostics snapshot request is currently pending. */
  isRefreshing: Boolean,
  /** Host-reported backend launch mode for diagnostic display. */
  backendMode: String,
  /** Host-reported backend runtime description. */
  backendRuntime: String,
  /** Backend executable or interpreter path selected by the desktop host. */
  sidecarSelectedPath: String,
  /** Candidate backend paths considered by the desktop host during startup. */
  sidecarCheckedPaths: {
    type: Array,
    /**
     * Create an independent empty candidate-path array for this diagnostics panel instance.
     */
    default: () => [],
  },
  /** Origin of the current frontend window used in connection diagnostics. */
  frontendOrigin: String,
  /** Explicit port parsed from the frontend origin, if present. */
  frontendPort: String,
  /** Backend URL reported directly by the desktop host's status command. */
  backendStatusUrl: String,
  /** Currently cached/resolved local API base URL. */
  backendBaseUrl: String,
  /** Explicit port parsed from the chosen backend URL. */
  backendPort: String,
  /** Resolved persistent application-data directory reported by the host. */
  appDataDir: String,
  /** Resolved cache directory reported by the host. */
  cacheDir: String,
  /** Resolved temporary working directory reported by the host. */
  tempDir: String,
  /** Resolved local SQLite database path. */
  dbPath: String,
  /** Resolved source-PDF upload directory. */
  uploadsDir: String,
  /** Resolved OCR artifact/output directory. */
  outputDir: String,
  /** Formatted status and timing of the backend health endpoint probe. */
  healthProbeSummary: String,
  /** Formatted runtime-endpoint probe, retained under its historical diagnostics field name. */
  projectsProbeSummary: String,
  /** Host startup-error detail or diagnostics collection error. */
  backendStartupIssue: String,
})

const emit = defineEmits([
  /** Emit whether the native diagnostics details element is open. */
  'toggle',
])

/**
 * Emit the native details element's open state so the parent can start or stop diagnostics
 * polling.
 */
function handleToggle(event) {
  emit('toggle', event.target.open)
}
</script>

<template>
  <section class="rounded border border-brand-200 bg-white p-3">
    <details class="group" :open="isOpen" @toggle="handleToggle">
      <summary class="cursor-pointer list-none p-3 hover:bg-brand-100">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-brand-900">
              Connectivity Diagnostics
            </h2>
            <p class="text-xs text-brand-600">
              Auto-refreshes while expanded.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-brand-600">
              {{ isRefreshing ? 'Refreshing...' : (isOpen ? 'Open' : 'Closed') }}
            </span>
            <svg
              class="h-4 w-4 text-brand-700 transition-transform group-open:rotate-180"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
        </div>
      </summary>

      <div class="mt-3 rounded border border-brand-200 bg-white p-3">
        <dl class="grid grid-cols-1 gap-2 text-sm text-brand-700">
          <div><dt class="inline font-semibold">Backend mode:</dt> <dd class="inline">{{ backendMode || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Backend runtime:</dt> <dd class="inline">{{ backendRuntime || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Selected sidecar path:</dt> <dd class="inline">{{ sidecarSelectedPath || 'none' }}</dd></div>
          <div><dt class="inline font-semibold">Sidecar candidates checked:</dt> <dd class="inline">{{ sidecarCheckedPaths.length ? sidecarCheckedPaths.join(', ') : 'none' }}</dd></div>
          <div><dt class="inline font-semibold">Frontend origin:</dt> <dd class="inline">{{ frontendOrigin || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Frontend port:</dt> <dd class="inline">{{ frontendPort || 'none (non-http origin)' }}</dd></div>
          <div><dt class="inline font-semibold">Backend URL from backend_status:</dt> <dd class="inline">{{ backendStatusUrl || 'none' }}</dd></div>
          <div><dt class="inline font-semibold">Backend URL used by fetch:</dt> <dd class="inline">{{ backendBaseUrl || backendStatusUrl || 'none' }}</dd></div>
          <div><dt class="inline font-semibold">Backend port expected by frontend:</dt> <dd class="inline">{{ backendPort || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">App data dir:</dt> <dd class="inline">{{ appDataDir || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Cache dir:</dt> <dd class="inline">{{ cacheDir || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Temp dir:</dt> <dd class="inline">{{ tempDir || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">DB path:</dt> <dd class="inline">{{ dbPath || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Uploads dir:</dt> <dd class="inline">{{ uploadsDir || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">Output dir:</dt> <dd class="inline">{{ outputDir || 'unknown' }}</dd></div>
          <div><dt class="inline font-semibold">/health probe:</dt> <dd class="inline">{{ healthProbeSummary || 'not checked' }}</dd></div>
          <div><dt class="inline font-semibold">/system/runtime probe:</dt> <dd class="inline">{{ projectsProbeSummary || 'not checked' }}</dd></div>
        </dl>

        <p v-if="backendStartupIssue" class="mt-3 text-sm text-amber-700">
          <strong>Backend startup issue:</strong> {{ backendStartupIssue }}
        </p>
      </div>
    </details>
  </section>
</template>
