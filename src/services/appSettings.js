const OCR_WORKER_COUNT_KEY = 'mimir.ocr.workerCount'
const BRAND_THEME_KEY = 'mimir.ui.brandTheme'
const PROJECT_SETTINGS_PREFIX = 'mimir.projectSettings.'

export const BRAND_THEME_OPTIONS = [
  { value: 'slate', label: 'Slate' },
  { value: 'gray', label: 'Gray' },
  { value: 'zinc', label: 'Zinc' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'stone', label: 'Stone' },
  { value: 'mauve', label: 'Mauve' },
  { value: 'olive', label: 'Olive' },
  { value: 'mist', label: 'Mist' },
  { value: 'taupe', label: 'Taupe' },
]

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 1) {
    return fallback
  }
  return n
}

export function getDefaultWorkerCount(totalCores) {
  return 1
}

export function getSavedWorkerCount(fallback) {
  const raw = localStorage.getItem(OCR_WORKER_COUNT_KEY)
  return toPositiveInt(raw, fallback)
}

export function saveWorkerCount(value) {
  const safe = toPositiveInt(value, 1)
  localStorage.setItem(OCR_WORKER_COUNT_KEY, String(safe))
  return safe
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
  if (!key) {
    return defaults
  }

  const raw = localStorage.getItem(key)
  if (!raw) {
    return defaults
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return defaults
    }

    const spreadMode = parsed.spreadMode === 'single' ? 'single' : 'split-spread'
    return {
      dpi: toPositiveInt(parsed.dpi, defaults.dpi),
      binarizationThreshold: toPositiveInt(parsed.binarizationThreshold, defaults.binarizationThreshold),
      spreadMode,
      strictTopToBottom: parsed.strictTopToBottom === true,
    }
  } catch (_err) {
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

  if (key) {
    localStorage.setItem(key, JSON.stringify(safe))
  }
  return safe
}
