/**
 * @file Coordinate project listing, creation, deletion, and backend warmup feedback for the
 * dashboard.
 */
import { computed, onMounted, ref } from 'vue'

/**
 * Create dashboard project state, startup feedback, and create/delete/navigation actions.
 * @param {object} dependencies - Router, backend fetch function, and startup-issue lookup.
 * @returns {object} Reactive project/modal state and dashboard action functions.
 */
export function useDashboard({ router, backendFetch, getBackendStartupIssue }) {
  const STARTUP_GRACE_ATTEMPTS = 8
  const STARTUP_GRACE_DELAY_MS = 1200

  const projects = ref([])
  const isLoading = ref(true)
  const isCreating = ref(false)
  const deletingProjectId = ref(null)
  const errorMessage = ref('')
  const backendStartupIssue = ref('')
  const isBackendWarmingUp = ref(false)
  const backendWarmupMessage = ref('')
  const pendingDeleteProjectId = ref(null)
  const isDeleteModalOpen = ref(false)

  const showCreateModal = ref(false)
  const newProjectName = ref('')
  const createError = ref('')

  const hasProjects = computed(() => projects.value.length > 0)
  const pendingDeleteProjectName = computed(() => {
    if (!pendingDeleteProjectId.value) {
      return ''
    }

    const target = projects.value.find((project) => project.id === pendingDeleteProjectId.value)
    return target?.name || ''
  })

  /**
   * Format a valid date in the user's locale, returning N/A for an invalid timestamp.
   */
  function formatDate(value) {
    const d = new Date(value)
    if (Number.isNaN(d.valueOf())) {
      return 'N/A'
    }
    return d.toLocaleString()
  }

  /**
   * Resolve after the supplied millisecond delay without blocking the UI thread.
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Recognize network, startup, and server-error text eligible for dashboard warmup retries.
   */
  function isTransientProjectsLoadError(error) {
    const text = String(error || '').toLowerCase()
    return (
      text.includes('unable to reach backend endpoint') ||
      text.includes('backend is not reachable') ||
      text.includes('load failed') ||
      text.includes('networkerror') ||
      text.includes('typeerror') ||
      text.includes('http error 5')
    )
  }

  /**
   * Request the project collection once and replace dashboard state with the returned array.
   * Throw for a non-success response.
   */
  async function fetchProjectsOnce() {
      const response = await backendFetch('/projects/', {}, {
        retries: 0,
        healthAttempts: 3,
        healthDelayMs: 120,
      })
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`)
    }

    const data = await response.json()
    projects.value = Array.isArray(data.projects) ? data.projects : []
  }

  /**
   * Load projects with a bounded startup grace period for transient failures. Update
   * loading/warmup feedback and attach any Tauri startup issue to the final error.
   */
  async function loadProjects() {
    isLoading.value = true
    errorMessage.value = ''
    isBackendWarmingUp.value = false
    backendWarmupMessage.value = ''

    try {
      let lastError = null

      for (let attempt = 0; attempt < STARTUP_GRACE_ATTEMPTS; attempt += 1) {
        try {
          if (attempt > 0) {
            isBackendWarmingUp.value = true
            backendWarmupMessage.value = `Backend is starting up... retry ${attempt + 1} of ${STARTUP_GRACE_ATTEMPTS}`
          }
          await fetchProjectsOnce()
          lastError = null
          isBackendWarmingUp.value = false
          backendWarmupMessage.value = ''
          break
        } catch (error) {
          lastError = error
          const isLastAttempt = attempt === STARTUP_GRACE_ATTEMPTS - 1
          if (isLastAttempt || !isTransientProjectsLoadError(error)) {
            throw error
          }
          isBackendWarmingUp.value = true
          backendWarmupMessage.value = `Backend is starting up... retry ${attempt + 2} of ${STARTUP_GRACE_ATTEMPTS}`
          await sleep(STARTUP_GRACE_DELAY_MS)
        }
      }

      if (lastError) {
        throw lastError
      }
    } catch (error) {
      const startupIssue = await getBackendStartupIssue()
      const detail = startupIssue ? ` Backend startup issue: ${startupIssue}` : ''
      errorMessage.value = `${String(error)}${detail}`
    } finally {
      isBackendWarmingUp.value = false
      isLoading.value = false
    }
  }

  /**
   * Reset the project name and previous creation error before opening the creation dialog.
   */
  function openCreateModal() {
    createError.value = ''
    newProjectName.value = ''
    showCreateModal.value = true
  }

  /**
   * Hide the project creation dialog without sending an API request.
   */
  function closeCreateModal() {
    showCreateModal.value = false
  }

  /**
   * Validate the entered name, create a project, and navigate to its detail route. Keep
   * errors in dialog state and clear the busy flag after completion.
   */
  async function createProjectAndGo() {
    const name = newProjectName.value.trim()
    if (!name) {
      createError.value = 'Please enter a project name.'
      return
    }

    isCreating.value = true
    createError.value = ''

    try {
      const response = await backendFetch('/projects/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        throw new Error(`Unable to create project (${response.status})`)
      }

      const created = await response.json()
      closeCreateModal()
      await router.push({ name: 'projectDetail', params: { id: created.id } })
    } catch (error) {
      createError.value = String(error)
    } finally {
      isCreating.value = false
    }
  }

  /**
   * Navigate to the project detail route for the supplied persistent project ID.
   */
  function openProject(projectId) {
    router.push({ name: 'projectDetail', params: { id: projectId } })
  }

  /**
   * Select a project ID for deletion and open the confirmation dialog.
   */
  function requestDeleteProject(projectId) {
    pendingDeleteProjectId.value = projectId
    isDeleteModalOpen.value = true
  }

  /**
   * Hide deletion confirmation and clear the pending project ID.
   */
  function closeDeleteModal() {
    isDeleteModalOpen.value = false
    pendingDeleteProjectId.value = null
  }

  /**
   * Delete the pending project through the API, remove it from the displayed list on success,
   * and retain an error message on failure.
   */
  async function confirmDeleteProject() {
    if (!pendingDeleteProjectId.value) {
      return
    }

    const projectId = pendingDeleteProjectId.value

    deletingProjectId.value = projectId
    errorMessage.value = ''

    try {
      const response = await backendFetch(`/projects/${projectId}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 204) {
        throw new Error(`Unable to delete project (${response.status})`)
      }

      projects.value = projects.value.filter((project) => project.id !== projectId)
      closeDeleteModal()
    } catch (error) {
      errorMessage.value = String(error)
    } finally {
      deletingProjectId.value = null
    }
  }

  onMounted(async () => {
    backendStartupIssue.value = await getBackendStartupIssue()
    await loadProjects()
  })

  return {
    projects,
    isLoading,
    isCreating,
    deletingProjectId,
    errorMessage,
    backendStartupIssue,
    isBackendWarmingUp,
    backendWarmupMessage,
    pendingDeleteProjectId,
    isDeleteModalOpen,
    showCreateModal,
    newProjectName,
    createError,
    hasProjects,
    pendingDeleteProjectName,
    formatDate,
    openCreateModal,
    closeCreateModal,
    createProjectAndGo,
    openProject,
    requestDeleteProject,
    closeDeleteModal,
    confirmDeleteProject,
  }
}
