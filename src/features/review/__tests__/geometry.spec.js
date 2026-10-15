import { describe, expect, it } from 'vitest'
import {
  buildSuspiciousCharacterBoxes,
  hasValidBox,
  hasValidPolygon,
  normalizeCharPositions,
  polygonPointsString,
  shouldRenderPolygon,
} from '../geometry'

const bbox = { x_min: 10, y_min: 20, x_max: 210, y_max: 40 }
const polygon = [[10, 20], [210, 20], [210, 40]]
const suspicious = (line) => line.flags.map((flag) => ({ suspicious: flag }))
const line = (char_positions, flags = [true, true]) => ({
  id: 'line-1', bounding_box: { ...bbox }, char_positions, flags,
})

describe('review overlay geometry', () => {
  it('normalizes model coordinates against the observed span instead of the full domain', () => {
    const input = line([{ start: 20, end: 40, domain: 100 }, { start: 60, end: 80, domain: 100 }])
    const snapshot = structuredClone(input)
    const boxes = buildSuspiciousCharacterBoxes([input], suspicious)
    expect(boxes[0]).toMatchObject({ id: 'line-1-0', lineId: 'line-1', x: 10, y: 20, height: 20 })
    expect(boxes[0].width).toBeCloseTo(200 / 3)
    expect(boxes[1].x).toBeCloseTo(10 + 400 / 3)
    expect(boxes[1].width).toBeCloseTo(200 / 3)
    expect(input).toEqual(snapshot)
  })

  it('preserves reversed spans, alternate coordinate fields, and JSON metadata', () => {
    const input = line(JSON.stringify([
      { global_start_ext: '40', global_end_ext: '20' },
      { local_start: 60, local_end: 80 },
    ]))
    const boxes = buildSuspiciousCharacterBoxes([input], suspicious)
    expect(boxes[0].x).toBe(10)
    expect(boxes[0].width).toBeCloseTo(200 / 3)
    expect(boxes[1].x).toBeCloseTo(10 + 400 / 3)
  })

  it('widens tiny suspicious spans without crossing neighboring character midpoints', () => {
    const input = line([
      { start: 0, end: 49 }, { start: 49.9, end: 50.1 }, { start: 51, end: 100 },
    ], [false, true, false])
    const [box] = buildSuspiciousCharacterBoxes([input], suspicious)
    expect(box.x).toBeCloseTo(108.9)
    expect(box.width).toBeCloseTo(2.2)
    expect(box.id).toBe('line-1-1')
  })

  it('uses even placement when geometric mode is disabled or spans are unusable', () => {
    const geometric = line([{ start: 0, end: 10 }, { start: 10, end: 100 }], [false, true])
    const degenerate = line([{ start: 10, end: 10 }, {}], [false, true])
    const expected = [{ id: 'line-1-1', lineId: 'line-1', x: 110, y: 20, width: 100, height: 20 }]
    expect(buildSuspiciousCharacterBoxes([geometric], suspicious, { usePolygonOverlay: false })).toEqual(expected)
    expect(buildSuspiciousCharacterBoxes([degenerate], suspicious)).toEqual(expected)
  })

  it('limits markers to available positions and skips invalid or empty geometry', () => {
    const valid = line([{}], [false, true])
    const invalid = { ...line([{}]), bounding_box: { ...bbox, x_max: NaN } }
    const zeroWidth = { ...line([{}]), bounding_box: { ...bbox, x_max: bbox.x_min } }
    const negativeHeight = { ...line([{}]), bounding_box: { ...bbox, y_max: 0 } }
    expect(buildSuspiciousCharacterBoxes([valid, invalid, zeroWidth, negativeHeight, line('invalid'), line([])], suspicious)).toEqual([])
    expect(buildSuspiciousCharacterBoxes([line([{}], [true, true])], suspicious)).toHaveLength(1)
  })

  it('accepts array or JSON array metadata and rejects other representations', () => {
    const positions = [{ start: 1, end: 2 }]
    expect(normalizeCharPositions(positions)).toBe(positions)
    expect(normalizeCharPositions(JSON.stringify(positions))).toEqual(positions)
    for (const raw of [null, undefined, '', '{}', '{', 12]) {
      expect(normalizeCharPositions(raw)).toEqual([])
    }
  })

  it('uses polygons as a fallback when no valid box exists, even with the toggle off', () => {
    expect(hasValidBox(bbox)).toBe(true)
    expect(hasValidBox({ ...bbox, x_min: '10' })).toBe(false)
    expect(hasValidPolygon(polygon)).toBe(true)
    expect(hasValidPolygon([[0, 0], [1, 1]])).toBe(false)
    expect(hasValidPolygon([[0, 0], [1, 1], [NaN, 2]])).toBe(false)
    expect(shouldRenderPolygon({ bounding_box: bbox, polygon_points: polygon }, false)).toBe(false)
    expect(shouldRenderPolygon({ bounding_box: null, polygon_points: polygon }, false)).toBe(true)
    expect(shouldRenderPolygon({ bounding_box: bbox, polygon_points: polygon }, true)).toBe(true)
    expect(polygonPointsString(polygon, 0.5, 2)).toBe('5,40 105,40 105,80')
  })
})
