// Geometry stays in page coordinates until the overlay applies display scaling.
export function normalizeCharPositions(raw) {
  if (Array.isArray(raw)) {
    return raw
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_err) {
    return []
  }
}

function toFinite(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function buildGeometricCharacterBounds(positions, options = {}) {
  const spanDomain = options.spanDomain
  const minStart = options.minStart
  const positionSpan = options.positionSpan
  const hasUsableSpan = options.hasUsableSpan

  const bounds = new Map()
  for (let index = 0; index < positions.length; index += 1) {
    const pos = positions[index] || {}
    const start =
      toFinite(pos.start) ??
      toFinite(pos.global_start_ext) ??
      toFinite(pos.global_start) ??
      toFinite(pos.local_start)
    const end =
      toFinite(pos.end) ??
      toFinite(pos.global_end_ext) ??
      toFinite(pos.global_end) ??
      toFinite(pos.local_end)

    if (start == null || end == null) {
      continue
    }

    const lowRaw = Math.min(start, end)
    const highRaw = Math.max(start, end)

    let lowNorm = null
    let highNorm = null

    // Prefer observed span normalization to avoid residual line-level drift when
    // model coordinates do not start at 0 or do not end at domain.
    if (hasUsableSpan && minStart != null && positionSpan != null && positionSpan > 0) {
      lowNorm = (lowRaw - minStart) / positionSpan
      highNorm = (highRaw - minStart) / positionSpan
    } else if (spanDomain != null && spanDomain > 0) {
      lowNorm = lowRaw / spanDomain
      highNorm = highRaw / spanDomain
    }

    if (lowNorm == null || highNorm == null) {
      continue
    }

    const left = Math.max(0, Math.min(1, lowNorm))
    const right = Math.max(0, Math.min(1, highNorm))
    if (right <= left) {
      continue
    }

    bounds.set(index, { low: left, high: right })
  }

  return bounds
}

function widenedRangeWithinNeighbors(boundsMap, index, minWidthNorm) {
  const current = boundsMap.get(index)
  if (!current) {
    return null
  }

  let left = current.low
  let right = current.high
  if (right <= left || !Number.isFinite(minWidthNorm) || minWidthNorm <= 0) {
    return { left, right }
  }

  const width = right - left
  if (width >= minWidthNorm) {
    return { left, right }
  }

  const prev = boundsMap.get(index - 1)
  const next = boundsMap.get(index + 1)
  const leftLimit = prev ? (prev.high + left) / 2 : 0
  const rightLimit = next ? (right + next.low) / 2 : 1

  if (rightLimit <= leftLimit) {
    return { left, right }
  }

  const center = (left + right) / 2
  let targetLeft = center - minWidthNorm / 2
  let targetRight = center + minWidthNorm / 2

  targetLeft = Math.max(leftLimit, targetLeft)
  targetRight = Math.min(rightLimit, targetRight)

  if (targetRight - targetLeft < minWidthNorm) {
    const available = rightLimit - leftLimit
    if (available <= 0) {
      return { left, right }
    }
    if (available <= minWidthNorm) {
      targetLeft = leftLimit
      targetRight = rightLimit
    } else {
      targetLeft = Math.max(leftLimit, Math.min(targetLeft, rightLimit - minWidthNorm))
      targetRight = targetLeft + minWidthNorm
    }
  }

  left = Math.max(0, Math.min(1, targetLeft))
  right = Math.max(0, Math.min(1, targetRight))
  if (right <= left) {
    return { low: current.low, high: current.high }
  }
  return { left, right }
}

export function buildSuspiciousCharacterBoxes(lines, suspiciousSegmentsForLine, { usePolygonOverlay = true } = {}) {
  const rows = []
  for (const line of lines) {
    if (!hasValidBox(line.bounding_box)) {
      continue
    }

    const effectivePositions = normalizeCharPositions(line.char_positions)
    if (!effectivePositions.length) {
      continue
    }

    const segments = suspiciousSegmentsForLine(line)
    if (!segments.length) {
      continue
    }

    const lineWidth = line.bounding_box.x_max - line.bounding_box.x_min
    const lineHeight = line.bounding_box.y_max - line.bounding_box.y_min
    const useGeometricMode = usePolygonOverlay

    if (!Number.isFinite(lineWidth) || lineWidth <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0) {
      continue
    }

    const normalizedBounds = effectivePositions
      .map((pos) => {
        const start =
          toFinite(pos.start) ??
          toFinite(pos.global_start_ext) ??
          toFinite(pos.global_start) ??
          toFinite(pos.local_start)
        const end =
          toFinite(pos.end) ??
          toFinite(pos.global_end_ext) ??
          toFinite(pos.global_end) ??
          toFinite(pos.local_end)
        if (start == null || end == null) {
          return null
        }
        const low = Math.min(start, end)
        const high = Math.max(start, end)
        if (!Number.isFinite(low) || !Number.isFinite(high)) {
          return null
        }
        return { low, high }
      })
      .filter((entry) => entry != null)

    const minStart = normalizedBounds.length ? Math.min(...normalizedBounds.map((b) => b.low)) : null
    const maxEnd = normalizedBounds.length ? Math.max(...normalizedBounds.map((b) => b.high)) : null
    const positionSpan =
      minStart != null && maxEnd != null && maxEnd > minStart
        ? maxEnd - minStart
        : null
    const hasUsableSpan = positionSpan != null && positionSpan > 0

    const domainCandidates = effectivePositions
      .map((pos) => toFinite(pos.domain) ?? toFinite(pos.logits_length) ?? toFinite(pos.total_steps))
      .filter((v) => v != null && v > 0)
    const spanDomain = domainCandidates.length ? domainCandidates[0] : null
    const geometricBounds = buildGeometricCharacterBounds(effectivePositions, {
      spanDomain,
      minStart,
      positionSpan,
      hasUsableSpan,
    })
    const minCharBoxWidthNorm = Math.min(0.08, 12 / lineWidth)

    const count = Math.min(segments.length, effectivePositions.length)
    for (let segIndex = 0; segIndex < count; segIndex += 1) {
      const safePosIndex = segIndex

      const segmentSuspicious = Boolean(segments[segIndex]?.suspicious)
      if (!segmentSuspicious) {
        continue
      }

      let leftNorm = null
      let rightNorm = null

      if (useGeometricMode && geometricBounds.has(safePosIndex)) {
        const bound = geometricBounds.get(safePosIndex)
        leftNorm = bound.low
        rightNorm = bound.high
        const widened = widenedRangeWithinNeighbors(geometricBounds, safePosIndex, minCharBoxWidthNorm)
        if (widened) {
          leftNorm = widened.left
          rightNorm = widened.right
        }
      }

      // Fallback mode: distribute characters evenly across the line bbox.
      // This is used when geometric mode is off, or when position spans are
      // degenerate/unusable for geometric placement.
      if (leftNorm == null || rightNorm == null) {
        const countForLayout = Math.max(1, effectivePositions.length)
        leftNorm = safePosIndex / countForLayout
        rightNorm = (safePosIndex + 1) / countForLayout
      }

      rows.push({
        id: `${line.id}-${segIndex}`,
        lineId: line.id,
        x: line.bounding_box.x_min + leftNorm * lineWidth,
        y: line.bounding_box.y_min,
        width: (rightNorm - leftNorm) * lineWidth,
        height: lineHeight,
      })
    }
  }

  return rows
}

export function hasValidBox(bbox) {
  return (
    bbox &&
    Number.isFinite(bbox.x_min) &&
    Number.isFinite(bbox.y_min) &&
    Number.isFinite(bbox.x_max) &&
    Number.isFinite(bbox.y_max)
  )
}

export function hasValidPolygon(points) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
  )
}

export function shouldRenderPolygon(line, usePolygonOverlay) {
  if (usePolygonOverlay && hasValidPolygon(line.polygon_points)) {
    return true
  }
  return !hasValidBox(line.bounding_box) && hasValidPolygon(line.polygon_points)
}

export function polygonPointsString(points, scaleX, scaleY) {
  return points
    .map((pt) => `${pt[0] * scaleX},${pt[1] * scaleY}`)
    .join(' ')
}
