import { describe, expect, it } from 'vitest'
import { deriveRecords, nextProgression, type Performance } from './progression.js'
import { ProgressionRule } from '@nutai/core-schema'

describe('TRN-004: PR engine and progression', () => {
  it('derives PRs from sequential performances across categories', () => {
    const performances: Performance[] = [
      {
        id: 1,
        exercise_id: 1,
        workout_id: 101,
        at: 1000,
        local_date: '2026-09-01',
        tracking_type: 'weight_reps',
        kind: 'normal',
        load_kg: 80,
        reps: 5,
        duration_s: null,
        distance_m: null,
        assistance_kg: null,
        rir: 2,
        rpe: 8,
        tempo: null,
      },
      // Higher load
      {
        id: 2,
        exercise_id: 1,
        workout_id: 102,
        at: 2000,
        local_date: '2026-09-03',
        tracking_type: 'weight_reps',
        kind: 'normal',
        load_kg: 85,
        reps: 5,
        duration_s: null,
        distance_m: null,
        assistance_kg: null,
        rir: 1,
        rpe: 9,
        tempo: null,
      },
      // Higher reps at 80kg
      {
        id: 3,
        exercise_id: 1,
        workout_id: 103,
        at: 3000,
        local_date: '2026-09-05',
        tracking_type: 'weight_reps',
        kind: 'normal',
        load_kg: 80,
        reps: 8,
        duration_s: null,
        distance_m: null,
        assistance_kg: null,
        rir: 0,
        rpe: 10,
        tempo: null,
      },
      // Warmup set must NOT count towards PRs
      {
        id: 4,
        exercise_id: 1,
        workout_id: 104,
        at: 4000,
        local_date: '2026-09-07',
        tracking_type: 'weight_reps',
        kind: 'warmup',
        load_kg: 100,
        reps: 10,
        duration_s: null,
        distance_m: null,
        assistance_kg: null,
        rir: null,
        rpe: null,
        tempo: null,
      },
    ]

    const prs = deriveRecords(performances)
    expect(prs.length).toBeGreaterThan(0)

    // Check heaviest load progression
    const heaviestPRs = prs.filter((p) => p.kind === 'heaviest load')
    expect(heaviestPRs).toHaveLength(2)
    expect(heaviestPRs[0]?.value).toBe(80)
    expect(heaviestPRs[1]?.value).toBe(85)

    // Check estimated 1RM (Epley formula)
    // 80kg x 5 reps = 80 * (1 + 5/30) = 93.33 kg
    // 85kg x 5 reps = 85 * (1 + 5/30) = 99.17 kg
    // 80kg x 8 reps = 80 * (1 + 8/30) = 101.33 kg
    const e1rmPRs = prs.filter((p) => p.kind === 'estimated 1RM')
    expect(e1rmPRs).toHaveLength(3)
    expect(e1rmPRs[0]?.value).toBeCloseTo(93.33, 1)
    expect(e1rmPRs[1]?.value).toBeCloseTo(99.17, 1)
    expect(e1rmPRs[2]?.value).toBeCloseTo(101.33, 1)

    // Confirm warmup set 4 did not trigger a 100kg PR
    expect(prs.some((p) => p.value === 100)).toBe(false)
  })

  it('derives duration and distance PRs for cardio exercises', () => {
    const cardio: Performance[] = [
      {
        id: 1,
        exercise_id: 2,
        workout_id: 201,
        at: 1000,
        local_date: '2026-09-01',
        tracking_type: 'distance_time',
        kind: 'normal',
        load_kg: null,
        reps: null,
        duration_s: 1800, // 30 min
        distance_m: 5000, // 5k
        assistance_kg: null,
        rir: null,
        rpe: null,
        tempo: null,
      },
      {
        id: 2,
        exercise_id: 2,
        workout_id: 202,
        at: 2000,
        local_date: '2026-09-03',
        tracking_type: 'distance_time',
        kind: 'normal',
        load_kg: null,
        reps: null,
        duration_s: 3600, // 60 min
        distance_m: 10000, // 10k
        assistance_kg: null,
        rir: null,
        rpe: null,
        tempo: null,
      },
    ]

    const prs = deriveRecords(cardio)
    expect(prs.some((p) => p.kind === 'longest distance' && p.value === 10000)).toBe(true)
    expect(prs.some((p) => p.kind === 'longest duration' && p.value === 3600)).toBe(true)
  })

  it('computes double progression correctly', () => {
    const rule = ProgressionRule.parse({
      kind: 'double',
      increment: 2.5,
      min_reps: 8,
      max_reps: 12,
    })

    // If reps below max, suggest adding a rep
    const step1 = nextProgression({
      previous: { load_kg: 50, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: 2, rpe: 8, tempo: null },
      rule,
    })
    expect(step1.values.load_kg).toBe(50)
    expect(step1.values.reps).toBe(9)

    // When max reps (12) reached, increase load and reset to min_reps (8)
    const step2 = nextProgression({
      previous: { load_kg: 50, reps: 12, duration_s: null, distance_m: null, assistance_kg: null, rir: 2, rpe: 8, tempo: null },
      rule,
    })
    expect(step2.values.load_kg).toBe(52.5)
    expect(step2.values.reps).toBe(8)
  })

  it('respects equipment inventory plate limitations in progression', () => {
    const rule = ProgressionRule.parse({
      kind: 'fixed',
      increment: 2.5,
    })

    // Inventory has only 20kg bar and 10kg plates (cannot load 52.5 kg)
    const inventory = {
      bar: { weight_kg: 20, count: 1 },
      plates: [{ weight_kg: 10, count: 4 }],
    }

    const res = nextProgression({
      previous: { load_kg: 50, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
      rule,
      inventory,
    })

    // Cannot assemble 52.5kg with 10kg plates, so keeps load at 50kg and increments reps
    expect(res.values.load_kg).toBe(50)
    expect(res.values.reps).toBe(11)
    expect(res.explanation).toContain('cannot be assembled from your inventory')
  })
})
