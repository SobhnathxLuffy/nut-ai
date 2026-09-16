export interface BodyWeightPoint {
  date: string
  weight_kg: number
  logged_at?: number
}

export interface BodyTrendPoint extends BodyWeightPoint {
  trend_kg: number
}

export interface BodyAggregation {
  points: BodyWeightPoint[]
  trend: BodyTrendPoint[]
  average_weight_kg: number | null
  start_weight_kg: number | null
  end_weight_kg: number | null
  change_kg: number | null
}

function validPoint(point: BodyWeightPoint): boolean {
  return Boolean(point.date) && Number.isFinite(point.weight_kg) && point.weight_kg > 0
}

/** Sort, reject invalid measurements, and keep the latest measurement per date. */
export function normalizeBodyWeightPoints(points: readonly BodyWeightPoint[]): BodyWeightPoint[] {
  const byDate = new Map<string, BodyWeightPoint>()
  for (const point of points) {
    if (!validPoint(point)) continue
    const existing = byDate.get(point.date)
    if (!existing || (point.logged_at ?? 0) >= (existing.logged_at ?? 0)) byDate.set(point.date, point)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function calculateMovingAverage(
  points: readonly BodyWeightPoint[],
  windowDays = 7,
): BodyTrendPoint[] {
  if (!Number.isFinite(windowDays) || windowDays <= 0) throw new Error('windowDays must be positive')
  const sorted = normalizeBodyWeightPoints(points)
  return sorted.map((current, index) => {
    const currentDay = Date.parse(`${current.date}T12:00:00Z`) / 86_400_000
    const values: number[] = []
    for (let i = index; i >= 0; i--) {
      const point = sorted[i]!
      const day = Date.parse(`${point.date}T12:00:00Z`) / 86_400_000
      if (currentDay - day >= windowDays) break
      values.push(point.weight_kg)
    }
    return {
      ...current,
      trend_kg: values.reduce((sum, value) => sum + value, 0) / values.length,
    }
  })
}

export function aggregateBodyWeight(points: readonly BodyWeightPoint[], movingAverageDays = 7): BodyAggregation {
  const normalized = normalizeBodyWeightPoints(points)
  const trend = calculateMovingAverage(normalized, movingAverageDays)
  const start = trend[0]?.trend_kg ?? null
  const end = trend.at(-1)?.trend_kg ?? null
  return {
    points: normalized,
    trend,
    average_weight_kg:
      normalized.length > 0
        ? normalized.reduce((sum, point) => sum + point.weight_kg, 0) / normalized.length
        : null,
    start_weight_kg: start,
    end_weight_kg: end,
    change_kg: start !== null && end !== null && normalized.length >= 2 ? end - start : null,
  }
}

export function calculateWeightChange(points: readonly BodyWeightPoint[]): number | null {
  return aggregateBodyWeight(points).change_kg
}
