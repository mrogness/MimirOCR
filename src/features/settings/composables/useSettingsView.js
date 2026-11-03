/**
 * @file Assemble theme, performance, and diagnostics behavior for the settings view.
 */
import { computed, onMounted } from 'vue'

import { useAppVersion } from '../../../shared/composables/useAppVersion'
import { useBackendDiagnostics } from './useBackendDiagnostics'
import { useBrandThemeSettings } from './useBrandThemeSettings'
import { usePerformanceProfileSettings } from './usePerformanceProfileSettings'

/**
 * Compose profile, theme, diagnostics, and app-version settings and initialize theme/runtime
 * state on mount.
 * @param {object} dependencies - Host/backend operations and supported setting options.
 * @returns {object} Combined control refs/actions plus prioritized settings error feedback.
 */
export function useSettingsView(dependencies) {
  const profileSettings = usePerformanceProfileSettings(dependencies)
  const themeSettings = useBrandThemeSettings(dependencies)
  const diagnostics = useBackendDiagnostics(dependencies)
  const version = useAppVersion()

  const settingsError = computed(
    () =>
      profileSettings.profileError.value ||
      themeSettings.brandThemeError.value ||
      version.appVersionError.value ||
      '',
  )

  onMounted(async () => {
    themeSettings.loadBrandTheme()
    await profileSettings.loadPerformanceProfile()
  })

  return {
    ...profileSettings,
    ...themeSettings,
    ...diagnostics,
    ...version,
    settingsError,
  }
}
