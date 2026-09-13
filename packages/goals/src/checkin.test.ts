import { describe, expect, it } from 'vitest'
import {
  weeklyMetrics,
  suggestTargets,
  type CheckinDay,
  type SafetyProfile,
  type AdaptiveTarget,
  DAY_COMPLETION_STATUSES,
  isValidDayCompletion,
  normalizeDayCompletion,
} from './index.js'

describe('Day Status Completion Types & Normalization', () => {
  it('recognizes valid day completion statuses', () => {
    for (const status of DAY_COMPLETION_STATUSES) {
      expect(isValidDayCompletion(status)).toBe(true)
      expect(normalizeDayCompletion(status)).toBe(status)
      expect(normalizeDayCompletion(` ${status.toUpperCase()} `)).toBe(status)
    }
  })

  it('rejects invalid day completion statuses', () => {
    expect(isValidDayCompletion('invalid')).toBe(false)
    expect(isValidDayCompletion(123)).toBe(false)
    expect(isValidDayCompletion(null)).toBe(false)
    expect(() => normalizeDayCompletion('invalid')).toThrow(/Invalid day completion status/)
  })
})

describe('ADP-001 Day Status Rules and Analytics Exclusions', () => {
  const baseDay = (date: string, overrides: Partial<CheckinDay> = {}): CheckinDay => ({
    date,
    status: 'complete',
    kcal: 2000,
    protein_g: 150,
    protein_target: 140,
    weight_kg: 80,
    completed_workouts: 1,
    pending: false,
    ...overrides,
  })

  it('excludes partial and unknown days from calorie-average denominator', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { status: 'complete', kcal: 2000 }),
      baseDay('2026-03-02', { status: 'complete', kcal: 2200 }),
      baseDay('2026-03-03', { status: 'complete', kcal: 1800 }),
      baseDay('2026-03-04', { status: 'partial', kcal: 600 }), // partial: should be excluded
      baseDay('2026-03-05', { status: 'unknown', kcal: null }), // unknown: should be excluded
      baseDay('2026-03-06', { status: 'complete', kcal: 2000 }),
      baseDay('2026-03-07', { status: 'fasting', kcal: 0 }), // fasting: counts as intentional 0 kcal
    ]

    const metrics = weeklyMetrics(days)

    // Included days: 03-01 (2000), 03-02 (2200), 03-03 (1800), 03-06 (2000), 03-07 (0)
    // Sum = 8000, Count = 5 -> Average = 1600
    expect(metrics.included_dates).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-06',
      '2026-03-07',
    ])
    expect(metrics.average_kcal).toBe(1600)

    // Excluded dates must record exact reasons
    expect(metrics.excluded_dates).toEqual([
      { date: '2026-03-04', reason: 'partial' },
      { date: '2026-03-05', reason: 'unknown' },
    ])

    // Fasting dates must be tracked separately as intentional
    expect(metrics.fasting_dates).toEqual(['2026-03-07'])
  })

  it('treats pending analysis days as excluded even if status is complete', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { status: 'complete', kcal: 2000, pending: true }),
      baseDay('2026-03-02', { status: 'complete', kcal: 2000, pending: false }),
    ]

    const metrics = weeklyMetrics(days)
    expect(metrics.included_dates).toEqual(['2026-03-02'])
    expect(metrics.excluded_dates).toEqual([
      { date: '2026-03-01', reason: 'Analysis pending' },
    ])
    expect(metrics.average_kcal).toBe(2000)
  })

  it('marks days with null kcal on complete/fasting as Nutrition unavailable', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { status: 'complete', kcal: null }),
      baseDay('2026-03-02', { status: 'fasting', kcal: null }),
    ]

    const metrics = weeklyMetrics(days)
    expect(metrics.included_dates).toHaveLength(0)
    expect(metrics.average_kcal).toBeNull()
    expect(metrics.excluded_dates).toEqual([
      { date: '2026-03-01', reason: 'Nutrition unavailable' },
      { date: '2026-03-02', reason: 'Nutrition unavailable' },
    ])
  })

  it('throws on duplicate check-in dates to preserve data integrity', () => {
    const days: CheckinDay[] = [
      baseDay('2026-03-01'),
      baseDay('2026-03-01'),
    ]
    expect(() => weeklyMetrics(days)).toThrow('Duplicate check-in dates')
  })

  it('enforces exercise calories are not auto-added into adaptive target suggestions', () => {
    // 8 days of complete data spanning 7 full day intervals, 4 workouts
    const days: CheckinDay[] = [
      baseDay('2026-03-01', { date: '2026-03-01', kcal: 2400, weight_kg: 80.0, completed_workouts: 1 }),
      baseDay('2026-03-02', { date: '2026-03-02', kcal: 2400, weight_kg: 79.9, completed_workouts: 0 }),
      baseDay('2026-03-03', { date: '2026-03-03', kcal: 2400, weight_kg: 79.8, completed_workouts: 1 }),
      baseDay('2026-03-04', { date: '2026-03-04', kcal: 2400, weight_kg: 79.8, completed_workouts: 0 }),
      baseDay('2026-03-05', { date: '2026-03-05', kcal: 2400, weight_kg: 79.7, completed_workouts: 1 }),
      baseDay('2026-03-06', { date: '2026-03-06', kcal: 2400, weight_kg: 79.6, completed_workouts: 0 }),
      baseDay('2026-03-07', { date: '2026-03-07', kcal: 2400, weight_kg: 79.5, completed_workouts: 1 }),
      baseDay('2026-03-08', { date: '2026-03-08', kcal: 2400, weight_kg: 79.4, completed_workouts: 0 }),
    ]

    const metricsWithWorkouts = weeklyMetrics(days.slice(-7), days)
    expect(metricsWithWorkouts.completed_workouts).toBe(3)
    expect(metricsWithWorkouts.weight_span_days).toBe(7)
    expect(metricsWithWorkouts.weight_change_kg_week).not.toBeNull()

    const daysNoWorkouts = days.map((d) => ({ ...d, completed_workouts: 0 }))
    const metricsNoWorkouts = weeklyMetrics(daysNoWorkouts.slice(-7), daysNoWorkouts)
    expect(metricsNoWorkouts.completed_workouts).toBe(0)

    const safety: SafetyProfile = {
      reviewed: true,
      age: 30,
      pregnant: false,
      lactating: false,
      eating_disorder_risk: false,
      sex: 'male',
      bmr: 1750,
      weight_kg: 80,
      height_cm: 180,
    }

    const currentTarget: AdaptiveTarget = {
      kcal: 2000,
      protein_g: 160,
      fat_g: 60,
      carbs_g: 205,
    }

    const locks = { kcal: false, protein: false, fat: false, carbs: false }

    const suggestion1 = suggestTargets(metricsWithWorkouts, currentTarget, safety, -0.4, locks)
    const suggestion2 = suggestTargets(metricsNoWorkouts, currentTarget, safety, -0.4, locks)

    // Suggestion math must be IDENTICAL regardless of workouts logged: exercise kcal are never added back!
    expect(suggestion1).not.toBeNull()
    expect(suggestion2).not.toBeNull()
    expect(suggestion1!.proposed.kcal).toBe(suggestion2!.proposed.kcal)
    expect(suggestion1!.delta_kcal).toBe(suggestion2!.delta_kcal)
    expect(suggestion1!.reason).toContain('Exercise calories stay separate')
  })
})
