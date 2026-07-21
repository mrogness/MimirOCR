import { computed, onBeforeUnmount, ref, watch } from 'vue'

export function useProjectsProjectActions({
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

  function openCreateProjectFlow() {
    router.push({ name: 'home' })
  }

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

  function requestDeleteCurrentProject() {
    if (!project.value) {
      return
    }

    isDeleteModalOpen.value = true
  }

  function closeDeleteModal() {
    isDeleteModalOpen.value = false
  }

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
