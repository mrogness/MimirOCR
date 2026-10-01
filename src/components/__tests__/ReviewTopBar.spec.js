import { mount } from '@vue/test-utils'
import ReviewTopBar from '../review/ReviewTopBar.vue'

function mountBar(props = {}) {
  return mount(ReviewTopBar, { props: {
    selectedPageIndex: 0, totalPages: 3, pageInputValue: '1', isExporting: false, ...props,
  } })
}

describe('review toolbar', () => {
  it('disables navigation at page boundaries', async () => {
    const wrapper = mountBar()
    const buttons = wrapper.findAll('button').slice(0, 4)
    expect(buttons.map(button => button.element.disabled)).toEqual([true, true, false, false])
    await buttons[2].trigger('click')
    expect(wrapper.emitted('next-page')).toHaveLength(1)
    await wrapper.setProps({ selectedPageIndex: 2 })
    expect(buttons.map(button => button.element.disabled)).toEqual([false, false, true, true])
  })

  it('emits page input and commit events', async () => {
    const wrapper = mountBar()
    await wrapper.get('input').setValue('2')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:pageInputValue')[0]).toEqual(['2'])
    expect(wrapper.emitted('commit-page-input')).toHaveLength(1)
  })

  it('prevents duplicate undo and export actions while busy', async () => {
    const wrapper = mountBar({ canUndo: true, undoLabel: 'Undo text edit' })
    const undo = wrapper.get('[aria-label="Undo text edit"]')
    const exportButton = wrapper.findAll('button').find(button => button.text() === 'Export PDF')
    await undo.trigger('click')
    await exportButton.trigger('click')
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('export-pdf')).toHaveLength(1)
    await wrapper.setProps({ isUndoing: true, isExporting: true })
    expect(undo.element.disabled).toBe(true)
    expect(exportButton.element.disabled).toBe(true)
    await undo.trigger('click')
    await exportButton.trigger('click')
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('export-pdf')).toHaveLength(1)
  })
})
