import { ref } from 'vue'
import { vi } from 'vitest'
import { useProjectReviewData } from '../useProjectReviewData'
import { deferred, jsonResponse } from '../../../../test/helpers'

function harness() {
  const projectId = ref(7)
  const backendFetch = vi.fn(async () => jsonResponse({ pages: [
    { id: 10, img_path: 'Æble.png', lines: [{ id: 102, line_order: 2 }, { id: 101, line_order: 1 }] },
    { id: 20 },
  ] }))
  const resetViewportState = vi.fn()
  return { projectId, backendFetch, resetViewportState, ...useProjectReviewData({
    projectId, backendFetch, getBackendBaseUrl: async () => 'http://localhost:9000', resetViewportState,
  }) }
}

describe('review data and page navigation', () => {
  it('normalizes missing lines and sorts without modifying API order', async () => {
    const api = harness()
    await api.loadReviewData()
    expect(api.pages.value[1].lines).toEqual([])
    expect(api.selectedPageLines.value.map(l => l.id)).toEqual([101, 102])
    expect(api.pages.value[0].lines.map(l => l.id)).toEqual([102, 101])
    expect(api.selectedPageImageUrl.value).toContain('/projects/7/pages/10/image?v=10%3A')
    expect(api.resetViewportState).toHaveBeenCalledOnce()
    expect(api.isLoading.value).toBe(false)
  })

  it('clamps navigation and clears line selection when pages change', async () => {
    const api = harness()
    await api.loadReviewData()
    api.selectLine(101)
    api.goToPreviousPage()
    expect(api.currentPageNumber.value).toBe(1)
    api.goToLastPage()
    expect(api.currentPageNumber.value).toBe(2)
    expect(api.selectedLineId.value).toBeNull()
    api.goToNextPage()
    expect(api.currentPageNumber.value).toBe(2)
    api.pageInputValue.value = 'garbage'
    api.commitPageInput()
    expect(api.pageInputValue.value).toBe('2')
    api.pageInputValue.value = '-4'
    api.commitPageInput()
    expect(api.currentPageNumber.value).toBe(1)
  })

  it('preserves the selected page by ID across refresh and reordered pages', async () => {
    const api = harness()
    await api.loadReviewData()
    api.selectPage(1)
    api.selectLine(201)
    api.backendFetch.mockResolvedValueOnce(jsonResponse({ pages: [{ id: 20, lines: [{ id: 201 }] }, { id: 10 }] }))
    await api.refreshPagesPreservingSelection()
    expect(api.selectedPage.value.id).toBe(20)
    expect(api.selectedLineId.value).toBe(201)
    expect(api.currentPageNumber.value).toBe(1)
  })

  it('handles an empty project and loading errors', async () => {
    const api = harness()
    api.backendFetch.mockResolvedValueOnce(jsonResponse({ pages: null }))
    await api.loadReviewData()
    api.goToNextPage()
    expect(api.selectedPage.value).toBeNull()
    expect(api.selectedPageImageUrl.value).toBe('')
    api.backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await api.loadReviewData()
    expect(api.errorMessage.value).toContain('500')
    expect(api.isLoading.value).toBe(false)
  })

  it('ignores an old project response that arrives after a newer project', async () => {
    const api = harness()
    const old = deferred()
    api.backendFetch.mockReturnValueOnce(old.promise)
    const firstLoad = api.loadReviewData()
    await Promise.resolve()
    api.projectId.value = 8
    api.backendFetch.mockResolvedValueOnce(jsonResponse({ pages: [{ id: 80 }] }))
    await api.loadReviewData()
    old.resolve(jsonResponse({ pages: [{ id: 10 }] }))
    await firstLoad
    expect(api.selectedPage.value.id).toBe(80)
    expect(api.selectedPageImageUrl.value).toContain('/projects/8/pages/80/')
  })
})
