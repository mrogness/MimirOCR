import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, afterEach, vi } from 'vitest'
import { jsonResponse, stubObjectUrls } from '../../../test/helpers'

vi.mock('../../../shared/services/backend', () => ({ backendFetch: vi.fn() }))
// Canvas/PDF.js has its own pixel/orchestration suite. Keep the rest of the UI real.
vi.mock('../components/BinarizedPdfPreview.vue', () => ({ default: { template: '<div>PDF preview</div>' } }))
import { backendFetch } from '../../../shared/services/backend'
import { useBackendRuntime } from '../../../shared/composables/useBackendRuntime'
import ProjectsView from '../ProjectsView.vue'

describe('project upload and OCR workflow', () => {
  let wrapper, router, started, completed, failUpload
  function button(text) { return wrapper.findAll('button').find(b => b.text().trim() === text) }
  beforeEach(async () => {
    vi.useFakeTimers()
    stubObjectUrls()
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    started = false
    completed = false
    failUpload = false
    useBackendRuntime().applyBackendRuntime({ backend_instance_id: 'test', performance: { profile: 'balanced' } })
    backendFetch.mockReset().mockImplementation(async (path, init = {}) => {
      if (path === '/system/runtime') return jsonResponse({
        backend_instance_id: 'test', performance: { profile: 'balanced' },
        active_job: started && !completed ? { job_id: 'job', project_id: 7 } : null,
      })
      if (path === '/projects/7') return jsonResponse({ id: 7, name: 'Book', ocr_last_status: completed ? 'succeeded' : started ? 'running' : null })
      if (path === '/files/analyze-pdf-dpi') return jsonResponse({ recommended_dpi: 300 })
      if (path.endsWith('/upload-pdf')) return failUpload ? jsonResponse({ detail: 'Storage unavailable' }, 500) : jsonResponse({ upload_id: 'upload', filename: 'book.pdf' })
      if (path === '/ocr/projects/7/jobs' && init.method === 'POST') {
        started = true
        return jsonResponse({ job_id: 'job' })
      }
      if (path === '/ocr/projects/7/jobs') return jsonResponse({ jobs: started ? [{
        job_id: 'job', status: completed ? 'succeeded' : 'running',
        phase: completed ? 'completed' : 'ocr', progress: completed ? 100 : 45,
      }] : [] })
      if (path === '/ocr/jobs/job') return jsonResponse({
        status: completed ? 'succeeded' : 'running', phase: completed ? 'completed' : 'ocr',
        progress: completed ? 100 : 45, total_pages: 2, ocr_pages: completed ? 2 : 1,
      })
      throw new Error(`Unexpected request ${path}`)
    })
    router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/projects/:id', name: 'projectDetail', component: ProjectsView },
      { path: '/review/:id', name: 'projectReview', component: { template: '<div>Review destination</div>' } },
      { path: '/', name: 'home', component: { template: '<div />' } },
    ] })
    await router.push('/projects/7')
    wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', { value: [new File(['pdf'], 'book.pdf', { type: 'application/pdf' })] })
    await fileInput.trigger('change')
    await flushPromises()
  })
  afterEach(() => { wrapper.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('submits the selected file, shows progress and enables navigation to review on completion', async () => {
    const submit = button('Submit and Process')
    expect(submit.element.disabled).toBe(false)
    await submit.trigger('click')
    await flushPromises()
    const upload = backendFetch.mock.calls.find(([path]) => path.endsWith('/upload-pdf'))
    expect(upload[1].body.get('file').name).toBe('book.pdf')
    const start = backendFetch.mock.calls.find(([path, init]) => path === '/ocr/projects/7/jobs' && init?.method === 'POST')
    expect(JSON.parse(start[1].body)).toMatchObject({ upload_id: 'upload', config: { dpi: 300, disambiguate_ij: true } })
    expect(wrapper.text()).toContain('45%')
    expect(button('Open Output Review').element.disabled).toBe(true)
    completed = true
    await vi.advanceTimersByTimeAsync(1200)
    await flushPromises()
    expect(wrapper.text()).toContain('100%')
    expect(button('Open Output Review').element.disabled).toBe(false)
    await button('Open Output Review').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('projectReview')
    expect(wrapper.text()).toContain('Review destination')
  })

  it('shows upload failure and allows a retry without creating an OCR job', async () => {
    failUpload = true
    await button('Submit and Process').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Storage unavailable')
    expect(started).toBe(false)
    expect(button('Submit and Process').element.disabled).toBe(false)
    failUpload = false
    await button('Submit and Process').trigger('click')
    await flushPromises()
    expect(started).toBe(true)
    expect(wrapper.text()).toContain('45%')
  })
})
