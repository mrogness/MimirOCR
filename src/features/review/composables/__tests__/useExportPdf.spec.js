import { ref } from 'vue'
import { beforeEach, afterEach, vi } from 'vitest'
import { useExportPdf } from '../useExportPdf'
import { saveProjectSettings } from '../../../../shared/services/appSettings'
import { deferred, jsonResponse, stubObjectUrls } from '../../../../test/helpers'

describe('export downloads', () => {
  let backendFetch
  let clicked
  let click
  beforeEach(() => {
    clicked = []
    stubObjectUrls()
    URL.createObjectURL.mockReturnValue('blob:export')
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked.push({ filename: this.download, href: this.href, attached: document.body.contains(this) })
    })
    backendFetch = vi.fn(async () => ({
      ok: true, blob: async () => new Blob(['export']),
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="book.pdf"' }),
    }))
  })
  afterEach(() => { click.mockRestore(); vi.unstubAllGlobals() })

  it('sends the chosen settings and the project spread mode, then cleans up the download', async () => {
    saveProjectSettings(7, { spreadMode: 'single' })
    const api = useExportPdf({ projectId: ref(7), backendFetch })
    api.exportSettings.value.layout_mode = 'reading'
    api.exportSettings.value.normalize_long_s = false
    api.exportSettings.value.font_size = '14'
    api.showExportSettings.value = true
    await api.exportProjectPdf()
    const url = new URL(backendFetch.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/export/projects/7/pdf')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      spread_mode: 'single', layout_mode: 'reading', font_size: '14', normalize_long_s: 'false',
    })
    expect(clicked).toEqual([{ filename: 'book.pdf', href: 'blob:export', attached: true }])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export')
    expect(api.showExportSettings.value).toBe(false)
    expect(api.exportSuccessMessage.value).toContain('book.pdf')
    expect(api.isExporting.value).toBe(false)
  })

  it.each([
    ["attachment; filename*=UTF-8''%C3%86ble.pdf", 'Æble.pdf'],
    ['', 'project_7_export.pdf'],
    ["attachment; filename*=UTF-8''bad%ZZ.pdf", 'project_7_export.pdf'],
  ])('handles download filename header %s', async (header, expected) => {
    backendFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(), headers: new Headers({ 'Content-Disposition': header }) })
    await useExportPdf({ projectId: ref(7), backendFetch }).exportProjectPdf()
    expect(clicked[0].filename).toBe(expected)
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('downloads training data as a ZIP with a fallback filename', async () => {
    backendFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(), headers: new Headers() })
    const api = useExportPdf({ projectId: ref(7), backendFetch })
    await api.exportTrainingData()
    expect(backendFetch.mock.calls[0][0]).toBe('/export/projects/7/training-data')
    expect(clicked[0].filename).toBe('project_7_training_data.zip')
  })

  it.each(['server', 'network', 'blob'])('reports %s failures, keeps settings open and resets busy state', async (failure) => {
    if (failure === 'server') backendFetch.mockResolvedValue(jsonResponse({ detail: 'No usable text' }, 400))
    if (failure === 'network') backendFetch.mockRejectedValue(new TypeError('Offline'))
    if (failure === 'blob') backendFetch.mockResolvedValue({ ok: true, blob: async () => { throw new Error('Read failed') } })
    const api = useExportPdf({ projectId: ref(7), backendFetch })
    api.showExportSettings.value = true
    await api.exportProjectPdf()
    expect(api.exportErrorMessage.value).toMatch(/No usable text|Offline|Read failed/)
    expect(api.exportSuccessMessage.value).toBe('')
    expect(api.showExportSettings.value).toBe(true)
    expect(api.isExporting.value).toBe(false)
    expect(clicked).toEqual([])
  })

  it('awaits pending corrections and ignores a duplicate export while busy', async () => {
    const saved = deferred()
    const beforeExport = vi.fn(() => saved.promise)
    const api = useExportPdf({ projectId: ref(7), backendFetch, beforeExport })
    const exporting = api.exportProjectPdf()
    await api.exportTrainingData()
    expect(api.isExporting.value).toBe(true)
    expect(backendFetch).not.toHaveBeenCalled()
    saved.resolve()
    await exporting
    expect(beforeExport).toHaveBeenCalledOnce()
    expect(backendFetch).toHaveBeenCalledOnce()
  })

  it('does not export when saving the latest correction fails', async () => {
    const api = useExportPdf({ projectId: ref(7), backendFetch, beforeExport: async () => { throw new Error('Unsaved correction') } })
    await api.exportProjectPdf()
    expect(backendFetch).not.toHaveBeenCalled()
    expect(api.exportErrorMessage.value).toContain('Unsaved correction')
    expect(api.isExporting.value).toBe(false)
  })
})
