import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, afterEach, vi } from 'vitest'
import { jsonResponse, stubObjectUrls } from '../../../test/helpers'

vi.mock('../../../shared/services/backend', () => ({ backendFetch: vi.fn(), getBackendBaseUrl: vi.fn(async () => 'http://localhost:9000') }))
import { backendFetch } from '../../../shared/services/backend'
import ProjectReviewView from '../ProjectReviewView.vue'
import PredictedLineRow from '../components/PredictedLineRow.vue'
import PageImageOverlay from '../components/PageImageOverlay.vue'

// Real views/composables/children; only the external API and browser download are mocked.
describe('review screen workflows', () => {
  let router, pages, wrapper, saved, exportText
  async function openReview() {
    router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/review/:id', name: 'projectReview', component: ProjectReviewView },
      { path: '/projects/:id', name: 'projectDetail', component: { template: '<div />' } },
    ] })
    await router.push('/review/7')
    await router.isReady()
    wrapper = mount({ template: '<RouterView />' }, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }
  function button(text) { return wrapper.findAll('button').find(b => b.text().trim() === text) }
  beforeEach(() => {
    vi.useFakeTimers()
    saved = null
    exportText = null
    pages = [
      { id: 10, width: 100, height: 200, lines: [{ id: 101, page_id: 10, line_order: 1, ocr_text: 'Original', corrected_text: null, bounding_box: { x_min: 1, x_max: 90, y_min: 1, y_max: 10 } }] },
      { id: 20, width: 100, height: 200, lines: [{ id: 201, page_id: 20, line_order: 1, ocr_text: 'Second page' }] },
    ]
    backendFetch.mockReset().mockImplementation(async (path, init = {}) => {
      if (path.includes('/pages')) return jsonResponse({ pages: structuredClone(pages) })
      if (path === '/lines/101') {
        saved = JSON.parse(init.body).corrected_text
        pages[0].lines[0].corrected_text = saved
        return jsonResponse({ line: { corrected_text: saved } })
      }
      if (path.includes('/export/')) {
        exportText = pages[0].lines[0].corrected_text
        return { ok: true, headers: new Headers(), blob: async () => new Blob(['pdf']) }
      }
      throw new Error(`Unexpected API call ${path}`)
    })
    Element.prototype.scrollIntoView = vi.fn()
    stubObjectUrls()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); delete Element.prototype.scrollIntoView; document.body.innerHTML = '' })

  it('saves an edit made through the textarea and shows it after remount', async () => {
    await openReview()
    await wrapper.get('textarea').setValue('Ændret')
    await vi.advanceTimersByTimeAsync(350)
    expect(saved).toBe('Ændret')
    expect(wrapper.text()).toContain('Saved')
    wrapper.unmount()
    await openReview()
    expect(wrapper.get('textarea').element.value).toBe('Ændret')
  })

  it('flushes the latest correction when Export PDF is clicked immediately', async () => {
    await openReview()
    await wrapper.get('textarea').setValue('Newest text')
    await button('Export PDF').trigger('click')
    await flushPromises()
    expect(exportText).toBe('Newest text')
    expect(wrapper.text()).toContain('Exported')
  })

  it('connects overlay selection to the text row and navigates both panels', async () => {
    await openReview()
    await wrapper.findComponent(PageImageOverlay).get('svg > rect').trigger('click')
    expect(wrapper.findComponent(PredictedLineRow).props('selectedLineId')).toBe(101)
    await button('▶').trigger('click')
    expect(wrapper.get('textarea').element.value).toBe('Second page')
    expect(wrapper.findComponent(PredictedLineRow).props('selectedLineId')).toBeNull()
    expect(wrapper.get('img[alt="OCR page"]').attributes('src')).toContain('/pages/20/image')
  })

  it('restores the displayed order and shows an error when a move fails', async () => {
    pages[0].lines.push({ id: 102, page_id: 10, line_order: 2, ocr_text: 'Another line' })
    await openReview()
    backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await wrapper.findAllComponents(PredictedLineRow)[0].findAll('button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('textarea').map(input => input.element.value)).toEqual(['Original', 'Another line'])
    expect(wrapper.text()).toContain('Restored previous order')
  })

  it('shows a failed correction save and prevents exporting older text', async () => {
    await openReview()
    backendFetch.mockResolvedValueOnce(jsonResponse({}, 500))
    await wrapper.get('textarea').setValue('Unsaved draft')
    await button('Export PDF').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('unsaved')
    expect(wrapper.get('textarea').element.value).toBe('Unsaved draft')
    expect(exportText).toBeNull()
  })

  it('handles keyboard undo through the real editing flow', async () => {
    await openReview()
    await wrapper.get('textarea').setValue('Draft')
    await vi.advanceTimersByTimeAsync(350)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('Original')
    expect(saved).toBe('Original')
  })

  it('clears undo history and queued saves when the project route changes', async () => {
    await openReview()
    await wrapper.get('textarea').setValue('Pending')
    await router.push('/review/8')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    expect(saved).toBeNull()
    expect(wrapper.findAll('button').find(b => b.text() === 'Undo').element.disabled).toBe(true)
  })

  it.each(['empty', 'error'])('renders the %s review state', async state => {
    if (state === 'empty') pages = []
    else backendFetch.mockResolvedValue(jsonResponse({}, 500))
    await openReview()
    expect(wrapper.text()).toContain(state === 'empty' ? 'No OCR pages stored yet' : 'Unable to load project review data')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })
})
