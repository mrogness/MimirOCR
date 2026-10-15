import { computed, onMounted, ref } from 'vue'

import { useAppVersion } from '../../../shared/composables/useAppVersion'
import { useBackendDiagnostics } from './useBackendDiagnostics'
import { useBrandThemeSettings } from './useBrandThemeSettings'
import { usePerformanceProfileSettings } from './usePerformanceProfileSettings'

export function useSettingsView(dependencies) {
  const settingsMessage = ref('')
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
    settingsMessage,
    settingsError,
  }
}
