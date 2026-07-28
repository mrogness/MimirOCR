import { onUnmounted, ref } from 'vue'

const SAVED_CONFIRMATION_MS = 1500

export function useWorkerSettings({
  backendFetch,
  getDefaultWorkerCount,
  getSavedWorkerCount,
  saveWorkerCount,
}) {
  const totalCores = ref(0)
  const recommendedWorkers = ref(1)
  const workerCountInput = ref('1')
  const workerSettingsError = ref('')
  const isLoadingSystem = ref(true)
  const isSaving = ref(false)
  const showSavedConfirmation = ref(false)

  let savedConfirmationTimeout = null
  let lastSavedWorkerCount = null

  function applyWorkerDefaults(coreCount) {
    const normalizedCores =
      Number.isFinite(coreCount) && coreCount > 0 ? coreCount : 1

    const recommended = getDefaultWorkerCount(normalizedCores)
    const saved = getSavedWorkerCount(recommended)

    totalCores.value = normalizedCores
    recommendedWorkers.value = recommended
    workerCountInput.value = String(saved)
    lastSavedWorkerCount = saved
  }

  async function loadWorkerSettings() {
    isLoadingSystem.value = true
    workerSettingsError.value = ''

    try {
      const response = await backendFetch('/system/cpu')

      if (!response.ok) {
        throw new Error(`Unable to load CPU info (${response.status})`)
      }

      const data = await response.json()
      applyWorkerDefaults(Number.parseInt(data.total_cores, 10))
    } catch (error) {
      applyWorkerDefaults(navigator.hardwareConcurrency || 1)
      workerSettingsError.value = String(error)
    } finally {
      isLoadingSystem.value = false
    }
  }

  function showSavedMessage() {
    showSavedConfirmation.value = true

    if (savedConfirmationTimeout) {
      clearTimeout(savedConfirmationTimeout)
    }

    savedConfirmationTimeout = setTimeout(() => {
      showSavedConfirmation.value = false
      savedConfirmationTimeout = null
    }, SAVED_CONFIRMATION_MS)
  }

  async function persistWorkerCount() {
    const parsed = Number.parseInt(workerCountInput.value, 10)

    if (
      !Number.isFinite(parsed) ||
      parsed < 1 ||
      parsed === lastSavedWorkerCount
    ) {
      return
    }

    isSaving.value = true
    showSavedConfirmation.value = false
    workerSettingsError.value = ''

    try {
      const saved = saveWorkerCount(workerCountInput.value)
      workerCountInput.value = String(saved)
      lastSavedWorkerCount = saved
      showSavedMessage()
    } catch (error) {
      workerSettingsError.value = String(error)
    } finally {
      isSaving.value = false
    }
  }

  onUnmounted(() => {
    if (savedConfirmationTimeout) {
      clearTimeout(savedConfirmationTimeout)
      savedConfirmationTimeout = null
    }
  })

  return {
    totalCores,
    recommendedWorkers,
    workerCountInput,
    workerSettingsError,
    isLoadingSystem,
    isSaving,
    showSavedConfirmation,
    loadWorkerSettings,
    persistWorkerCount,
  }
}