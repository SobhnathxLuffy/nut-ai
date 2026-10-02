import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { ScanResult } from '@nutai/pipeline'

/**
 * UI/UX report §8.2 (Wave 3) — the Home instrument's new reads, tested against
 * the real SQL layer (the repo-invariants.test.ts pattern: repo.ts is
 * adapter-injectable via a mocked ../db/expo-adapter, the in-memory node DB
 * stands in for user.db).
 *
 *   slotKcalForDay  — the per-slot kcal behind the hero ring's press-for-detail
 *                     expansion. Must agree with dayTotals to the calorie
 *                     (same WHERE clause, same portion arithmetic) or the ring
 *                     and the breakdown would disagree on the same day.
 *   currentGoal     — now exposes checkinAcceptedAt (adaptive_evidence_json's
 *                     accepted_at), the input the adaptive-target state
 *                     machine derives its "locked" state from.
 */

const testState = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('../db/expo-adapter', () => ({
  openUserDb: async () => testState.database as DbAdapter,
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))
vi.mock('../inference/credentials', () => ({ clearCredential: vi.fn() }))
vi.mock('./food-mutations', () => ({
  emitFoodMutation: vi.fn(),
  getLastDeletedMealUndoUuid: vi.fn(() => null),
  setLastDeletedMealUndoUuid: vi.fn(),
}))

import {
  currentGoal,
  dayTotals,
  logMeal,
  slotKcalForDay,
  updateMealSlot,
} from './repo'

const NOW = 1_754_300_000_000
// localDate(NOW) in UTC — the repo's localDate is test-stable in the CI TZ.
const TODAY = new Date(NOW).toISOString().slice(0, 10)

function scanResult(name: string, grams: number, kcal: number, eatenFraction = 1): ScanResult {
  const ingredient: IngredientRow = {
    id: `ingredient-${name}`,
    displayName: name,
    sourceFoodId: '42',
    grams,
    nutrientSnapshot: {
      kcal, protein_g: 7, fat_g: 3, carbs_g: 18,
      fiber_g: 5, sugar_g: 2, sodium_mg: 250,
    },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
  }
  const meal: LoggedMeal = {
    id: `meal-${name}`, loggedAt: new Date(NOW).toISOString(), ingredients: [ingredient],
    portionEatenFraction: eatenFraction, engineId: 'test', promptVersion: 'p1', schemaVersion: 's1',
    clampFlags: [],
  }
  return {
    isFood: true, refusalReason: null, meal,
    items: [{ row: ingredient, band: { halfPct: 0.2, tier: 'moderate', reasons: [] }, resolution: 'auto_accept', gramPathway: ingredient.gramPathway }],
    totals: { kcal: kcal * grams / 100, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
    mealBand: { halfPct: 0.2, tier: 'moderate', reasons: [] },
    questions: [], clampFlags: [], zeroHitCount: 0,
  }
}

const SCAN_META = { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500, costUsd: 0.0009 }

let database: DbAdapter

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
  testState.database = database
  // migrate() seeds NO goals row — stand one up the way onboarding would
  // (adaptive on, no check-in evidence) so currentGoal() has a row to read.
  await database.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive,
        uuid, created_at, updated_at, revision, deleted_at, sync_state)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,1,'base-goal',?,?,1,null,'local')`,
    [NOW, 'lose', 0.5, 2_400, 2_450, 150, 65, 270, 1_650, 2_400, NOW, NOW],
  )
})

describe('slotKcalForDay — the press-for-detail read (§8.2)', () => {
  it('groups the day’s kcal by slot with the same arithmetic dayTotals uses', async () => {
    // Both meals get EXPLICIT slots — slotFor(NOW) depends on the runner’s
    // timezone, and this test must not.
    const m1 = await logMeal(scanResult('Dal', 200, 150), SCAN_META, null, NOW)
    await updateMealSlot(m1, 'breakfast', { now: NOW + 30_000 })
    const m2 = await logMeal(scanResult('Roti', 100, 300), SCAN_META, null, NOW + 60_000)
    await updateMealSlot(m2, 'lunch', { now: NOW + 120_000 })

    const bySlot = await slotKcalForDay(TODAY)
    const total = await dayTotals(TODAY)

    // Portion arithmetic: Dal 200 g × 150 kcal/100 g = 300 kcal.
    expect(bySlot['breakfast']).toBe(300)
    expect(bySlot['lunch']).toBe(300)
    // The slots add up to exactly the day total the ring shows.
    const sum = Object.values(bySlot).reduce((acc, kcal) => acc + kcal, 0)
    expect(sum).toBeCloseTo(total.kcal, 6)
    expect(Object.keys(bySlot).every((slot) => slot === 'unslotted' || ['breakfast', 'lunch', 'dinner', 'snack'].includes(slot))).toBe(true)
  })

  it('applies portion_eaten_fraction identically to dayTotals', async () => {
    await logMeal(scanResult('HalfDal', 200, 150, 0.5), SCAN_META, null, NOW + 300_000)
    const bySlot = await slotKcalForDay(TODAY)
    const total = await dayTotals(TODAY)
    // 200 g × 150 kcal/100 g × 0.5 = 150 kcal — the slot view must never
    // disagree with the ring on a half-eaten meal.
    expect(Object.values(bySlot).reduce((a, b) => a + b, 0)).toBeCloseTo(total.kcal, 6)
  })

  it('an empty day reads as an empty record — no fabricated slots', async () => {
    const bySlot = await slotKcalForDay('2030-01-01')
    expect(Object.keys(bySlot)).toHaveLength(0)
  })

  it('a meal moved to a NULL slot surfaces as unslotted, not folded into another slot', async () => {
    const meal = await logMeal(scanResult('NullSlotDal', 100, 200), SCAN_META, null, NOW + 400_000)
    await database.run('UPDATE meals SET meal_slot = NULL WHERE id = ?', [meal])
    const bySlot = await slotKcalForDay(TODAY)
    expect(bySlot['unslotted']).toBeDefined()
  })
})

describe('currentGoal — checkinAcceptedAt (the locked-state input)', () => {
  it('is null for goals written without check-in evidence (onboarding)', async () => {
    // migrate() seeds a goals row; onboarding/persist writes rows without
    // adaptive_evidence_json. Whatever is in force now has no evidence.
    const goal = await currentGoal()
    expect(goal).not.toBeNull()
    expect(goal!.checkinAcceptedAt).toBeNull()
  })

  it('reads accepted_at from a check-written goal row', async () => {
    const g = await currentGoal()
    expect(g).not.toBeNull()
    const acceptedAt = NOW + 500_000
    await database.run(
      `INSERT INTO goals
         (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
          floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive,
          uuid, created_at, updated_at, revision, deleted_at, sync_state, adaptive_evidence_json)
       VALUES (?,?,?,?,?,0,?,?,?,?,?,1,'checkin-goal',?,?,1,null,'local',?)`,
      [
        acceptedAt, g!.goalType, 0.5, g!.targetKcal, g!.targetKcal,
        g!.protein_g, g!.fat_g, g!.carbs_g, g!.bmr, g!.tdee,
        acceptedAt, acceptedAt,
        JSON.stringify({ local_date: TODAY, accepted_at: acceptedAt, metrics: {}, suggestion: {} }),
      ],
    )
    const next = await currentGoal()
    expect(next!.checkinAcceptedAt).toBe(acceptedAt)
    expect(next!.adaptive).toBe(true)
  })
})
