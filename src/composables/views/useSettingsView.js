import { computed, onMounted, ref } from 'vue'

import { useAppVersion } from '../settings/useAppVersion'
import { useBackendDiagnostics } from '../settings/useBackendDiagnostics'
import { useBrandThemeSettings } from '../settings/useBrandThemeSettings'
import { usePerformanceProfileSettings } from '../settings/usePerformanceProfileSettings'

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
