import { describe, expect, it } from 'vitest'
import { weeklyMetrics, type CheckinDay } from './index.js'

describe('Weekly Check-in Metrics Engine (ADP-003)', () => {
  const baseDay = (date: string, overrides: Partial<CheckinDay> = {}): CheckinDay => ({
    date,
    status: 'complete',
    kcal: 2000,
    protein_g: 150,
    protein_target: 140,
    weight_kg: 80.0,
    completed_workouts: 1,
    pending: false,
    ...overrides,
  })

  it('calculates exact arithmetic for seven complete days', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { kcal: 2100, protein_g: 160, weight_kg: 80.0, completed_workouts: 1 }),
      baseDay('2026-03-02', { kcal: 1900, protein_g: 140, weight_kg: 79.9, completed_workouts: 0 }),
      baseDay('2026-03-03', { kcal: 2000, protein_g: 150, weight_kg: 79.8, completed_workouts: 1 }),
      baseDay('2026-03-04', { kcal: 2200, protein_g: 170, weight_kg: 79.7, completed_workouts: 0 }),
      baseDay('2026-03-05', { kcal: 1800, protein_g: 130, weight_kg: 79.7, completed_workouts: 1 }),
      baseDay('2026-03-06', { kcal: 2050, protein_g: 155, weight_kg: 79.6, completed_workouts: 0 }),
      baseDay('2026-03-07', { kcal: 1950, protein_g: 145, weight_kg: 79.5, completed_workouts: 1 }),
    ]

    const metrics = weeklyMetrics(days)

    expect(metrics.included_dates).toHaveLength(7)
    expect(metrics.excluded_dates).toHaveLength(0)
    expect(metrics.fasting_dates).toHaveLength(0)

    // Average kcal: (2100+1900+2000+2200+1800+2050+1950)/7 = 14000/7 = 2000
    expect(metrics.average_kcal).toBe(2000)

    // Average protein: (160+140+150+170+130+155+145)/7 = 1050/7 = 150
    expect(metrics.average_protein_g).toBe(150)

    // Protein compliance: target is 140. Days with >= 140g: all 7 days except day 5 (130g) -> 6/7
    expect(metrics.protein_days).toBe(7)
    expect(metrics.protein_compliance).toBeCloseTo(6 / 7, 5)

    // Completed workouts: 1+0+1+0+1+0+1 = 4
    expect(metrics.completed_workouts).toBe(4)

    // Weigh-ins: 7 weigh-ins, span is 6 days (03-01 to 03-07)
    expect(metrics.weigh_in_count).toBe(7)
    expect(metrics.weight_span_days).toBe(6)
    // Span < 7 means slope is null (requires >= 7 day span)
    expect(metrics.weight_change_kg_week).toBeNull()
  })

  it('computes trend slope when weight data spans at least 7 days with at least 3 weigh-ins', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { weight_kg: 80.0 }),
      baseDay('2026-03-02', { weight_kg: 79.9 }),
      baseDay('2026-03-03', { weight_kg: 79.8 }),
      baseDay('2026-03-04', { weight_kg: 79.7 }),
      baseDay('2026-03-05', { weight_kg: 79.6 }),
      baseDay('2026-03-06', { weight_kg: 79.5 }),
      baseDay('2026-03-07', { weight_kg: 79.4 }),
      baseDay('2026-03-08', { weight_kg: 79.3 }),
    ]

    const metrics = weeklyMetrics(days.slice(-7), days)
    expect(metrics.weigh_in_count).toBe(8)
    expect(metrics.weight_span_days).toBe(7)
    expect(metrics.weight_change_kg_week).not.toBeNull()
    expect(metrics.weight_trend_kg).toBeLessThan(80.0)
  })

  it('returns null trend and slope when no weigh-ins are recorded', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { weight_kg: null }),
      baseDay('2026-03-02', { weight_kg: null }),
      baseDay('2026-03-03', { weight_kg: null }),
    ]

    const metrics = weeklyMetrics(days)
    expect(metrics.weigh_in_count).toBe(0)
    expect(metrics.weight_span_days).toBe(0)
    expect(metrics.weight_trend_kg).toBeNull()
    expect(metrics.weight_change_kg_week).toBeNull()
  })

  it('captures full evidence of excluded days and reasons', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { status: 'complete', kcal: 2000 }),
      baseDay('2026-03-02', { status: 'partial', kcal: 500 }),
      baseDay('2026-03-03', { status: 'unknown', kcal: null }),
      baseDay('2026-03-04', { status: 'complete', kcal: 2200, pending: true }),
      baseDay('2026-03-05', { status: 'complete', kcal: null }),
      baseDay('2026-03-06', { status: 'fasting', kcal: 0 }),
    ]

    const metrics = weeklyMetrics(days)
    expect(metrics.included_dates).toEqual(['2026-03-01', '2026-03-06'])
    expect(metrics.fasting_dates).toEqual(['2026-03-06'])
    expect(metrics.excluded_dates).toEqual([
      { date: '2026-03-02', reason: 'partial' },
      { date: '2026-03-03', reason: 'unknown' },
      { date: '2026-03-04', reason: 'Analysis pending' },
      { date: '2026-03-05', reason: 'Nutrition unavailable' },
    ])
  })

  it('handles empty day lists gracefully without throwing', () => {
    const metrics = weeklyMetrics([])
    expect(metrics.included_dates).toHaveLength(0)
    expect(metrics.excluded_dates).toHaveLength(0)
    expect(metrics.average_kcal).toBeNull()
    expect(metrics.average_protein_g).toBeNull()
    expect(metrics.protein_compliance).toBeNull()
    expect(metrics.completed_workouts).toBe(0)
    expect(metrics.weight_trend_kg).toBeNull()
    expect(metrics.weight_change_kg_week).toBeNull()
  })
})
