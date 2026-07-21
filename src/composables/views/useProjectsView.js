import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useProjectsProjectActions } from './projects/useProjectsProjectActions'
import { useProjectsRuntime } from './projects/useProjectsRuntime'
import { useProjectsUploadActions } from './projects/useProjectsUploadActions'

export function useProjectsView({ route, router, backendFetch, getDefaultWorkerCount, getSavedWorkerCount }) {
  const project = ref(null)
  const workerCount = ref(1)

  let loadProjectRef = async () => {}
  const runtime = useProjectsRuntime({
    backendFetch,
    project,
    reloadProject: async () => {
      await loadProjectRef()
    },
  })

  const projectActions = useProjectsProjectActions({
    route,
    router,
    backendFetch,
    project,
    applyProjectStatus: runtime.applyProjectStatus,
    resumeLatestJobIfActive: runtime.resumeLatestJobIfActive,
  })
  loadProjectRef = projectActions.loadProject

  const uploadActions = useProjectsUploadActions({
    backendFetch,
    getDefaultWorkerCount,
    getSavedWorkerCount,
    project,
    selectedPdf: runtime.selectedPdf,
    uploadError: runtime.uploadError,
    uploadMessage: runtime.uploadMessage,
    ocrPhase: runtime.ocrPhase,
    ocrProgress: runtime.ocrProgress,
    currentJobId: runtime.currentJobId,
    totalPagesCounter: runtime.totalPagesCounter,
    rasterizedPagesCounter: runtime.rasterizedPagesCounter,
    segmentedPagesCounter: runtime.segmentedPagesCounter,
    ocrPagesCounter: runtime.ocrPagesCounter,
    persistedElapsedSeconds: runtime.persistedElapsedSeconds,
    processingStartMs: runtime.processingStartMs,
    processingEndMs: runtime.processingEndMs,
    workerCount,
    startElapsedTimer: runtime.startElapsedTimer,
    stopElapsedTimer: runtime.stopElapsedTimer,
    persistActiveJob: runtime.persistActiveJob,
    pollJob: runtime.pollJob,
    startPolling: runtime.startPolling,
    asUserMessage: runtime.asUserMessage,
    loadProject: projectActions.loadProject,
  })

  watch(
    () => route.params.id,
    async () => {
      runtime.resetWorkspaceState()
      await projectActions.loadProject()
    }
  )

  onMounted(async () => {
    document.addEventListener('visibilitychange', runtime.refreshRunStateOnVisibility)
    window.addEventListener('focus', runtime.refreshRunStateOnVisibility)
    await uploadActions.loadWorkerSettings()
    await projectActions.loadProject()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', runtime.refreshRunStateOnVisibility)
    window.removeEventListener('focus', runtime.refreshRunStateOnVisibility)
    runtime.cleanupRuntime()
  })

  return {
    project,
    isLoadingProject: projectActions.isLoadingProject,
    projectError: projectActions.projectError,
    isDeletingProject: projectActions.isDeletingProject,
    isDeleteModalOpen: projectActions.isDeleteModalOpen,
    renameInput: projectActions.renameInput,
    renameError: projectActions.renameError,
    isRenaming: projectActions.isRenaming,
    pdfRef: uploadActions.pdfRef,
    selectedPdf: runtime.selectedPdf,
    uploadError: runtime.uploadError,
    uploadMessage: runtime.uploadMessage,
    isUploading: uploadActions.isUploading,
    dpiInput: uploadActions.dpiInput,
    thresholdInput: uploadActions.thresholdInput,
    strictTopToBottom: uploadActions.strictTopToBottom,
    spreadMode: uploadActions.spreadMode,
    ocrPhase: runtime.ocrPhase,
    ocrProgress: runtime.ocrProgress,
    currentJobId: runtime.currentJobId,
    recoveredRunNotice: runtime.recoveredRunNotice,
    totalPagesCounter: runtime.totalPagesCounter,
    rasterizedPagesCounter: runtime.rasterizedPagesCounter,
    segmentedPagesCounter: runtime.segmentedPagesCounter,
    ocrPagesCounter: runtime.ocrPagesCounter,
    workerCount,
    isProjectRoute: projectActions.isProjectRoute,
    canOpenReview: projectActions.canOpenReview,
    elapsedDisplay: runtime.elapsedDisplay,
    renameProject: projectActions.renameProject,
    triggerFileBrowser: uploadActions.triggerFileBrowser,
    onPdfSelected: uploadActions.onPdfSelected,
    uploadPdfAndStartOcr: uploadActions.uploadPdfAndStartOcr,
    openCreateProjectFlow: projectActions.openCreateProjectFlow,
    openReviewView: projectActions.openReviewView,
    requestDeleteCurrentProject: projectActions.requestDeleteCurrentProject,
    closeDeleteModal: projectActions.closeDeleteModal,
    confirmDeleteCurrentProject: projectActions.confirmDeleteCurrentProject,
  }
}
