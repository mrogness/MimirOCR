<script setup>
import ConnectivityDiagnostics from '../components/settings/ConnectivityDiagnostics.vue'
import SettingRow from '../components/settings/SettingRow.vue'
import SettingsHelp from '../components/settings/SettingsHelp.vue'
import SettingsSection from '../components/settings/SettingsSection.vue'
import { useSettingsView } from '../composables/views/useSettingsView'
import {
  backendFetch,
  getBackendConnectionDiagnostics,
  restartBackend,
  waitForBackendRuntime,
} from '../services/backend'
import {
  BRAND_THEME_OPTIONS,
  PERFORMANCE_PROFILE_OPTIONS,
  applyBrandTheme,
  getSavedBrandTheme,
  saveBrandTheme,
} from '../services/appSettings'

const {
  performanceProfileOptions,
  selectedProfile,
  selectedProfileDescription,
  activeProfile,
  effectiveLimits,
  activeJob,
  backendConnection,
  profileMessage,
  profileChanged,
  profileChangeBlocked,
  canApplyProfile,
  isApplyingProfile,
  applyPerformanceProfile,
  brandThemeInput,
  brandThemeOptions,
  appVersion,
  settingsError,
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
  previewBrandTheme,
  setDiagnosticsOpen,
} = useSettingsView({
  backendFetch,
  getBackendConnectionDiagnostics,
  restartBackend,
  waitForBackendRuntime,
  performanceProfileOptions: PERFORMANCE_PROFILE_OPTIONS,
  brandThemeOptions: BRAND_THEME_OPTIONS,
  getSavedBrandTheme,
  saveBrandTheme,
  applyBrandTheme,
})
</script>

<template>
  <div class="settings-page h-full min-h-0 space-y-6 overflow-y-auto pr-1">
    <header>
      <h1 class="text-2xl font-bold">Settings</h1>
      <p class="text-sm text-brand-500">Global application settings for OCR performance and defaults.</p>
    </header>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <SettingsSection
        title="Performance Settings"
        description="The selected profile is fixed for the lifetime of the processing backend."
      >
        <SettingRow
          label="Processing Performance"
          input-id="performance-profile-input"
          description="Controls segmentation parallelism, OCR native threads, and sustained heat."
        >
          <template #help>
            <SettingsHelp label="About processing performance">
              Applying a different profile restarts the local Python backend. Saved projects and OCR
              results are preserved. Profiles cannot be changed while an OCR run is active.
            </SettingsHelp>
          </template>

          <div class="space-y-4">
            <select
              id="performance-profile-input"
              v-model="selectedProfile"
              :disabled="profileChangeBlocked || isApplyingProfile"
              class="w-full rounded border border-brand-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option v-for="option in performanceProfileOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>

            <p class="text-sm text-brand-600">
              {{ selectedProfileDescription }}
            </p>

            <div class="rounded border border-brand-200 bg-brand-50 p-3 text-sm text-brand-700">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Active profile: <strong class="capitalize">{{ activeProfile }}</strong></span>
                <span>Backend: <strong class="capitalize">{{ backendConnection }}</strong></span>
              </div>
              <div v-if="effectiveLimits" class="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                <span>Segmentation workers: {{ effectiveLimits.segmentation_workers }}</span>
                <span>Segmentation threads: {{ effectiveLimits.segmentation_native_threads }}</span>
                <span>OCR threads: {{ effectiveLimits.ocr_native_threads }}</span>
                <span>Page cooldown: {{ effectiveLimits.page_cooldown_ms }} ms</span>
              </div>
            </div>

            <p v-if="activeJob" class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              An OCR run is active for project {{ activeJob.project_id }}. The performance profile is
              locked until processing finishes.
            </p>
            <p v-else-if="profileChanged" class="text-sm text-brand-600">
              Applying this change will restart the processing backend and temporarily disable OCR actions.
            </p>

            <div class="flex items-center gap-3">
              <button
                type="button"
                :disabled="!canApplyProfile"
                class="rounded bg-brand-900 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                @click="applyPerformanceProfile"
              >
                {{ isApplyingProfile ? 'Restarting Backend…' : 'Apply and Restart Backend' }}
              </button>
              <span class="text-sm text-brand-600" aria-live="polite">{{ profileMessage }}</span>
            </div>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Appearance" description="Choose a global application theme.">
        <SettingRow label="Theme" input-id="brand-theme-input" description="Changes the colors used throughout the application.">
          <select
            id="brand-theme-input"
            v-model="brandThemeInput"
            class="w-full rounded border border-brand-300 px-2 py-2 text-sm sm:w-56"
            @change="previewBrandTheme"
          >
            <option v-for="option in brandThemeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <div class="mt-3 overflow-hidden rounded border border-brand-200" aria-label="Selected theme color scale">
            <div class="grid h-8 grid-cols-11">
              <div class="bg-brand-50"></div><div class="bg-brand-100"></div><div class="bg-brand-200"></div>
              <div class="bg-brand-300"></div><div class="bg-brand-400"></div><div class="bg-brand-500"></div>
              <div class="bg-brand-600"></div><div class="bg-brand-700"></div><div class="bg-brand-800"></div>
              <div class="bg-brand-900"></div><div class="bg-brand-950"></div>
            </div>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Storage" description="Manage application and output locations.">
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
      <span class="text-sm text-zinc-600 dark:text-zinc-400">v{{ appVersion }}</span>
    </footer>
  </div>
</template>
