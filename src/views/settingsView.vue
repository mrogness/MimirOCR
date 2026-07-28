<script setup>
import ConnectivityDiagnostics from '../components/settings/ConnectivityDiagnostics.vue'
import SettingRow from '../components/settings/SettingRow.vue'
import SettingsHelp from '../components/settings/SettingsHelp.vue'
import SettingsSection from '../components/settings/SettingsSection.vue'
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
  showSavedConfirmation,
  persistWorkerCount,
  brandThemeInput,
  brandThemeOptions,
  appVersion,
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

import { ref } from 'vue';
const value = ref(50);
defineProps({ min: { type: Number, default: 0 }, max: { type: Number, default: 100 } });
</script>

<template>
  <div class="settings-page h-full min-h-0 space-y-6 overflow-y-auto pr-1">
    <header>
      <h1 class="text-2xl font-bold">Settings</h1>
      <p class="text-sm text-brand-500">
        Global application settings for OCR performance and defaults.
      </p>
    </header>
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <SettingsSection
        title="Performance Settings"
        description="Performance settings are applied to all projects."
      >
        <div v-if="isLoadingSystem" class="text-sm text-brand-600">
          Loading CPU info...
        </div>

        <template v-else>
          <div class="rounded bg-brand-50 p-3 text-sm text-brand-700">
            Detected CPU cores: <strong>{{ totalCores }}</strong>
            <span class="mx-2 text-brand-300">•</span>
            Recommended workers: <strong>{{ recommendedWorkers }}</strong>
          </div>

            <SettingRow
              label="Worker Count"
              input-id="worker-count-input"
              description="Controls how many OCR tasks may run concurrently."
            >
              <template #help>
                <SettingsHelp label="About OCR worker count">
                  More workers can improve speed of processing, but increase memory and
                  CPU use as well as CPU temperature. The recommended value is <strong>{{ recommendedWorkers }}</strong>.
                </SettingsHelp>
              </template>

              <div class="space-y-3">
                <div class="flex items-center justify-between gap-4">
                  <span class="text-sm text-brand-600">
                    1
                  </span>

                  <output
                    for="worker-count-input"
                    class="min-w-12 rounded border border-brand-200 bg-brand-100 px-2 py-1 text-center text-sm font-semibold text-brand-800"
                  >
                    {{ workerCountInput }}
                  </output>

                  <span class="text-sm text-brand-600">
                    {{ totalCores }}
                  </span>
                </div>

                <input
                  id="worker-count-input"
                  v-model="workerCountInput"
                  type="range"
                  min="1"
                  :max="totalCores"
                  step="1"
                  :aria-describedby="'worker-count-input-description'"
                  class="w-full cursor-pointer accent-brand-600"
                  @change="persistWorkerCount"
                />

                <div class="flex items-center justify-between text-xs text-brand-600">
                  <span>
                    Recommended: {{ recommendedWorkers }}
                  </span>

                  <span
                    class="min-h-4"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <span v-if="isSaving">
                      Saving...
                    </span>

                    <span v-else-if="showSavedConfirmation" class="text-green-800">
                      Saved
                    </span>
                  </span>
                </div>
              </div>
            </SettingRow>
        </template>
      </SettingsSection>

      <SettingsSection
        title="Appearance"
        description="Choose a global application theme."
      >
        <SettingRow
          label="Theme"
          input-id="brand-theme-input"
          description="Changes the colors used throughout the application."
        >
          <select
            id="brand-theme-input"
            v-model="brandThemeInput"
            :aria-describedby="'brand-theme-input-description'"
            class="w-full rounded border border-brand-300 px-2 py-2 text-sm sm:w-56"
            @change="previewBrandTheme"
          >
            <option
              v-for="option in brandThemeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <div
            class="mt-3 overflow-hidden rounded border border-brand-200"
            aria-label="Selected theme color scale"
          >
            <div class="grid h-8 grid-cols-11">
              <div class="bg-brand-50" title="50"></div>
              <div class="bg-brand-100" title="100"></div>
              <div class="bg-brand-200" title="200"></div>
              <div class="bg-brand-300" title="300"></div>
              <div class="bg-brand-400" title="400"></div>
              <div class="bg-brand-500" title="500"></div>
              <div class="bg-brand-600" title="600"></div>
              <div class="bg-brand-700" title="700"></div>
              <div class="bg-brand-800" title="800"></div>
              <div class="bg-brand-900" title="900"></div>
              <div class="bg-brand-950" title="950"></div>
            </div>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Storage"
        description="Manage application and output locations."
      >
        <!-- Future storage settings -->
      </SettingsSection>

      <p v-if="settingsError" class="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {{ settingsError }}
      </p>

      <ConnectivityDiagnostics
        :is-open="isDiagnosticsOpen"
        :is-refreshing="isRefreshingDiagnostics"
        :backend-mode="backendMode"
        :backend-runtime="backendRuntime"
        :sidecar-selected-path="sidecarSelectedPath"
        :sidecar-checked-paths="sidecarCheckedPaths"
        :frontend-origin="frontendOrigin"
        :frontend-port="frontendPort"
        :backend-status-url="backendStatusUrl"
        :backend-base-url="backendBaseUrl"
        :backend-port="backendPort"
        :app-data-dir="appDataDir"
        :cache-dir="cacheDir"
        :temp-dir="tempDir"
        :db-path="dbPath"
        :uploads-dir="uploadsDir"
        :output-dir="outputDir"
        :health-probe-summary="healthProbeSummary"
        :projects-probe-summary="projectsProbeSummary"
        :backend-startup-issue="backendStartupIssue"
        @toggle="setDiagnosticsOpen"
      />
    </div>

    <footer class="px-3 pb-3">
      <span class="text-sm text-zinc-600 dark:text-zinc-400">
        v{{ appVersion }}
      </span>
    </footer>
  </div>
</template>
