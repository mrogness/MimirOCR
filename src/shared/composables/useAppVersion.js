import { onMounted, ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'

export function useAppVersion() {
  const appVersion = ref('unknown')
  const appVersionError = ref('')

  async function loadAppVersion() {
    appVersionError.value = ''

    try {
      appVersion.value = await getVersion()
    } catch (error) {
      appVersion.value = 'unknown'
      appVersionError.value = String(error)
    }
  }

  onMounted(() => {
    void loadAppVersion()
  })

  return {
    appVersion,
    appVersionError,
    loadAppVersion,
  }
}
