import { describe, expect, it } from 'vitest'
import {
  suggestTargets,
  weeklyMetrics,
  MAX_WEEKLY_KCAL_CHANGE,
  type CheckinDay,
  type SafetyProfile,
  type AdaptiveTarget,
} from './index.js'

describe('Adaptive Target Suggestions (ADP-004)', () => {
  const baseDay = (date: string, overrides: Partial<CheckinDay> = {}): CheckinDay => ({
    date,
    status: 'complete',
    kcal: 2200,
    protein_g: 150,
    protein_target: 140,
    weight_kg: 80.0,
    completed_workouts: 1,
    pending: false,
    ...overrides,
  })

  const standardSafety: SafetyProfile = {
    reviewed: true,
    age: 28,
    pregnant: false,
    lactating: false,
    eating_disorder_risk: false,
    sex: 'male',
    bmr: 1750,
    weight_kg: 80.0,
    height_cm: 180,
  }

  const currentTarget: AdaptiveTarget = {
    kcal: 2000,
    protein_g: 150,
    fat_g: 55,
    carbs_g: 225,
  }

  const unlocked = { kcal: false, protein: false, fat: false, carbs: false }

  function createWeek(weightStart: number, weightEnd: number, avgKcal = 2200): CheckinDay[] {
    const days: CheckinDay[] = []
    const step = (weightEnd - weightStart) / 7
    for (let i = 1; i <= 8; i++) {
      days.push(
        baseDay(`2026-03-0${i}`, {
          kcal: avgKcal,
          weight_kg: Number((weightStart + (i - 1) * step).toFixed(2)),
        }),
      )
    }
    return days
  }

  it('suggests a bounded calorie increase when losing weight faster than desired', () => {
    // Current target is 2000 kcal, eating 2400 kcal, but losing rapidly (-0.8 kg over 7 days)
    // Goal rate is modest loss: -0.2 kg/week
    const days = createWeek(80.0, 79.2, 2400)
    const metrics = weeklyMetrics(days.slice(-7), days)

    const suggestion = suggestTargets(metrics, currentTarget, standardSafety, -0.2, unlocked)

    expect(suggestion).not.toBeNull()
    expect(suggestion!.proposed.kcal).toBeGreaterThan(currentTarget.kcal)
    // Delta must not exceed MAX_WEEKLY_KCAL_CHANGE (150 kcal)
    expect(suggestion!.delta_kcal).toBeLessThanOrEqual(MAX_WEEKLY_KCAL_CHANGE)
    expect(suggestion!.delta_kcal).toBeGreaterThanOrEqual(25)
    expect(suggestion!.reason).toContain('EWMA trend')
  })

  it('suggests a bounded calorie decrease when weight is stalling in a deficit', () => {
    // Current target is 2200 kcal, eating 2200 kcal, but weight is flat (80.0 -> 80.0)
    // Goal rate is -0.4 kg/week loss
    const days = createWeek(80.0, 80.0, 2200)
    const metrics = weeklyMetrics(days.slice(-7), days)

    const suggestion = suggestTargets(metrics, { ...currentTarget, kcal: 2200 }, standardSafety, -0.4, unlocked)

    expect(suggestion).not.toBeNull()
    expect(suggestion!.proposed.kcal).toBeLessThan(2200)
    expect(Math.abs(suggestion!.delta_kcal)).toBeLessThanOrEqual(MAX_WEEKLY_KCAL_CHANGE)
  })

  it('returns null when calorie target is locked', () => {
    const days = createWeek(80.0, 79.2, 2400)
    const metrics = weeklyMetrics(days.slice(-7), days)

    const suggestion = suggestTargets(metrics, currentTarget, standardSafety, -0.2, {
      ...unlocked,
      kcal: true,
    })

    expect(suggestion).toBeNull()
  })

  it('preserves protein, fat, or carbs targets when individual macros are locked', () => {
    const days = createWeek(80.0, 79.2, 2400)
    const metrics = weeklyMetrics(days.slice(-7), days)

    const lockedProteinTarget: AdaptiveTarget = {
      kcal: 2000,
      protein_g: 180, // User specifically set 180g protein
      fat_g: 55,
      carbs_g: 195,
    }

    const suggestion = suggestTargets(metrics, lockedProteinTarget, standardSafety, -0.2, {
      ...unlocked,
      protein: true,
    })

    expect(suggestion).not.toBeNull()
    // Protein must remain exactly what the user locked
    expect(suggestion!.proposed.protein_g).toBe(180)
    // Calories adjusted
    expect(suggestion!.proposed.kcal).not.toBe(2000)
  })

  it('rejects suggestions when data is insufficient (<5 complete days, <3 weigh-ins, <7 day span)', () => {
    // Case 1: Only 4 complete days
    const fourDays = createWeek(80.0, 79.5).slice(0, 4)
    const metricsFewDays = weeklyMetrics(fourDays)
    expect(suggestTargets(metricsFewDays, currentTarget, standardSafety, -0.3, unlocked)).toBeNull()

    // Case 2: Only 2 weigh-ins
    const daysFewWeights = createWeek(80.0, 79.5).map((d, idx) => ({
      ...d,
      weight_kg: idx < 2 ? d.weight_kg : null,
    }))
    const metricsFewWeights = weeklyMetrics(daysFewWeights.slice(-7), daysFewWeights)
    expect(suggestTargets(metricsFewWeights, currentTarget, standardSafety, -0.3, unlocked)).toBeNull()
  })

  it('returns moderate confidence for a full 7-day week and limited confidence for 5-6 days', () => {
    const eightDays = createWeek(80.0, 79.2, 2400)
    const sevenDayMetrics = weeklyMetrics(eightDays.slice(-7), eightDays)
    const sug7 = suggestTargets(sevenDayMetrics, currentTarget, standardSafety, -0.2, unlocked)
    expect(sug7?.confidence).toBe('moderate')

    // 5 included days (2 days marked partial)
    const fiveDays = eightDays.slice(0, 8).map((d, idx) => ({
      ...d,
      status: (idx === 2 || idx === 3 ? 'partial' : 'complete') as CheckinDay['status'],
    }))
    const fiveDayMetrics = weeklyMetrics(fiveDays.slice(-7), fiveDays)
    const sug5 = suggestTargets(fiveDayMetrics, currentTarget, standardSafety, -0.2, unlocked)
    expect(sug5?.confidence).toBe('limited')
  })
})
