import { computed } from 'vue'

export function useSuspiciousAnalysis(selectedPageLines, suspiciousThreshold, options = {}) {
  const enabled = options.enabled

  function normalizeConfidence(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return null
    }

    // Some OCR payloads expose probabilities in 0..100 instead of 0..1.
    if (numeric > 1 && numeric <= 100) {
      return numeric / 100
    }

    return numeric
  }

  function lineDisplayText(line) {
    // Keep suspicious indexing aligned to model outputs (char_confidence / char_positions),
    // which are tied to OCR text, not post-edit corrected text.
    return line.ocr_text || line.corrected_text || ''
  }

  function parseCharConfidence(line) {
    const raw = line?.char_confidence
    if (!raw) {
      return null
    }

    if (Array.isArray(raw)) {
      const cleaned = raw.map((v) => normalizeConfidence(v)).filter((v) => v != null)
      return cleaned.length ? cleaned : null
    }

    if (typeof raw !== 'string') {
      return null
    }

    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map((v) => normalizeConfidence(v)).filter((v) => v != null)
        return cleaned.length ? cleaned : null
      }
    } catch (_err) {
      // fall through to delimited parsing
    }

    const delimited = raw
      .split(/[\s,;]+/)
      .map((token) => normalizeConfidence(Number.parseFloat(token)))
      .filter((v) => v != null)

    return delimited.length ? delimited : null
  }

  function parseCharConfidenceFromPositions(line) {
    const raw = line?.char_positions
    if (!raw) {
      return null
    }

    let positions = raw
    if (typeof raw === 'string') {
      try {
        positions = JSON.parse(raw)
      } catch (_err) {
        return null
      }
    }

    if (!Array.isArray(positions)) {
      return null
    }

    const values = positions
      .map((pos) => normalizeConfidence(pos?.probability))
      .filter((v) => v != null)

    return values.length ? values : null
  }

  function isPotentiallyConfusableGlyph(ch) {
    return /[ſsfnriI1l|0OoB8cCe]/.test(ch)
  }

  function suspiciousSegments(line) {
    const text = lineDisplayText(line)
    const chars = [...text]
    if (!chars.length) {
      return []
    }

    const charConf = parseCharConfidence(line) || parseCharConfidenceFromPositions(line)
    const lineConfidence = normalizeConfidence(line?.line_confidence)
    const hasLineConfidence = Number.isFinite(lineConfidence)
    const lowLineConfidence = hasLineConfidence && lineConfidence < suspiciousThreshold.value

    return chars.map((ch, index) => {
      const conf = charConf && Number.isFinite(charConf[index]) ? charConf[index] : null
      const lowCharConfidence = conf != null && conf < suspiciousThreshold.value
      const fallbackSuspicious = conf == null && lowLineConfidence && isPotentiallyConfusableGlyph(ch)

      return {
        id: `${line.id}-${index}`,
        ch,
        suspicious: lowCharConfidence || fallbackSuspicious,
        confidenceLabel:
          conf != null
            ? `${Math.round(conf * 100)}%`
            : hasLineConfidence
              ? `line ${Math.round(lineConfidence * 100)}%`
              : 'no conf',
      }
    })
  }

  const suspiciousAnalysisByLineId = computed(() => {
    if (enabled && !enabled.value) {
      return new Map()
    }

    const map = new Map()
    for (const line of selectedPageLines.value) {
      const segments = suspiciousSegments(line)
      map.set(line.id, {
        segments,
        hasSuspicious: segments.some((segment) => segment.suspicious),
      })
    }
    return map
  })

  function suspiciousSegmentsForLine(line) {
    return suspiciousAnalysisByLineId.value.get(line.id)?.segments || []
  }

  function lineHasSuspiciousChars(line) {
    return Boolean(suspiciousAnalysisByLineId.value.get(line.id)?.hasSuspicious)
  }

  const suspiciousLineIds = computed(() => {
    const set = new Set()
    for (const line of selectedPageLines.value) {
      if (lineHasSuspiciousChars(line)) {
        set.add(line.id)
      }
    }
    return set
  })

  function isSuspiciousLine(line) {
    return suspiciousLineIds.value.has(line.id)
  }

  return {
    lineHasSuspiciousChars,
    suspiciousSegmentsForLine,
    isSuspiciousLine,
  }
}
