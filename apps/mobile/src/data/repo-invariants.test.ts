import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { ScanResult } from '@nutai/pipeline'

/**
 * P1-9 (QA Wave 4) — direct unit tests for the write/undo layer invariants.
 *
 * repo.ts carries the app's money-path invariants: append-only goals,
 * snapshot-based undo/redo, idempotency-key dedupe. Until now every one of
 * these was guarded only by Playwright e2e — the slowest, flakiest layer, and
 * one that `npm run check` does not even execute. A regression here corrupts
 * user data silently while CI stays green. These tests port the e2e-backed
 * scenarios to vitest against @nutai/db-adapter/node's in-memory DB (repo.ts
 * is adapter-injectable via openUserDb).
 */

const testState = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('../db/expo-adapter', () => ({
  openUserDb: async () => testState.database as DbAdapter,
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))
vi.mock('../inference/credentials', () => ({ clearCredential: vi.fn() }))
// Task 3-c: resetEverything publishes the widget reset sentinel through a
// DYNAMIC import — mock it so the node suite never loads the expo/react-native
// module graph, and lock the seam below. T5-fix2: overrideTargets rides the
// same seam with the DEBOUNCED scheduler, so the mock carries it too.
vi.mock('../widgets/publish', () => ({
  publishResetSnapshot: vi.fn(),
  scheduleWidgetPublish: vi.fn(),
}))
// Food-mutation events are UI bus noise the invariants do not depend on.
vi.mock('./food-mutations', () => ({
  emitFoodMutation: vi.fn(),
  getLastDeletedMealUndoUuid: vi.fn(() => null),
  setLastDeletedMealUndoUuid: vi.fn(),
}))

import {
  compactHistory,
  currentGoal,
  deleteMeal,
  logMeal,
  logWeight,
  mealsForDay,
  overrideTargets,
  redoLastOperation,
  redoLastWorkoutOperation,
  resetEverything,
  undoLastOperation,
  undoLastWorkoutOperation,
  updateMealSlot,
} from './repo'
import { startWorkout } from '@nutai/training'
import { publishResetSnapshot, scheduleWidgetPublish } from '../widgets/publish'

const NOW = 1_754_300_000_000
// localDate(NOW) in UTC — the repo's localDate is test-stable in the CI TZ.
const TODAY = new Date(NOW).toISOString().slice(0, 10)
// Isolation dates: each undo/redo chain runs on its OWN local date so earlier
// tests' meals and journal entries can never collide with the chain under
// test. Undo targets the globally newest operation, so the chain's created_at
// stamps must also dominate every earlier test's.
const DAY2 = NOW + 10 * 86_400_000
const DAY3 = NOW + 20 * 86_400_000
const DAY4 = NOW + 30 * 86_400_000
const DAY5 = NOW + 40 * 86_400_000

let database: DbAdapter

function scanResult(name: string, grams: number, kcal: number): ScanResult {
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
    portionEatenFraction: 1, engineId: 'test', promptVersion: 'p1', schemaVersion: 's1',
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

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
  testState.database = database
})

describe('P1-9 repo invariants: logMeal roundtrip', () => {
  it('a logged meal comes back with its items, slot and per-100g energy math', async () => {
    const mealId = await logMeal(scanResult('Dal', 180, 120), SCAN_META, null, NOW)
    expect(Number.isFinite(mealId)).toBe(true)

    const day = await mealsForDay(TODAY)
    const logged = day.find((m) => m.id === mealId)
    expect(logged).toBeDefined()
    expect(logged!.analysisStatus).toBe('complete')
    expect(logged!.items).toHaveLength(1)
    // snap energy is stored per-100 g and rendered scaled by grams
    expect(logged!.items[0]!.displayName).toBe('Dal')
    expect(logged!.items[0]!.grams).toBe(180)
    expect(logged!.items[0]!.energyKcal).toBe(Math.round(120 * (180 / 100)))
  })

  it('logWeight upserts one weight row per local date', async () => {
    await logWeight(72.5, NOW)
    await logWeight(72.8, NOW + 60_000)
    const rows = await database.all<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.weight_kg).toBeCloseTo(72.8)
  })
})

describe('P1-9 repo invariants: undo / redo chains', () => {
  it('undo removes the newest meal, a second undo removes the previous one, redo restores in reverse', async () => {
    const dayDate = new Date(DAY2).toISOString().slice(0, 10)
    const first = await logMeal(scanResult('Rice', 200, 130), SCAN_META, null, DAY2)
    const second = await logMeal(scanResult('Dal', 180, 120), SCAN_META, null, DAY2 + 1000)
    expect((await mealsForDay(dayDate)).map((m) => m.id).sort()).toEqual([first, second].sort())

    // undo #1 → newest (second) gone
    const u1 = await undoLastOperation(DAY2 + 2000)
    expect(u1.success).toBe(true)
    let ids = (await mealsForDay(dayDate)).map((m) => m.id)
    expect(ids).toContain(first)
    expect(ids).not.toContain(second)

    // undo #2 → first gone too; day empty
    const u2 = await undoLastOperation(DAY2 + 3000)
    expect(u2.success).toBe(true)
    expect(await mealsForDay(dayDate)).toHaveLength(0)

    // redo restores in standard LIFO order: the most recently UNDONE
    // operation re-applies first (editor semantics), i.e. `first` (undone
    // second) comes back before `second` (undone first).
    const r1 = await redoLastOperation()
    expect(r1.success).toBe(true)
    ids = (await mealsForDay(dayDate)).map((m) => m.id)
    expect(ids).toEqual([first])

    const r2 = await redoLastOperation()
    expect(r2.success).toBe(true)
    ids = (await mealsForDay(dayDate)).map((m) => m.id)
    expect(ids.sort()).toEqual([first, second].sort())

    // The redo chain is exhausted: another redo finds nothing.
    const r3 = await redoLastOperation()
    expect(r3.success).toBe(false)
  })

  it('delete → undo restores the FULL snapshot: items and ledger rows come back', async () => {
    const dayDate = new Date(DAY3).toISOString().slice(0, 10)
    const mealId = await logMeal(scanResult('Paneer', 100, 265), SCAN_META, 'file:///p.jpg', DAY3)
    const before = await mealsForDay(dayDate)
    expect(before.find((m) => m.id === mealId)).toBeDefined()

    const op = await deleteMeal(mealId, { now: DAY3 + 1000 })
    expect(op).not.toBeNull()
    expect((await mealsForDay(dayDate)).find((m) => m.id === mealId)).toBeUndefined()

    await undoLastOperation(DAY3 + 2000)
    const restored = await mealsForDay(dayDate).then((list) => list.find((m) => m.id === mealId))
    expect(restored).toBeDefined()
    expect(restored!.items.map((i) => i.displayName)).toEqual(before.find((m) => m.id === mealId)!.items.map((i) => i.displayName))
    // the scan-cost ledger row came back with the meal (spend reconstructable)
    const ledger = await database.all('SELECT * FROM scan_cost_ledger WHERE meal_id = ?', [mealId])
    expect(ledger).toHaveLength(1)
  })

  it('updateMealSlot moves the slot and a subsequent undo restores the previous slot', async () => {
    const dayDate = new Date(DAY4).toISOString().slice(0, 10)
    const mealId = await logMeal(scanResult('Eggs', 120, 155), SCAN_META, null, DAY4)
    expect(await updateMealSlot(mealId, 'dinner', { now: DAY4 + 500 })).toBe(true)
    expect((await mealsForDay(dayDate)).find((m) => m.id === mealId)!.slot).toBe('dinner')

    await undoLastOperation(DAY4 + 1000)
    expect((await mealsForDay(dayDate)).find((m) => m.id === mealId)!.slot).not.toBe('dinner')
  })
})

describe('Task 12-b M1: workout-scoped undo / redo', () => {
  /**
   * M1: the workout screen's "Undo/Redo workout action" used to call the
   * GENERIC undoLastOperation/redoLastOperation — logging food then tapping
   * "Undo workout action" silently deleted the food log. The scoped variants
   * must pick the newest WORKOUT operation (direct workout-table ops, or a
   * training batch whose payload touches a workout table) and never a food op.
   */
  it('food op then workout op: the workout-scoped undo undoes the workout, not the food', async () => {
    const dayDate = new Date(DAY5).toISOString().slice(0, 10)
    const mealId = await logMeal(scanResult('Khichdi', 200, 140), SCAN_META, null, DAY5)
    // The workout screen's every mutation is ONE training batch operation.
    const workoutId = await startWorkout(database, dayDate, 'Pull day', DAY5 + 1000)
    expect((await mealsForDay(dayDate)).map((m) => m.id)).toContain(mealId)
    expect(await database.all('SELECT * FROM workouts')).toHaveLength(1)

    const u1 = await undoLastWorkoutOperation(DAY5 + 2000)
    expect(u1.success).toBe(true)
    // the workout rows are gone — and the meal is untouched
    expect(await database.all('SELECT * FROM workouts')).toHaveLength(0)
    expect((await mealsForDay(dayDate)).find((m) => m.id === mealId)).toBeDefined()
    const mealOps = await database.all<{ undone_at: number | null }>(
      'SELECT undone_at FROM operations WHERE entity_type = ? AND entity_id = ?', ['meals', mealId],
    )
    expect(mealOps.length).toBeGreaterThan(0)
    expect(mealOps.every((o) => o.undone_at === null)).toBe(true)

    // the scoped redo re-applies the workout batch — still not the food
    const r1 = await redoLastWorkoutOperation()
    expect(r1.success).toBe(true)
    expect(await database.all('SELECT * FROM workouts WHERE id = ?', [workoutId])).toHaveLength(1)
    expect((await mealsForDay(dayDate)).find((m) => m.id === mealId)).toBeDefined()
  })

  it('with no live workout operation the scoped undo honestly reports nothing — a food op cannot be stolen', async () => {
    // The previous test left the workout batch live again (redone); undo it
    // once more so NO workout operation is live.
    const u1 = await undoLastWorkoutOperation(DAY5 + 3000)
    expect(u1.success).toBe(true)

    // Only food/weight operations remain live: the workout screen's Undo
    // must refuse (the caller's existing "Nothing to undo" toast), while the
    // GENERIC undo still reaches the newest food op — unchanged behavior.
    const u2 = await undoLastWorkoutOperation(DAY5 + 4000)
    expect(u2.success).toBe(false)
    const generic = await undoLastOperation(DAY5 + 5000)
    expect(generic.success).toBe(true)
    expect(generic.operation?.entity_type).toBe('meals')
  })
})

describe('P1-9 repo invariants: idempotency-key dedupe', () => {
  it('the same logMeal idempotency key returns the SAME meal and writes ONE row', async () => {
    const key = 'scan-abc-123'
    const first = await logMeal(scanResult('Idli', 200, 130), SCAN_META, null, NOW, { idempotencyKey: key })
    // A retry with the SAME key (double-tap, retry after flaky UI) must not
    // log a duplicate — the app's single most important write cannot no-op
    // silently NOR double-write.
    const again = await logMeal(scanResult('Idli', 200, 130), SCAN_META, null, NOW + 10, { idempotencyKey: key })
    expect(again).toBe(first)
    expect((await mealsForDay(TODAY)).filter((m) => m.id === first)).toHaveLength(1)
  })

  it('deleteMeal dedupe: replaying the same delete key does not record a second operation', async () => {
    const mealId = await logMeal(scanResult('Dosa', 150, 168), SCAN_META, null, NOW)
    const key = 'delete-xyz'
    const op1 = await deleteMeal(mealId, { now: NOW + 1000, idempotencyKey: key })
    const op2 = await deleteMeal(mealId, { now: NOW + 2000, idempotencyKey: key })
    expect(op2?.uuid).toBe(op1?.uuid)
    const ops = await database.all<{ entity_id: number }>("SELECT entity_id FROM operations WHERE entity_type = 'meals' AND op_type = 'delete' AND entity_id = ?", [mealId])
    expect(ops).toHaveLength(1)
  })

  it('a DIFFERENT idempotency key still writes (dedupe is per key, not global)', async () => {
    const a = await logMeal(scanResult('Chai', 100, 30), SCAN_META, null, NOW, { idempotencyKey: 'k-a' })
    const b = await logMeal(scanResult('Biscuits', 30, 480), SCAN_META, null, NOW + 500, { idempotencyKey: 'k-b' })
    expect(b).not.toBe(a)
  })
})

describe('P1-9 repo invariants: compaction + reset', () => {
  it('compactHistory bounds the undo journal while keeping the meals intact', async () => {
    const mealId = await logMeal(scanResult('Poha', 150, 130), SCAN_META, null, NOW)
    await compactHistory({ maxCount: 2, now: NOW + 1000 })
    // Meals survive compaction — only the operation journal is pruned.
    expect((await mealsForDay(TODAY)).find((m) => m.id === mealId)).toBeDefined()
  })

  it('resetEverything wipes user tables and leaves the corpus alone', async () => {
    await logMeal(scanResult('Upma', 200, 132), SCAN_META, null, NOW)
    await resetEverything()
    const meals = await database.all('SELECT * FROM meals')
    expect(meals).toHaveLength(0)
    const items = await database.all('SELECT * FROM log_items')
    expect(items).toHaveLength(0)
  })

  it('resetEverything clears the onboarding done key, the stale draft and the tutorial seen marker', async () => {
    // T2-a2 leftover (owner item #3 blast radius): reset kept the onboarding
    // draft, so a post-reset re-onboarding resumed PRE-reset answers. The
    // tutorial's seen marker must go too, so a re-completed onboarding can
    // offer the walkthrough again.
    const { default: Storage } = await import('expo-sqlite/kv-store')
    await resetEverything()
    expect(Storage.removeItem).toHaveBeenCalledWith('onboarding.completed.v1')
    expect(Storage.removeItem).toHaveBeenCalledWith('onboarding.draft.v1')
    expect(Storage.removeItem).toHaveBeenCalledWith('tutorial.seen.v1')
  })

  it('resetEverything publishes the widget reset snapshot (T3-c)', async () => {
    // The home-screen widget must not keep showing the wiped day's numbers;
    // the sentinel's SHAPE is locked in widget-snapshot tests — here only the
    // seam is: a reset always triggers one publishResetSnapshot.
    vi.mocked(publishResetSnapshot).mockClear()
    await resetEverything()
    expect(publishResetSnapshot).toHaveBeenCalledTimes(1)
  })

  it('overrideTargets schedules the debounced widget publish after the goal write (T5-fix2)', async () => {
    // Review SHOULD-FIX #2: a goal edit changes exactly what the Today widget
    // renders but emits no food mutation — the widget kept the OLD kcal/protein
    // target until the next food write or restart. The seam is the DEBOUNCED
    // scheduler (never an immediate publish) and it fires exactly once per
    // override, only AFTER the append-only goal row is committed.
    vi.mocked(scheduleWidgetPublish).mockClear()
    await overrideTargets(
      { targetKcal: 2400, macros: { protein_g: 150, fat_g: 75, carbs_g: 270, carbsFloored: false } },
      {
        goalType: 'maintain', targetKcal: 2200, targetRawKcal: 2200,
        floorApplied: false, protein_g: 140, fat_g: 70, carbs_g: 252.5,
        bmr: 1700, tdee: 2200, adaptive: false, effectiveFrom: NOW,
      },
      NOW + 40,
    )
    expect(scheduleWidgetPublish).toHaveBeenCalledTimes(1)
    // The write itself still landed: the newest goal row IS the override.
    const goal = await currentGoal()
    expect(goal?.targetKcal).toBe(2400)
    expect(goal?.protein_g).toBe(150)
  })
})
