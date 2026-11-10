/**
 * @file Persist application and project settings and apply frontend theme preferences.
 */
const BRAND_THEME_KEY = 'mimir.ui.brandTheme'
const PROJECT_SETTINGS_PREFIX = 'mimir.projectSettings.'

export const PERFORMANCE_PROFILE_OPTIONS = [
  {
    value: 'cool',
    label: 'Cool',
    description: 'Minimizes sustained CPU use and heat. Best for quieter operation or systems with limited cooling.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Recommended for most users. Balances processing speed with moderate CPU use and heat.',
  },
  {
    value: 'fast',
    label: 'Fast',
    description: 'Prioritizes processing speed and may increase CPU use, fan activity, and heat.',
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

/**
 * Parse a positive integer setting, using the supplied fallback when input is unusable.
 */
function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

/**
 * Normalize a known theme identifier and fall back to slate for unsupported values.
 */
function normalizeBrandTheme(value) {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : ''
  return BRAND_THEME_OPTIONS.some((option) => option.value === raw) ? raw : 'slate'
}

/**
 * Read and normalize the saved theme from localStorage.
 * @returns {string} A supported theme identifier.
 */
export function getSavedBrandTheme() {
  return normalizeBrandTheme(localStorage.getItem(BRAND_THEME_KEY))
}

/**
 * Set the document's data-brand-theme attribute when a document exists.
 * @param {string} theme - Requested theme identifier.
 * @returns {string} The normalized theme actually applied.
 */
export function applyBrandTheme(theme) {
  const safe = normalizeBrandTheme(theme)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-brand-theme', safe)
  }
  return safe
}

/**
 * Persist a normalized theme, apply it to the document, and return the saved identifier.
 * @param {string} theme - Requested theme identifier.
 * @returns {string} The supported theme identifier stored in localStorage.
 */
export function saveBrandTheme(theme) {
  const safe = normalizeBrandTheme(theme)
  localStorage.setItem(BRAND_THEME_KEY, safe)
  applyBrandTheme(safe)
  return safe
}

/**
 * Build a storage key for a positive parsed project ID, returning an empty string for invalid
 * IDs.
 */
function projectSettingsKey(projectId) {
  const numericId = Number.parseInt(projectId, 10)
  return Number.isFinite(numericId) && numericId > 0
    ? `${PROJECT_SETTINGS_PREFIX}${numericId}`
    : ''
}

/**
 * Return a fresh object containing default ingestion, spread, ordering, and I/J preferences.
 */
function defaultProjectSettings() {
  return {
    dpi: 300,
    binarizationThreshold: 170,
    spreadMode: 'split-spread',
    strictTopToBottom: false,
    ijDisambiguation: true,
  }
}

/**
 * Read project-scoped settings and normalize supported fields, returning fresh defaults for
 * absent or malformed JSON.
 * @param {number|string} projectId - Persistent project identifier.
 * @returns {object} Sanitized per-project settings.
 */
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
      ijDisambiguation: parsed.ijDisambiguation !== false,
    }
  } catch (_error) {
    return defaults
  }
}

/**
 * Merge defaults, saved values, and requested changes, normalize the result, and persist it
 * for a valid project ID.
 * @param {number|string} projectId - Persistent project identifier.
 * @param {object} nextSettings - Partial settings to merge.
 * @returns {object} The normalized settings, including when no valid storage key exists.
 */
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
  safe.ijDisambiguation = safe.ijDisambiguation !== false
  if (key) localStorage.setItem(key, JSON.stringify(safe))
  return safe
}
