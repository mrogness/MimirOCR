import { flushPromises } from '@vue/test-utils'
import { vi } from 'vitest'
import { useDashboard } from '../useDashboard'
import { mountComposable, jsonResponse } from '../../../../test/helpers'

async function dashboard() {
  const backendFetch = vi.fn(async () => jsonResponse({ projects: [{ id: 7, name: 'Book' }] }))
  const router = { push: vi.fn(async () => {}) }
  const { result } = mountComposable(() => useDashboard({ router, backendFetch, getBackendStartupIssue: async () => '' }))
  await flushPromises()
  backendFetch.mockClear()
  return { ...result, backendFetch, router }
}

describe('dashboard project lifecycle', () => {
  it('loads projects and creates a trimmed project name before navigating', async () => {
    const api = await dashboard()
    expect(api.hasProjects.value).toBe(true)
    api.openCreateModal()
    api.newProjectName.value = '  New Book  '
    api.backendFetch.mockResolvedValueOnce(jsonResponse({ id: 8, name: 'New Book' }))
    await api.createProjectAndGo()
    expect(JSON.parse(api.backendFetch.mock.calls[0][1].body)).toEqual({ name: 'New Book' })
    expect(api.showCreateModal.value).toBe(false)
    expect(api.router.push).toHaveBeenCalledWith({ name: 'projectDetail', params: { id: 8 } })
  })

  it('keeps the creation dialog open after validation or API failure', async () => {
    const api = await dashboard()
    api.openCreateModal()
    await api.createProjectAndGo()
    expect(api.backendFetch).not.toHaveBeenCalled()
    api.newProjectName.value = 'Book'
    api.backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await api.createProjectAndGo()
    expect(api.showCreateModal.value).toBe(true)
    expect(api.createError.value).toContain('500')
    expect(api.isCreating.value).toBe(false)
  })

  it('keeps the project on failed deletion and removes it after a successful retry', async () => {
    const api = await dashboard()
    api.requestDeleteProject(7)
    expect(api.pendingDeleteProjectName.value).toBe('Book')
    api.backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await api.confirmDeleteProject()
    expect(api.projects.value).toHaveLength(1)
    expect(api.isDeleteModalOpen.value).toBe(true)
    api.backendFetch.mockResolvedValueOnce(jsonResponse(null, 204))
    await api.confirmDeleteProject()
    expect(api.projects.value).toEqual([])
    expect(api.isDeleteModalOpen.value).toBe(false)
  })
})
