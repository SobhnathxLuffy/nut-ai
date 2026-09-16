export interface ChartPoint {
  x: number
  y: number
  id?: string | number
}

/**
 * Prepare arbitrary stored values for charting without allowing invalid numbers
 * into SVG. Duplicate x values keep the last finite observation because a later
 * edit is the best available value at that timestamp.
 */
export function normalizeChartPoints(
  points: ReadonlyArray<{ x: number | null | undefined; y: number | null | undefined; id?: string | number }>,
  maxPoints = 400,
): ChartPoint[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) throw new Error('maxPoints must be an integer of at least 2')
  const byX = new Map<number, ChartPoint>()
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    byX.set(point.x!, point.id === undefined
      ? { x: point.x!, y: point.y! }
      : { x: point.x!, y: point.y!, id: point.id })
  }
  const sorted = [...byX.values()].sort((a, b) => a.x - b.x)
  if (sorted.length <= maxPoints) return sorted

  // Preserve both endpoints and evenly sample the interior. This is deliberately
  // deterministic; a richer downsampler can replace it if profiling warrants it.
  const sampled: ChartPoint[] = []
  for (let index = 0; index < maxPoints; index++) {
    sampled.push(sorted[Math.round(index * (sorted.length - 1) / (maxPoints - 1))]!)
  }
  return sampled
}

export function chartExtent(points: readonly ChartPoint[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} | null {
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const rawMinX = Math.min(...xs)
  const rawMaxX = Math.max(...xs)
  const rawMinY = Math.min(...ys)
  const rawMaxY = Math.max(...ys)
  const xPadding = rawMaxX === rawMinX ? 1 : 0
  const yPadding = rawMaxY === rawMinY ? Math.max(Math.abs(rawMinY) * 0.05, 1) : 0
  return {
    minX: rawMinX - xPadding,
    maxX: rawMaxX + xPadding,
    minY: rawMinY - yPadding,
    maxY: rawMaxY + yPadding,
  }
}
