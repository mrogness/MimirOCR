/**
 * @file Expose the packaged application version to Vue views.
 */
import { onMounted, ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'

/**
 * Load the packaged version when the consuming component mounts.
 * @returns {object} Version/error refs and an explicit reload function.
 */
export function useAppVersion() {
  const appVersion = ref('unknown')
  const appVersionError = ref('')

  /**
   * Ask Tauri for the packaged version, retaining unknown plus an error message when the host
   * command fails.
   */
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
