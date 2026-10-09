import { ref } from 'vue'
import { useSuspiciousAnalysis } from '../useSuspiciousAnalysis'

describe('suspicious character analysis', () => {
  it.each([[0.95, 0.2], '[0.95, 0.2]', '95;20'])('reads confidence format %j', char_confidence => {
    const line = { id: 1, ocr_text: 'Æø', char_confidence }
    const analysis = useSuspiciousAnalysis(ref([line]), ref(0.8))
    expect(analysis.suspiciousSegmentsForLine(line).map(segment => segment.suspicious)).toEqual([false, true])
  })

  it('aligns confidence with OCR text, not a correction of different length', () => {
    const line = { id: 1, ocr_text: 'ſø', corrected_text: 'Changed completely', char_confidence: [0.5, 0.99] }
    const analysis = useSuspiciousAnalysis(ref([line]), ref(0.8))
    expect(analysis.suspiciousSegmentsForLine(line).map(segment => segment.ch)).toEqual(['ſ', 'ø'])
  })

  it('prefers positional probabilities and deduplicates candidate characters', () => {
    const line = {
      id: 1, ocr_text: 'ſ', char_confidence: [0.99],
      char_positions: JSON.stringify([{ char: 'ſ', probability: 60, candidates: [
        { char: 's', probability: 20 }, { char: 's', probability: 30 },
        { char: 'f', probability: 10 }, { char: '', probability: 99 },
      ] }]),
    }
    const analysis = useSuspiciousAnalysis(ref([line]), ref(0.8))
    const [segment] = analysis.suspiciousSegmentsForLine(line)
    expect(segment).toMatchObject({ confidence: 0.6, confidenceLabel: '60%', suspicious: true })
    expect(segment.candidates.map(({ ch, confidence }) => [ch, confidence])).toEqual([['s', 0.3], ['f', 0.1]])
  })

  it('recomputes on threshold changes and disables hints when requested', () => {
    const line = { id: 1, ocr_text: 's', char_confidence: [0.7] }
    const threshold = ref(0.8)
    const enabled = ref(true)
    const analysis = useSuspiciousAnalysis(ref([line]), threshold, { enabled })
    expect(analysis.isSuspiciousLine(line)).toBe(true)
    threshold.value = 0.7
    expect(analysis.isSuspiciousLine(line)).toBe(false)
    enabled.value = false
    expect(analysis.suspiciousSegmentsForLine(line)).toEqual([])
  })

  it('falls back to line confidence for confusable glyphs when metadata is malformed', () => {
    const line = { id: 1, ocr_text: 'sÆ', char_confidence: 'invalid', char_positions: '{broken', line_confidence: 0.5 }
    const analysis = useSuspiciousAnalysis(ref([line]), ref(0.8))
    const segments = analysis.suspiciousSegmentsForLine(line)
    expect(segments.map(segment => segment.suspicious)).toEqual([true, false])
    expect(segments[0].confidenceKind).toBe('line')
  })
})
