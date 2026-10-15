import { mount } from '@vue/test-utils'
import { afterEach, vi } from 'vitest'
import ExportSettingsSheet from '../ExportSettingsSheet.vue'

function mountSheet(overrides = {}) {
  return mount(ExportSettingsSheet, { attachTo: document.body, props: {
    show: true, isExporting: false,
    settings: { layout_mode: 'source-lines', fit_text_to_page: true, font_family: 'Times-Roman', font_size: 12 },
    ...overrides,
  } })
}

afterEach(() => { document.body.innerHTML = '' })

describe('export settings dialog', () => {
  it('updates layout settings and shows the applicable options', async () => {
    const wrapper = mountSheet()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('Preferred text size')
    const fit = [...dialog.querySelectorAll('input[type="checkbox"]')][0]
    fit.click()
    await wrapper.vm.$nextTick()
    expect(dialog.textContent).toContain('may not appear in the exported')
    dialog.querySelector('input[value="reading"]').click()
    await wrapper.vm.$nextTick()
    expect(wrapper.props('settings').layout_mode).toBe('reading')
    expect(dialog.textContent).toContain('Join words split across lines')
    expect(dialog.textContent).not.toContain('Automatically fit text')
  })

  it('emits export requests from the visible dialog buttons', () => {
    const wrapper = mountSheet()
    const buttons = [...document.querySelectorAll('[role="dialog"] button')]
    buttons.find(b => b.textContent.trim() === 'Export PDF').click()
    buttons.find(b => b.textContent.includes('Training Data')).click()
    expect(wrapper.emitted('export-pdf')).toHaveLength(1)
    expect(wrapper.emitted('export-training-data')).toHaveLength(1)
  })

  it('supports Escape and removes its listener after unmount', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const wrapper = mountSheet()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('blocks close and duplicate actions while exporting', () => {
    const wrapper = mountSheet({ isExporting: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    for (const button of document.querySelectorAll('[role="dialog"] button')) {
      expect(button.disabled).toBe(true)
      button.click()
    }
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('export-pdf')).toBeUndefined()
  })
})
