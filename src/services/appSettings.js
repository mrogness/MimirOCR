const BRAND_THEME_KEY = 'mimir.ui.brandTheme'
const PROJECT_SETTINGS_PREFIX = 'mimir.projectSettings.'

export const PERFORMANCE_PROFILE_OPTIONS = [
  {
    value: 'cool',
    label: 'Cool',
    description: 'Lowest sustained CPU use and heat. Uses one segmentation worker and one OCR thread.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Recommended default with moderate parallelism and controlled native thread counts.',
  },
  {
    value: 'fast',
    label: 'Fast',
    description: 'Uses more CPU on systems with stronger processors and cooling.',
  },
]

export const BRAND_THEME_OPTIONS = [
  { value: 'slate', label: 'Slate' },
  { value: 'zinc', label: 'Zinc' },
  { value: 'stone', label: 'Stone' },
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'sage', label: 'Sage' },
  { value: 'plum', label: 'Plum' },
  { value: 'rose', label: 'Rose' },
  { value: 'amber', label: 'Amber' },
]

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

function normalizeBrandTheme(value) {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : ''
  return BRAND_THEME_OPTIONS.some((option) => option.value === raw) ? raw : 'slate'
}

export function getSavedBrandTheme() {
  return normalizeBrandTheme(localStorage.getItem(BRAND_THEME_KEY))
}

export function applyBrandTheme(theme) {
  const safe = normalizeBrandTheme(theme)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-brand-theme', safe)
  }
  return safe
}

export function saveBrandTheme(theme) {
  const safe = normalizeBrandTheme(theme)
  localStorage.setItem(BRAND_THEME_KEY, safe)
  applyBrandTheme(safe)
  return safe
}

function projectSettingsKey(projectId) {
  const numericId = Number.parseInt(projectId, 10)
  return Number.isFinite(numericId) && numericId > 0
    ? `${PROJECT_SETTINGS_PREFIX}${numericId}`
    : ''
}

function defaultProjectSettings() {
  return {
    dpi: 300,
    binarizationThreshold: 170,
    spreadMode: 'split-spread',
    strictTopToBottom: false,
  }
}

export function getProjectSettings(projectId) {
  const key = projectSettingsKey(projectId)
  const defaults = defaultProjectSettings()
  if (!key) return defaults

  const raw = localStorage.getItem(key)
  if (!raw) return defaults

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    return {
      dpi: toPositiveInt(parsed.dpi, defaults.dpi),
      binarizationThreshold: toPositiveInt(
        parsed.binarizationThreshold,
        defaults.binarizationThreshold,
      ),
      spreadMode: parsed.spreadMode === 'single' ? 'single' : 'split-spread',
      strictTopToBottom: parsed.strictTopToBottom === true,
    }
  } catch (_error) {
    return defaults
  }
}

export function saveProjectSettings(projectId, nextSettings) {
  const key = projectSettingsKey(projectId)
  const safe = {
    ...defaultProjectSettings(),
    ...getProjectSettings(projectId),
    ...(nextSettings || {}),
  }
  safe.dpi = toPositiveInt(safe.dpi, 300)
  safe.binarizationThreshold = toPositiveInt(safe.binarizationThreshold, 170)
  safe.spreadMode = safe.spreadMode === 'single' ? 'single' : 'split-spread'
  safe.strictTopToBottom = safe.strictTopToBottom === true
  if (key) localStorage.setItem(key, JSON.stringify(safe))
  return safe
}
