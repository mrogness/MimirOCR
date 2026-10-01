import { mount } from '@vue/test-utils'
import PredictedLineRow from '../review/PredictedLineRow.vue'

function mountRow(overrides = {}) {
  return mount(PredictedLineRow, {
    props: {
      line: { id: 7, line_order: 1, ocr_text: 'Prediction', corrected_text: 'Ændret' },
      index: 0, totalLines: 2, lineSaveState: {}, showSuspiciousHints: false,
      lineHasSuspiciousChars: false, suspiciousSegments: [], rowRefFn: () => {}, ...overrides,
    },
  })
}

describe('review line row', () => {
  it('displays corrections and emits edits without mutating the prop', async () => {
    const wrapper = mountRow()
    expect(wrapper.get('textarea').element.value).toBe('Ændret')
    await wrapper.get('textarea').setValue('New text')
    expect(wrapper.emitted('line-input')[0]).toEqual([wrapper.props('line'), 'New text'])
    expect(wrapper.props('line').corrected_text).toBe('Ændret')
  })

  it('prevents moving beyond the first and last line', async () => {
    const wrapper = mountRow()
    const [up, down] = wrapper.findAll('button')
    expect(up.element.disabled).toBe(true)
    expect(down.element.disabled).toBe(false)
    await up.trigger('click')
    expect(wrapper.emitted('move-line')).toBeUndefined()
    await down.trigger('click')
    expect(wrapper.emitted('move-line')[0]).toEqual([wrapper.props('line'), 1])
    expect(wrapper.emitted('select-line')).toBeUndefined()
    await wrapper.setProps({ index: 1 })
    expect(up.element.disabled).toBe(false)
    expect(down.element.disabled).toBe(true)
  })

  it('emits selection, deletion and explicit order changes', async () => {
    const wrapper = mountRow()
    await wrapper.trigger('click')
    expect(wrapper.emitted('select-line')[0]).toEqual([7])
    await wrapper.get('[title="Delete line"]').trigger('click')
    expect(wrapper.emitted('delete-line')[0]).toEqual([wrapper.props('line')])
    const order = wrapper.get('input[type="number"]')
    await order.setValue('2')
    await order.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit-line-order-input')[0]).toEqual([wrapper.props('line'), '2'])
    expect(wrapper.emitted('select-line')).toHaveLength(1)
  })

  it.each([['saving', 'Saving...'], ['saved', 'Saved'], ['error', 'Save failed']])(
    'renders %s persistence feedback', (status, message) => {
      const wrapper = mountRow({ lineSaveState: { 7: { status, message: 'Server unavailable' } } })
      expect(wrapper.text()).toContain(message)
      if (status === 'error') expect(wrapper.text()).toContain('Server unavailable')
    },
  )
})
