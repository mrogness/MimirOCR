import { onUnmounted, ref, watch } from 'vue'

const AUTOSAVE_DELAY_MS = 250

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

  let autosaveTimeout = null
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

  async function persistWorkerCount() {
    isSaving.value = true
    workerSettingsError.value = ''

    try {
      const saved = saveWorkerCount(workerCountInput.value)
      workerCountInput.value = String(saved)
      lastSavedWorkerCount = saved
    } catch (error) {
      workerSettingsError.value = String(error)
    } finally {
      isSaving.value = false
    }
  }

  function scheduleWorkerCountSave() {
    if (isLoadingSystem.value) {
      return
    }

    const parsed = Number.parseInt(workerCountInput.value, 10)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed === lastSavedWorkerCount) {
      return
    }

    if (autosaveTimeout) {
      clearTimeout(autosaveTimeout)
    }

    autosaveTimeout = setTimeout(() => {
      void persistWorkerCount()
    }, AUTOSAVE_DELAY_MS)
  }

  function useRecommendedValue() {
    workerCountInput.value = String(recommendedWorkers.value)
  }

  watch(workerCountInput, scheduleWorkerCountSave)

  onUnmounted(() => {
    if (autosaveTimeout) {
      clearTimeout(autosaveTimeout)
      autosaveTimeout = null
    }
  })

  return {
    totalCores,
    recommendedWorkers,
    workerCountInput,
    workerSettingsError,
    isLoadingSystem,
    isSaving,
    loadWorkerSettings,
    persistWorkerCount,
    useRecommendedValue,
  }
}
