/**
 * @file Assemble project detail, upload, polling, preview, and runtime behavior for the
 * projects view.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useBackendRuntime } from '../../../shared/composables/useBackendRuntime'
import { useProjectActions } from './useProjectActions'
import { useProjectRuntime } from './useProjectRuntime'
import { useUploadActions } from './useUploadActions'

/**
 * Compose project actions, upload controls, run recovery, and shared backend status for the
 * project screen. Register visibility/focus listeners and release subscriptions on unmount.
 * @param {object} dependencies - Current route, router, and backend fetch function.
 * @returns {object} View-facing project/run refs and user action handlers.
 */
export function useProjectsView({ route, router, backendFetch }) {
  const project = ref(null)
  const backendRuntime = useBackendRuntime()

  /**
   * Provide a no-op reload placeholder until project actions are connected, avoiding a
   * composition-order dependency.
   */
  let loadProjectRef = async () => {}
  const runtime = useProjectRuntime({
    backendFetch,
    project,
    /**
     * Reload selected-project metadata and then refresh shared runtime status, tolerating a
     * runtime refresh failure.
     */
    reloadProject: async () => {
      await loadProjectRef()
      await backendRuntime.refreshBackendRuntime().catch(() => {})
    },
  })

  const projectActions = useProjectActions({
    route,
    router,
    backendFetch,
    project,
    applyProjectStatus: runtime.applyProjectStatus,
    resumeLatestJobIfActive: runtime.resumeLatestJobIfActive,
  })
  loadProjectRef = projectActions.loadProject

  const uploadActions = useUploadActions({
    backendFetch,
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
    activeJob: backendRuntime.activeJob,
    refreshBackendRuntime: backendRuntime.refreshBackendRuntime,
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
      await backendRuntime.refreshBackendRuntime().catch(() => {})
    },
  )

  const activeJobMessage = computed(() => {
    if (backendRuntime.backendConnection.value === 'restarting') {
      return 'Processing is unavailable while the backend restarts.'
    }
    const active = backendRuntime.activeJob.value
    if (!active) return ''
    if (Number(active.project_id) === Number(project.value?.id)) {
      return 'OCR processing is already running for this project.'
    }
    return `Project ${active.project_id} is currently being processed. Only one OCR run can run at a time.`
  })

  onMounted(async () => {
    document.addEventListener('visibilitychange', runtime.refreshRunStateOnVisibility)
    window.addEventListener('focus', runtime.refreshRunStateOnVisibility)
    backendRuntime.startBackendRuntimePolling()
    await projectActions.loadProject()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', runtime.refreshRunStateOnVisibility)
    window.removeEventListener('focus', runtime.refreshRunStateOnVisibility)
    backendRuntime.stopBackendRuntimePolling()
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
    selectedPdf: runtime.selectedPdf,
    uploadError: runtime.uploadError,
    uploadMessage: runtime.uploadMessage,
    isUploading: uploadActions.isUploading,
    isAnalyzingDpi: uploadActions.isAnalyzingDpi,
    dpiAnalysis: uploadActions.dpiAnalysis,
    dpiAnalysisError: uploadActions.dpiAnalysisError,
    dpiInput: uploadActions.dpiInput,
    thresholdInput: uploadActions.thresholdInput,
    strictTopToBottom: uploadActions.strictTopToBottom,
    ijDisambiguation: uploadActions.ijDisambiguation,
    spreadMode: uploadActions.spreadMode,
    ocrPhase: runtime.ocrPhase,
    ocrProgress: runtime.ocrProgress,
    currentJobId: runtime.currentJobId,
    recoveredRunNotice: runtime.recoveredRunNotice,
    totalPagesCounter: runtime.totalPagesCounter,
    rasterizedPagesCounter: runtime.rasterizedPagesCounter,
    segmentedPagesCounter: runtime.segmentedPagesCounter,
    ocrPagesCounter: runtime.ocrPagesCounter,
    hasActiveOcrJob: backendRuntime.hasActiveOcrJob,
    backendConnection: backendRuntime.backendConnection,
    activeJobMessage,
    isProjectRoute: projectActions.isProjectRoute,
    canOpenReview: projectActions.canOpenReview,
    elapsedDisplay: runtime.elapsedDisplay,
    renameProject: projectActions.renameProject,
    onPdfSelected: uploadActions.onPdfSelected,
    uploadPdfAndStartOcr: uploadActions.uploadPdfAndStartOcr,
    openCreateProjectFlow: projectActions.openCreateProjectFlow,
    openReviewView: projectActions.openReviewView,
    requestDeleteCurrentProject: projectActions.requestDeleteCurrentProject,
    closeDeleteModal: projectActions.closeDeleteModal,
    confirmDeleteCurrentProject: projectActions.confirmDeleteCurrentProject,
  }
}
