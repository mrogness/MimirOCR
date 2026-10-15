import { ref } from 'vue'

export function useBrandThemeSettings({
  brandThemeOptions,
  getSavedBrandTheme,
  saveBrandTheme,
  applyBrandTheme,
}) {
  const brandThemeInput = ref('slate')
  const brandThemeError = ref('')

  function loadBrandTheme() {
    brandThemeError.value = ''

    try {
      brandThemeInput.value = getSavedBrandTheme()
      applyBrandTheme(brandThemeInput.value)
    } catch (error) {
      brandThemeError.value = String(error)
    }
  }

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
