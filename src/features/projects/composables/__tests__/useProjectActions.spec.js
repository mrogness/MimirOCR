import { reactive, ref, nextTick } from 'vue'
import { beforeEach, afterEach, vi } from 'vitest'
import { useProjectActions } from '../useProjectActions'
import { mountComposable, jsonResponse } from '../../../../test/helpers'

describe('project actions', () => {
  let api, backendFetch, router, project, wrapper
  beforeEach(async () => {
    vi.useFakeTimers()
    project = ref(null)
    router = { push: vi.fn(async () => {}) }
    backendFetch = vi.fn(async () => jsonResponse({ id: 7, name: 'Book', ocr_last_status: 'succeeded' }))
    const mounted = mountComposable(() => useProjectActions({
      route: reactive({ params: { id: '7' } }), router, backendFetch, project,
      applyProjectStatus: vi.fn(), resumeLatestJobIfActive: vi.fn(async () => {}),
    }))
    api = mounted.result
    wrapper = mounted.wrapper
    await api.loadProject()
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    backendFetch.mockClear()
  })
  afterEach(() => { wrapper.unmount(); vi.clearAllTimers(); vi.useRealTimers() })

  it('debounces renaming and persists only the latest trimmed name', async () => {
    backendFetch.mockImplementation(async (_path, options) => jsonResponse({ id: 7, name: JSON.parse(options.body).name }))
    api.renameInput.value = 'Draft'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    api.renameInput.value = '  Finished  '
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(backendFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(backendFetch.mock.calls[0][1].body)).toEqual({ name: 'Finished' })
    expect(project.value.name).toBe('Finished')
  })

  it('validates empty names and surfaces a failed rename', async () => {
    await api.renameProject(' ')
    expect(backendFetch).not.toHaveBeenCalled()
    expect(api.renameError.value).toContain('empty')
    backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await api.renameProject('New')
    expect(project.value.name).toBe('Book')
    expect(api.renameError.value).toContain('500')
    expect(api.isRenaming.value).toBe(false)
  })

  it('cancels a pending rename on unmount', async () => {
    api.renameInput.value = 'Pending'
    await nextTick()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(1000)
    expect(backendFetch).not.toHaveBeenCalled()
  })

  it('keeps the delete dialog and current route after deletion fails', async () => {
    api.requestDeleteCurrentProject()
    backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await api.confirmDeleteCurrentProject()
    expect(api.isDeleteModalOpen.value).toBe(true)
    expect(router.push).not.toHaveBeenCalled()
    expect(api.isDeletingProject.value).toBe(false)
    expect(api.projectError.value).toContain('500')
  })

  it('navigates home after a successful deletion', async () => {
    api.requestDeleteCurrentProject()
    backendFetch.mockResolvedValueOnce(jsonResponse(null, 204))
    await api.confirmDeleteCurrentProject()
    expect(api.isDeleteModalOpen.value).toBe(false)
    expect(router.push).toHaveBeenCalledWith({ name: 'home' })
  })

  it('only opens review for a completed project', async () => {
    project.value.ocr_last_status = 'running'
    await api.openReviewView()
    expect(router.push).not.toHaveBeenCalled()
    project.value.ocr_last_status = 'succeeded'
    await api.openReviewView()
    expect(router.push).toHaveBeenCalledWith({ name: 'projectReview', params: { id: 7 } })
  })
})
