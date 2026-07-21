import { ref } from 'vue'

import { getProjectSettings } from '../../services/appSettings'

export function useExportPdf({ projectId, backendFetch }) {
  const isExporting = ref(false)
  const showExportSettings = ref(false)
  const exportErrorMessage = ref('')
  const exportSuccessMessage = ref('')
  const exportSettings = ref({
    font_family: 'Times-Roman',
    font_size: 12,
    line_spacing: 1.35,
    margin_in: 0.8,
    spread_mode: 'split-spread',
    normalize_low_double_quote: true,
    normalize_long_s: true,
    normalize_double_oblique_hyphen: true,
    fit_text_to_page: true,
    page_size: 'letter',
  })

  function extractFilenameFromHeader(contentDisposition) {
    if (!contentDisposition) {
      return ''
    }

    const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utfMatch?.[1]) {
      return decodeURIComponent(utfMatch[1]).replace(/[\r\n]/g, '')
    }

    const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
    if (plainMatch?.[1]) {
      return plainMatch[1].replace(/[\r\n]/g, '')
    }

    return ''
  }

  async function downloadExportFromEndpoint({ path, method = 'GET', body = null, defaultFilename, successPrefix }) {
    const requestInit = {
      method,
      headers: {},
    }

    if (body != null) {
      requestInit.headers['Content-Type'] = 'application/json'
      requestInit.body = JSON.stringify(body)
    }

    const response = await backendFetch(path, requestInit)

    if (!response.ok) {
      let detail = `Unable to export (${response.status})`
      try {
        const payload = await response.json()
        if (payload?.detail) {
          detail = String(payload.detail)
        }
      } catch (_err) {
        // Keep status detail when body is not JSON.
      }
      throw new Error(detail)
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const filename =
      extractFilenameFromHeader(response.headers.get('Content-Disposition')) ||
      defaultFilename

    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    exportSuccessMessage.value = `${successPrefix} ${filename}`
    showExportSettings.value = false
  }

  async function exportProjectPdf() {
    isExporting.value = true
    exportErrorMessage.value = ''
    exportSuccessMessage.value = ''

    try {
      const query = new URLSearchParams({
        ...exportSettings.value,
        spread_mode: getProjectSettings(projectId.value).spreadMode,
        font_size: String(Number(exportSettings.value.font_size)),
        line_spacing: String(Number(exportSettings.value.line_spacing)),
        margin_in: String(Number(exportSettings.value.margin_in)),
      })

      await downloadExportFromEndpoint({
        path: `/export/projects/${projectId.value}/pdf?${query.toString()}`,
        method: 'GET',
        defaultFilename: `project_${projectId.value}_export.pdf`,
        successPrefix: 'Exported',
      })
    } catch (error) {
      exportErrorMessage.value = String(error)
    } finally {
      isExporting.value = false
    }
  }

  async function exportTrainingData() {
    isExporting.value = true
    exportErrorMessage.value = ''
    exportSuccessMessage.value = ''

    try {
      await downloadExportFromEndpoint({
        path: `/export/projects/${projectId.value}/training-data`,
        method: 'GET',
        defaultFilename: `project_${projectId.value}_training_data.zip`,
        successPrefix: 'Exported',
      })
    } catch (error) {
      exportErrorMessage.value = String(error)
    } finally {
      isExporting.value = false
    }
  }

  return {
    isExporting,
    showExportSettings,
    exportErrorMessage,
    exportSuccessMessage,
    exportSettings,
    exportProjectPdf,
    exportTrainingData,
  }
}
