import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbAdapter } from '@nutai/db-adapter'
import { migrate } from '@nutai/db-adapter'

// The module under test reaches for expo singletons at import time — the unit
// suite runs on the node adapter and never touches them.
vi.mock('expo-sqlite/kv-store', () => ({
  default: { get: vi.fn(), getItem: vi.fn(), set: vi.fn(), setItem: vi.fn(), delete: vi.fn(), deleteItem: vi.fn(), deleteAsync: vi.fn() },
}))
vi.mock('../db/expo-adapter', () => ({ openUserDb: vi.fn() }))

import { persistOnboarding } from './persist'
import type { OnboardingAnswers } from './store'
import type { CalorieTarget, MacroTargets } from '@nutai/goals'

/**
 * P3-D5 (QA): first-run persistence had zero direct tests. It carries the
 * append-only goals invariant, the idempotent weight upsert, and the canonical
 * settings vocabulary the scan orchestrator reads — a silent regression here
 * would hit every new install. These run on the in-memory node adapter.
 */

const answers: OnboardingAnswers = {
  sex: 'male',
  workoutsPerWeek: '3-5',
  birthYear: 1990,
  birthMonth: 6,
  birthDay: 15,
  heightCm: 178,
  weightKg: 80,
  units: 'metric',
  worksWithProfessional: false,
  goal: 'lose',
  desiredWeightKg: 74,
  blocker: 'consistency',
  dietStyle: 'balanced',
  accomplish: 'energy',
  rolloverCalories: true,
  healthConnected: false,
  provider: 'none',
  providerModel: null,
}

const target: CalorieTarget = {
  target: 1900,
  targetRaw: 2000,
  floorApplied: true,
  bmr: 1700,
  tdee: 2300,
  dailyDelta: -400,
  floor: 1200,
  floorExplanation: 'Floor applied',
  warnings: [],
}
const macros: MacroTargets = { protein_g: 140, fat_g: 60, carbs_g: 190, carbsFloored: false }

async function freshDb(): Promise<DbAdapter> {
  const { openNodeDb } = await import('@nutai/db-adapter/node')
  const db = await openNodeDb(':memory:')
  await migrate(db, Date.now())
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('persistOnboarding', () => {
  it('writes the profile, one goal row, the weight entry and the canonical settings', async () => {
    const db = await freshDb()
    await persistOnboarding(answers, target, macros, db)

    const profile = await db.get<Record<string, unknown>>('SELECT * FROM user_profile WHERE id = 1')
    expect(profile?.['height_cm']).toBe(178)

    const goals = await db.all<Record<string, unknown>>('SELECT * FROM goals ORDER BY id')
    expect(goals).toHaveLength(1)
    expect(Number(goals[0]!['target_kcal'])).toBe(1900)
    expect(Number(goals[0]!['target_raw_kcal'])).toBe(2000)
    // "1,200 because we clamped it" is a different fact from "that is your maths".
    expect(Number(goals[0]!['floor_applied'])).toBe(1)

    const weights = await db.all<Record<string, unknown>>('SELECT * FROM weight_entries')
    expect(weights).toHaveLength(1)
    expect(Number(weights[0]!['weight_kg'])).toBe(80)

    const provider = await db.get<Record<string, unknown>>("SELECT value FROM settings WHERE key = 'provider'")
    expect(provider?.['value']).toBe('none')
  })

  it('appends a NEW goal row on re-onboarding — the goals table is never UPDATEd', async () => {
    const db = await freshDb()
    await persistOnboarding(answers, target, macros, db)
    await persistOnboarding(answers, { ...target, target: 1600, targetRaw: 1600, floorApplied: false }, macros, db)

    const goals = await db.all<Record<string, unknown>>('SELECT * FROM goals ORDER BY id')
    expect(goals).toHaveLength(2)
    expect(Number(goals[0]!['target_kcal'])).toBe(1900)
    expect(Number(goals[1]!['target_kcal'])).toBe(1600)
  })

  it('marks onboarding done and upserts (not duplicates) today\'s weight on re-run', async () => {
    const { default: Storage } = await import('expo-sqlite/kv-store')
    const db = await freshDb()
    await persistOnboarding(answers, target, macros, db)
    await persistOnboarding(answers, target, macros, db)

    expect(Storage.setItem).toHaveBeenCalledWith(expect.anything(), 'true')
    const weights = await db.all<Record<string, unknown>>('SELECT * FROM weight_entries')
    expect(weights).toHaveLength(1)
    // The operation log recorded both the insert and the update (undoable).
    const ops = await db.all<Record<string, unknown>>(
      "SELECT * FROM operations WHERE entity_type IN ('goals','weight_entries')",
    )
    expect(ops.length).toBeGreaterThanOrEqual(3)
  })
})
