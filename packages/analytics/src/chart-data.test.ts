import { describe, expect, it } from 'vitest'
import { chartExtent, normalizeChartPoints } from './chart-data.js'

describe('chart data', () => {
  it('rejects non-finite/null values, sorts, and keeps the last duplicate', () => {
    expect(normalizeChartPoints([
      { x: 2, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 3 },
      { x: Number.NaN, y: 4 }, { x: 4, y: Infinity }, { x: null, y: 2 },
    ])).toEqual([{ x: 1, y: 1 }, { x: 2, y: 3 }])
  })

  it('supports zero and one point without a zero-sized domain', () => {
    expect(chartExtent([])).toBeNull()
    expect(chartExtent([{ x: 4, y: 80 }])).toEqual({ minX: 3, maxX: 5, minY: 76, maxY: 84 })
  })

  it('deterministically samples hundreds of points and preserves endpoints', () => {
    const points = normalizeChartPoints(Array.from({ length: 1_000 }, (_, x) => ({ x, y: x % 13 })), 200)
    expect(points).toHaveLength(200)
    expect(points[0]?.x).toBe(0)
    expect(points.at(-1)?.x).toBe(999)
  })
})
