/**
 * @file Load persisted pages and lines, maintain review selection, and construct page-image
 * URLs. Request generations prevent obsolete project responses from replacing the current
 * view.
 */
import { computed, ref } from 'vue'

/**
 * Create reactive review data and page/line selection for the current project.
 * @param {object} dependencies - Project ID ref, backend access, and viewport reset callback.
 * @returns {object} Page data, selection refs, image URLs, and loading/navigation helpers.
 */
export function useProjectReviewData({ projectId, backendFetch, getBackendBaseUrl, resetViewportState }) {
  const backendBaseUrl = ref('')
  const pages = ref([])
  const isLoading = ref(true)
  const errorMessage = ref('')
  const selectedPageIndex = ref(0)
  const pageInputValue = ref('1')
  const activeLineId = ref(null)
  const selectedLineId = ref(null)
  let loadGeneration = 0

  const selectedPage = computed(() => pages.value[selectedPageIndex.value] || null)
  const selectedPageLines = computed(() => {
    if (!selectedPage.value || !Array.isArray(selectedPage.value.lines)) {
      return []
    }

    return [...selectedPage.value.lines].sort(
      (a, b) => (a.line_order || Number.MAX_SAFE_INTEGER) - (b.line_order || Number.MAX_SAFE_INTEGER) || a.id - b.id
    )
  })
  const totalPages = computed(() => pages.value.length)
  const currentPageNumber = computed(() => selectedPageIndex.value + 1)
  const selectedPageImageUrl = computed(() => {
    if (!selectedPage.value || !backendBaseUrl.value) {
      return ''
    }

    const imgPath = selectedPage.value.img_path || ''
    const cacheKey = encodeURIComponent(`${selectedPage.value.id}:${imgPath}`)
    return `${backendBaseUrl.value}/projects/${projectId.value}/pages/${selectedPage.value.id}/image?v=${cacheKey}`
  })

  /**
   * Normalize a page payload to an array and ensure every page has a line array.
   */
  function normalizeProjectPages(rawPages) {
    if (!Array.isArray(rawPages)) {
      return []
    }

    return rawPages.map((page) => ({
      ...page,
      lines: Array.isArray(page?.lines) ? page.lines : [],
    }))
  }

  /**
   * Fetch and normalize a project's persisted review pages, throwing for non-success HTTP
   * responses.
   */
  async function fetchProjectPages(id = projectId.value) {
    const response = await backendFetch(`/projects/${id}/pages`)
    if (!response.ok) {
      throw new Error(`Unable to load project review data (${response.status})`)
    }

    const data = await response.json()
    return normalizeProjectPages(data.pages)
  }

  /**
   * Load the current project's pages and backend URL, reset page/line selection and viewport
   * state, and ignore obsolete load generations.
   */
  async function loadReviewData() {
    const generation = ++loadGeneration
    const requestedProjectId = projectId.value
    isLoading.value = true
    errorMessage.value = ''

    try {
      const baseUrl = await getBackendBaseUrl()
      const freshPages = await fetchProjectPages(requestedProjectId)
      if (generation !== loadGeneration) return
      backendBaseUrl.value = baseUrl
      pages.value = freshPages
      selectedPageIndex.value = 0
      pageInputValue.value = '1'
      selectedLineId.value = null
      activeLineId.value = null
      if (typeof resetViewportState === 'function') {
        resetViewportState()
      }
    } catch (error) {
      if (generation === loadGeneration) errorMessage.value = String(error)
    } finally {
      if (generation === loadGeneration) isLoading.value = false
    }
  }

  /**
   * Replace page data after a write/recovery while retaining the selected page ID and line
   * IDs when the project/load generation is still current.
   */
  async function refreshPagesPreservingSelection() {
    const generation = loadGeneration
    const requestedProjectId = projectId.value
    const selectedPageId = selectedPage.value?.id
    const selectedId = selectedLineId.value
    const activeId = activeLineId.value

    const freshPages = await fetchProjectPages(requestedProjectId)
    if (generation !== loadGeneration || requestedProjectId !== projectId.value) return
    pages.value = freshPages

    if (selectedPageId != null) {
      const nextIndex = freshPages.findIndex((page) => page.id === selectedPageId)
      selectedPageIndex.value = nextIndex >= 0 ? nextIndex : 0
    } else {
      selectedPageIndex.value = 0
    }

    selectedLineId.value = selectedId
    activeLineId.value = activeId
  }

  /**
   * Clamp a zero-based page index, synchronize the one-based input, and clear active/selected
   * lines.
   */
  function selectPage(index) {
    if (pages.value.length === 0) {
      selectedPageIndex.value = 0
      pageInputValue.value = '1'
      return
    }

    const clamped = Math.max(0, Math.min(index, pages.value.length - 1))
    selectedPageIndex.value = clamped
    pageInputValue.value = String(clamped + 1)
    activeLineId.value = null
    selectedLineId.value = null
  }

  /**
   * Select the first available review page through the shared clamping helper.
   */
  function goToFirstPage() {
    selectPage(0)
  }

  /**
   * Move one review page backward without passing the first page.
   */
  function goToPreviousPage() {
    selectPage(selectedPageIndex.value - 1)
  }

  /**
   * Move one review page forward without passing the last page.
   */
  function goToNextPage() {
    selectPage(selectedPageIndex.value + 1)
  }

  /**
   * Select the final review page, using the empty-dataset fallback when no pages exist.
   */
  function goToLastPage() {
    selectPage(pages.value.length - 1)
  }

  /**
   * Convert the one-based page input into a clamped selection, restoring the displayed number
   * for invalid input.
   */
  function commitPageInput() {
    const parsed = Number.parseInt(pageInputValue.value, 10)
    if (!Number.isFinite(parsed)) {
      pageInputValue.value = String(currentPageNumber.value)
      return
    }

    selectPage(parsed - 1)
  }

  /**
   * Set the transient active line ID used by hover/overlay highlighting.
   */
  function setActiveLine(lineId) {
    activeLineId.value = lineId
  }

  /**
   * Clear transient line highlighting without changing persistent selection.
   */
  function clearActiveLine() {
    activeLineId.value = null
  }

  /**
   * Set both selected and active line IDs so text and image overlays highlight the same
   * record.
   */
  function selectLine(lineId) {
    selectedLineId.value = lineId
    activeLineId.value = lineId
  }

  return {
    backendBaseUrl,
    pages,
    isLoading,
    errorMessage,
    selectedPageIndex,
    pageInputValue,
    activeLineId,
    selectedLineId,
    selectedPage,
    selectedPageLines,
    totalPages,
    currentPageNumber,
    selectedPageImageUrl,
    loadReviewData,
    refreshPagesPreservingSelection,
    selectPage,
    goToFirstPage,
    goToPreviousPage,
    goToNextPage,
    goToLastPage,
    commitPageInput,
    setActiveLine,
    clearActiveLine,
    selectLine,
  }
}
