import { applyBrandTheme, getProjectSettings, getSavedBrandTheme, saveBrandTheme, saveProjectSettings } from '../appSettings'

describe('persisted application settings', () => {
  it('normalizes and applies a theme', () => {
    expect(saveBrandTheme(' TEAL ')).toBe('teal')
    expect(getSavedBrandTheme()).toBe('teal')
    expect(document.documentElement.getAttribute('data-brand-theme')).toBe('teal')
    expect(applyBrandTheme('invalid')).toBe('slate')
  })

  it.each(['{broken', 'null', '42', '"text"'])('recovers from invalid stored JSON: %s', raw => {
    localStorage.setItem('mimir.projectSettings.1', raw)
    expect(getProjectSettings(1)).toEqual({
      dpi: 300, binarizationThreshold: 170, spreadMode: 'split-spread',
      strictTopToBottom: false, ijDisambiguation: true,
    })
  })

  it('merges partial updates and isolates projects', () => {
    saveProjectSettings(1, { dpi: 600, spreadMode: 'single' })
    saveProjectSettings(1, { ijDisambiguation: false })
    expect(getProjectSettings(1)).toMatchObject({ dpi: 600, spreadMode: 'single', ijDisambiguation: false })
    expect(getProjectSettings(2)).toMatchObject({ dpi: 300, ijDisambiguation: true })
  })

  it('normalizes invalid values without writing invalid project identifiers', () => {
    expect(saveProjectSettings(1, { dpi: -1, binarizationThreshold: 'bad', spreadMode: 'bad' }))
      .toMatchObject({ dpi: 300, binarizationThreshold: 170, spreadMode: 'split-spread' })
    const count = localStorage.length
    saveProjectSettings(null, { dpi: 600 })
    saveProjectSettings(-1, { dpi: 600 })
    expect(localStorage.length).toBe(count)
  })
})
