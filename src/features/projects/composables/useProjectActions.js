/**
 * @file Implement selected-project actions and update project detail state after API
 * operations.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

/**
 * Manage the routed project's loading, debounced rename, deletion, and review navigation.
 * @param {object} dependencies - Route/router, backend access, project ref, and run-status/recovery callbacks.
 * @returns {object} Project loading/dialog state, validation feedback, and project action functions.
 */
export function useProjectActions({
  route,
  router,
  backendFetch,
  project,
  applyProjectStatus,
  resumeLatestJobIfActive,
}) {
  const isLoadingProject = ref(true)
  const projectError = ref('')
  const isDeletingProject = ref(false)
  const isDeleteModalOpen = ref(false)

  const renameInput = ref('')
  const renameError = ref('')
  const isRenaming = ref(false)
  const lastSavedName = ref('')
  const isSyncingRenameInput = ref(false)
  let renameTimer = null

  const projectId = computed(() => route.params.id)
  const isProjectRoute = computed(() => Boolean(projectId.value))
  const canOpenReview = computed(() => {
    if (!project.value) {
      return false
    }
    return project.value.ocr_last_status === 'succeeded'
  })

  /**
   * Fetch the routed project, synchronize rename controls, and apply its OCR summary. Start
   * active-job recovery asynchronously so initial rendering is not blocked.
   */
  async function loadProject() {
    if (!isProjectRoute.value) {
      isLoadingProject.value = false
      project.value = null
      return
    }

    isLoadingProject.value = true
    projectError.value = ''

    try {
      const response = await backendFetch(`/projects/${projectId.value}`)
      if (!response.ok) {
        throw new Error(`Unable to load project (${response.status})`)
      }

      const data = await response.json()
      project.value = data
      isSyncingRenameInput.value = true
      renameInput.value = data.name
      lastSavedName.value = data.name
      isSyncingRenameInput.value = false
      applyProjectStatus(data)
      // Do not block initial project rendering on OCR job recovery calls.
      void resumeLatestJobIfActive().catch((err) => {
        console.warn('Unable to resume latest OCR job during project load', err)
      })
    } catch (error) {
      projectError.value = String(error)
      project.value = null
    } finally {
      isLoadingProject.value = false
    }
  }

  /**
   * Trim and validate a replacement name, skip unchanged names, and commit it through the
   * API. Synchronize local inputs with the response and expose save errors.
   */
  async function renameProject(forcedName = null) {
    if (!project.value) {
      return
    }

    const nextName = String(forcedName ?? renameInput.value).trim()
    if (!nextName) {
      renameError.value = 'Project name cannot be empty.'
      return
    }

    if (nextName === lastSavedName.value) {
      return
    }

    renameError.value = ''
    isRenaming.value = true

    try {
      const response = await backendFetch(`/projects/${project.value.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: nextName }),
      })

      if (!response.ok) {
        throw new Error(`Unable to rename project (${response.status})`)
      }

      const updated = await response.json()
      project.value = updated
      isSyncingRenameInput.value = true
      renameInput.value = updated.name
      lastSavedName.value = updated.name
      isSyncingRenameInput.value = false
    } catch (error) {
      renameError.value = String(error)
    } finally {
      isRenaming.value = false
    }
  }

  watch(renameInput, (next) => {
    if (isSyncingRenameInput.value || !project.value) {
      return
    }

    renameError.value = ''
    if (renameTimer) {
      clearTimeout(renameTimer)
    }

    renameTimer = setTimeout(() => {
      renameProject(next)
    }, 500)
  })

  onBeforeUnmount(() => {
    if (renameTimer) {
      clearTimeout(renameTimer)
      renameTimer = null
    }
  })

  /**
   * Navigate to the dashboard where a new project can be created.
   */
  function openCreateProjectFlow() {
    router.push({ name: 'home' })
  }

  /**
   * Open review only after a successful OCR run, displaying any navigation error in project
   * feedback.
   */
  async function openReviewView() {
    if (!project.value || !canOpenReview.value) {
      return
    }

    projectError.value = ''
    try {
      await router.push({ name: 'projectReview', params: { id: project.value.id } })
    } catch (error) {
      projectError.value = `Unable to open OCR review: ${String(error)}`
    }
  }

  /**
   * Open deletion confirmation for the loaded project, doing nothing when no project is
   * available.
   */
  function requestDeleteCurrentProject() {
    if (!project.value) {
      return
    }

    isDeleteModalOpen.value = true
  }

  /**
   * Hide the current project's deletion confirmation dialog.
   */
  function closeDeleteModal() {
    isDeleteModalOpen.value = false
  }

  /**
   * Delete the loaded project and return to the dashboard on success; retain error/busy state
   * around the request.
   */
  async function confirmDeleteCurrentProject() {
    if (!project.value) {
      return
    }

    isDeletingProject.value = true
    projectError.value = ''

    try {
      const response = await backendFetch(`/projects/${project.value.id}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 204) {
        throw new Error(`Unable to delete project (${response.status})`)
      }

      closeDeleteModal()
      router.push({ name: 'home' })
    } catch (error) {
      projectError.value = String(error)
    } finally {
      isDeletingProject.value = false
    }
  }

  return {
    isLoadingProject,
    projectError,
    isDeletingProject,
    isDeleteModalOpen,
    renameInput,
    renameError,
    isRenaming,
    isProjectRoute,
    canOpenReview,
    loadProject,
    renameProject,
    openCreateProjectFlow,
    openReviewView,
    requestDeleteCurrentProject,
    closeDeleteModal,
    confirmDeleteCurrentProject,
  }
}
