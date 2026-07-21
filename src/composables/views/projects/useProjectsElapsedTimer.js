import { computed } from 'vue'

export function useProjectsElapsedTimer({ processingStartMs, processingEndMs, processingNowMs, persistedElapsedSeconds }) {
  let elapsedTimer = null

  function startElapsedTimer() {
    stopElapsedTimer()
    processingNowMs.value = Date.now()
    elapsedTimer = setInterval(() => {
      processingNowMs.value = Date.now()
    }, 1000)
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  }

  function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return '--:--'
    }

    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const elapsedDisplay = computed(() => {
    if (!processingStartMs.value) {
      if (Number.isFinite(persistedElapsedSeconds.value)) {
        return formatElapsed(persistedElapsedSeconds.value * 1000)
      }
      return '--:--'
    }

    const end = processingEndMs.value || processingNowMs.value || Date.now()
    return formatElapsed(end - processingStartMs.value)
  })

  function cleanupElapsedTimer() {
    stopElapsedTimer()
  }

  return {
    elapsedDisplay,
    startElapsedTimer,
    stopElapsedTimer,
    cleanupElapsedTimer,
  }
}
