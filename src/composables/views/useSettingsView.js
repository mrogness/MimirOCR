import { computed, onMounted, ref } from 'vue'

import { useAppVersion } from '../settings/useAppVersion'
import { useBackendDiagnostics } from '../settings/useBackendDiagnostics'
import { useBrandThemeSettings } from '../settings/useBrandThemeSettings'
import { useWorkerSettings } from '../settings/useWorkerSettings'

export function useSettingsView(dependencies) {
  const settingsMessage = ref('')

  const workerSettings = useWorkerSettings(dependencies)
  const themeSettings = useBrandThemeSettings(dependencies)
  const diagnostics = useBackendDiagnostics(dependencies)
  const version = useAppVersion()

  const settingsError = computed(
    () =>
      workerSettings.workerSettingsError.value ||
      themeSettings.brandThemeError.value ||
      version.appVersionError.value ||
      '',
  )

  onMounted(async () => {
    themeSettings.loadBrandTheme()
    await workerSettings.loadWorkerSettings()
  })

  return {
    ...workerSettings,
    ...themeSettings,
    ...diagnostics,
    ...version,
    settingsMessage,
    settingsError,
  }
}
