/**
 * @file Expose persisted theme preferences as reactive settings controls.
 */
import { ref } from 'vue'

/**
 * Connect theme controls to persistence and document styling with reactive error feedback.
 * @param {object} dependencies - Supported theme options and load/save/apply functions.
 * @returns {object} Theme input/options, error state, and load/preview actions.
 */
export function useBrandThemeSettings({
  brandThemeOptions,
  getSavedBrandTheme,
  saveBrandTheme,
  applyBrandTheme,
}) {
  const brandThemeInput = ref('slate')
  const brandThemeError = ref('')

  /**
   * Load and apply the saved theme, exposing any storage/application error in settings
   * feedback.
   */
  function loadBrandTheme() {
    brandThemeError.value = ''

    try {
      brandThemeInput.value = getSavedBrandTheme()
      applyBrandTheme(brandThemeInput.value)
    } catch (error) {
      brandThemeError.value = String(error)
    }
  }

  /**
   * Save and apply the selected theme immediately, restoring the saved value and displaying
   * feedback if the operation fails.
   */
  function previewBrandTheme() {
    brandThemeError.value = ''

    try {
      brandThemeInput.value = saveBrandTheme(brandThemeInput.value)
      applyBrandTheme(brandThemeInput.value)
    } catch (error) {
      brandThemeError.value = String(error)
      brandThemeInput.value = getSavedBrandTheme()
      applyBrandTheme(brandThemeInput.value)
    }
  }

  return {
    brandThemeInput,
    brandThemeOptions,
    brandThemeError,
    loadBrandTheme,
    previewBrandTheme,
  }
}
