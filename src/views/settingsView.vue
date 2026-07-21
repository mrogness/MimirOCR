<script setup>
import { useSettingsView } from '../composables/views/useSettingsView'
import { backendFetch, getBackendConnectionDiagnostics } from '../services/backend'
import {
  BRAND_THEME_OPTIONS,
  applyBrandTheme,
  getDefaultWorkerCount,
  getSavedBrandTheme,
  getSavedWorkerCount,
  saveBrandTheme,
  saveWorkerCount,
} from '../services/appSettings'

const {
  totalCores,
  recommendedWorkers,
  workerCountInput,
  brandThemeInput,
  brandThemeOptions,
  settingsMessage,
  settingsError,
  isLoadingSystem,
  isSaving,
  isRefreshingDiagnostics,
  isDiagnosticsOpen,
  frontendOrigin,
  frontendPort,
  backendStatusUrl,
  backendBaseUrl,
  backendPort,
  backendMode,
  backendRuntime,
  appDataDir,
  cacheDir,
  tempDir,
  dbPath,
  uploadsDir,
  outputDir,
  sidecarSelectedPath,
  sidecarCheckedPaths,
  backendStartupIssue,
  healthProbeSummary,
  projectsProbeSummary,
  useRecommendedValue,
  previewBrandTheme,
  setDiagnosticsOpen,
} = useSettingsView({
  backendFetch,
  getBackendConnectionDiagnostics,
  getDefaultWorkerCount,
  getSavedWorkerCount,
  saveWorkerCount,
  brandThemeOptions: BRAND_THEME_OPTIONS,
  getSavedBrandTheme,
  saveBrandTheme,
  applyBrandTheme,
})
</script>

<template>
  <div class="settings-page h-full min-h-0 overflow-y-auto space-y-6 pr-1">
    <section>
      <h1 class="text-2xl font-bold">Settings</h1>
      <p class="text-sm text-brand-500">Global application settings for OCR performance and defaults.</p>
    </section>

    <section class="rounded border border-brand-200 bg-white p-5 space-y-4">
      <h2 class="text-lg font-semibold">Processing Workers</h2>
      <p class="text-sm text-brand-500">
        Worker count is shared across projects. Start with one and scale as capable.
      </p>

      <div v-if="isLoadingSystem" class="text-sm text-brand-600">Loading CPU info...</div>

      <div v-else class="space-y-3">
        <p class="text-sm text-brand-700">Detected CPU cores: <strong>{{ totalCores }}</strong></p>
        <p class="text-sm text-brand-700">Recommended workers: <strong>{{ recommendedWorkers }}</strong></p>

        <label class="block text-sm font-medium text-brand-700" for="worker-count-input">Worker Count</label>
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            id="worker-count-input"
            v-model="workerCountInput"
            type="number"
            min="1"
            class="w-full sm:w-40 rounded border border-brand-300 px-3 py-2 text-sm"
          />
          <button
            class="rounded border border-brand-300 px-3 py-2 text-sm text-brand-700 hover:bg-brand-100"
            @click="useRecommendedValue"
          >
            Use Recommended
          </button>
          <span class="text-xs text-brand-600">{{ isSaving ? 'Saving...' : 'Saved automatically on change' }}</span>
        </div>

        <p v-if="settingsError" class="text-sm text-red-700">{{ settingsError }}</p>
      </div>
    </section>

    <section class="rounded border border-brand-200 bg-white p-5 space-y-4">
      <h2 class="text-lg font-semibold">Appearance</h2>
      <p class="text-sm text-brand-500">
        Choose a global app theme using Tailwind's default color palettes.
      </p>

      <div class="space-y-3">
        <label class="block text-sm font-medium text-brand-700" for="brand-theme-input">Brand Theme</label>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            id="brand-theme-input"
            v-model="brandThemeInput"
            class="w-full sm:w-56 rounded border border-brand-300 px-3 py-2 text-sm"
            @change="previewBrandTheme"
          >
            <option v-for="option in brandThemeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <span class="text-xs text-brand-600"></span>
        </div>
      </div>
    </section>

    <section class="rounded border border-brand-200 bg-white p-5">
      <details class="group" :open="isDiagnosticsOpen" @toggle="setDiagnosticsOpen($event.target.open)">
        <summary class="list-none cursor-pointer rounded border border-brand-300 bg-brand-50 px-3 py-2 hover:bg-brand-100">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-brand-900">Connectivity Diagnostics</h2>
              <p class="text-xs text-brand-600">Auto-refreshes while expanded.</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-brand-600">{{ isRefreshingDiagnostics ? 'Refreshing...' : (isDiagnosticsOpen ? 'Open' : 'Closed') }}</span>
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
          <div class="grid grid-cols-1 gap-2 text-sm text-brand-700">
          <p><strong>Backend mode:</strong> {{ backendMode || 'unknown' }}</p>
          <p><strong>Backend runtime:</strong> {{ backendRuntime || 'unknown' }}</p>
          <p><strong>Selected sidecar path:</strong> {{ sidecarSelectedPath || 'none' }}</p>
          <p><strong>Sidecar candidates checked:</strong> {{ sidecarCheckedPaths.length > 0 ? sidecarCheckedPaths.join(', ') : 'none' }}</p>
          <p><strong>Frontend origin:</strong> {{ frontendOrigin || 'unknown' }}</p>
          <p><strong>Frontend port:</strong> {{ frontendPort || 'none (non-http origin)' }}</p>
          <p><strong>Backend URL from backend_status:</strong> {{ backendStatusUrl || 'none' }}</p>
          <p><strong>Backend URL used by fetch:</strong> {{ backendBaseUrl || backendStatusUrl || 'none' }}</p>
          <p><strong>Backend port expected by frontend:</strong> {{ backendPort || 'unknown' }}</p>
          <p><strong>App data dir:</strong> {{ appDataDir || 'unknown' }}</p>
          <p><strong>Cache dir:</strong> {{ cacheDir || 'unknown' }}</p>
          <p><strong>Temp dir:</strong> {{ tempDir || 'unknown' }}</p>
          <p><strong>DB path:</strong> {{ dbPath || 'unknown' }}</p>
          <p><strong>Uploads dir:</strong> {{ uploadsDir || 'unknown' }}</p>
          <p><strong>Output dir:</strong> {{ outputDir || 'unknown' }}</p>
          <p><strong>/health probe:</strong> {{ healthProbeSummary || 'not checked' }}</p>
          <p><strong>/projects/ probe:</strong> {{ projectsProbeSummary || 'not checked' }}</p>
          <p v-if="backendStartupIssue" class="text-amber-700"><strong>Backend startup issue:</strong> {{ backendStartupIssue }}</p>
        </div>
        </div>
      </details>
    </section>
  </div>
</template>
