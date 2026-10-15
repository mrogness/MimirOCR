import { computed, ref } from 'vue'

export function useProjectReviewData({ projectId, backendFetch, getBackendBaseUrl, resetViewportState }) {
  const backendBaseUrl = ref('')
  const pages = ref([])
  const isLoading = ref(true)
  const errorMessage = ref('')
  const selectedPageIndex = ref(0)
  const pageInputValue = ref('1')
  const activeLineId = ref(null)
  const selectedLineId = ref(null)

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

  function normalizeProjectPages(rawPages) {
    if (!Array.isArray(rawPages)) {
      return []
    }

    return rawPages.map((page) => ({
      ...page,
      lines: Array.isArray(page?.lines) ? page.lines : [],
    }))
  }

  async function fetchProjectPages() {
    const response = await backendFetch(`/projects/${projectId.value}/pages`)
    if (!response.ok) {
      throw new Error(`Unable to load project review data (${response.status})`)
    }

    const data = await response.json()
    return normalizeProjectPages(data.pages)
  }

  async function loadReviewData() {
    isLoading.value = true
    errorMessage.value = ''

    try {
      backendBaseUrl.value = await getBackendBaseUrl()
      pages.value = await fetchProjectPages()
      selectedPageIndex.value = 0
      pageInputValue.value = '1'
      selectedLineId.value = null
      activeLineId.value = null
      if (typeof resetViewportState === 'function') {
        resetViewportState()
      }
    } catch (error) {
      errorMessage.value = String(error)
    } finally {
      isLoading.value = false
    }
  }

  async function refreshPagesPreservingSelection() {
    const selectedPageId = selectedPage.value?.id
    const selectedId = selectedLineId.value
    const activeId = activeLineId.value

    const freshPages = await fetchProjectPages()
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

  function goToFirstPage() {
    selectPage(0)
  }

  function goToPreviousPage() {
    selectPage(selectedPageIndex.value - 1)
  }

  function goToNextPage() {
    selectPage(selectedPageIndex.value + 1)
  }

  function goToLastPage() {
    selectPage(pages.value.length - 1)
  }

  function commitPageInput() {
    const parsed = Number.parseInt(pageInputValue.value, 10)
    if (!Number.isFinite(parsed)) {
      pageInputValue.value = String(currentPageNumber.value)
      return
    }

    selectPage(parsed - 1)
  }

  function setActiveLine(lineId) {
    activeLineId.value = lineId
  }

  function clearActiveLine() {
    activeLineId.value = null
  }

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
