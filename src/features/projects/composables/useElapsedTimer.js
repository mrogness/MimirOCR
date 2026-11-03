/**
 * @file Maintain reactive elapsed-time displays for an active or completed OCR run.
 */
import { computed } from 'vue'

/**
 * Derive an elapsed-time display from reactive run timestamps or a persisted duration.
 * @param {object} state - Start, end, current-time, and persisted-duration refs.
 * @returns {object} Computed display text and timer lifecycle helpers.
 */
export function useElapsedTimer({ processingStartMs, processingEndMs, processingNowMs, persistedElapsedSeconds }) {
  let elapsedTimer = null

  /**
   * Replace any previous interval, refresh the current timestamp immediately, and update it
   * every second.
   */
  function startElapsedTimer() {
    stopElapsedTimer()
    processingNowMs.value = Date.now()
    elapsedTimer = setInterval(() => {
      processingNowMs.value = Date.now()
    }, 1000)
  }

  /**
   * Clear the elapsed-time interval if one is active.
   */
  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  }

  /**
   * Convert milliseconds to MM:SS or HH:MM:SS, returning --:-- for a negative or nonfinite
   * duration.
   */
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

  /**
   * Release the interval when the owning workflow is torn down.
   */
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
