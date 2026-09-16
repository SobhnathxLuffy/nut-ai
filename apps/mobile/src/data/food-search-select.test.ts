import { beforeEach, describe, expect, it } from 'vitest'
import { isValidUuid, migrate, NUTRITION_SCHEMA, listOperations, undoOperation, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { ScoredCandidate } from '@nutai/resolver'
import { resolveSelection } from './food-search-select'
import { logManualFood } from './manual-food'

/**
 * Regression coverage for "tap a candidate row in Food Database and nothing
 * happens" (bug tracker: 9016cdb8, 47c9cc17). Root cause was in
 * food-search.tsx: search results were rendered as a plain `View` with no
 * `onPress` at all — introduced that way in f95a17c when the screen moved
 * into the FAB sheet, never wired since. No tap could ever fire a selection.
 *
 * There is no React Native component-render harness in this repo (vitest
 * here runs under `environment: 'node'`, and `apps/mobile/app/**` is not
 * part of the test glob in vitest.config.ts — see that file). packages/* and
 * the app's data layer are pure-logic-testable by design; screens are not,
 * and none of the app's other 30+ screens have a component-render test
 * either. So this covers the exact logic the row's `onPress` now runs —
 * `resolveSelection` (reads the tapped candidate's grams + snapshot from the
 * nutrition corpus) and `logManualFood` (writes it to today's log) — against
 * real in-memory SQLite databases running the app's real schema. What is
 * NOT exercised here is the JSX wiring itself (that `onPress` is actually
 * attached to the row and calls `handleSelect`); `apps/mobile`'s
 * `npm run typecheck` passing confirms the wiring compiles, but a `.tsx`
 * render+press test would need new test infra (react-test-renderer or
 * @testing-library/react-native, plus mocks for expo-router/expo-sqlite/
 * safe-area-context) — flagged as an explicit gap rather than skipped
 * silently.
 */

const NOW = 1_754_200_000_000

let userDb: DbAdapter
let nutritionDb: DbAdapter

beforeEach(async () => {
  userDb = openMemoryDb()
  await userDb.exec('PRAGMA foreign_keys = ON;')
  await migrate(userDb, NOW)

  nutritionDb = openMemoryDb()
  await nutritionDb.exec(NUTRITION_SCHEMA)
  await nutritionDb.run(
    `INSERT INTO foods (id, source, source_id, name, energy_kcal, protein_g, fat_g, carb_g, fiber_g,
                        sugar_g, sodium_mg, completeness_score, license, updated_at)
     VALUES (1, 'fdc_sr_legacy', '173424', 'Egg, whole, raw, fresh', 143, 12.6, 9.5, 0.72, 0, 0.37, 142, 1, 'CC0', ?)`,
    [NOW],
  )
  await nutritionDb.run(
    `INSERT INTO food_portions (food_id, measure_unit, modifier, amount, gram_weight, is_fndds_default)
     VALUES (1, 'undetermined', 'large', 1, 50, 1)`,
  )
})

function candidateFor(foodId: string, name: string, energyKcal: number): ScoredCandidate {
  return {
    foodId,
    name,
    brand: null,
    category: null,
    prepFacet: null,
    basisConfidence: 'high',
    servingSizeG: null,
    energyKcal,
    popularityRank: null,
    completenessScore: 1,
    rawBm25: -1,
    score: 0.9,
    breakdown: {},
  }
}

describe('resolveSelection + logManualFood — what a tap on a Food Database row does', () => {
  it('fires a real selection: a tap logs the food to today, not nothing', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    const mealId = await logManualFood(userDb, selection, NOW)

    expect(mealId).toBeGreaterThan(0)
    const items = await userDb.all<{ matched_food_id: number; display_name: string; grams: number }>(
      'SELECT matched_food_id, display_name, grams FROM log_items WHERE meal_id = ?',
      [mealId],
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.matched_food_id).toBe(173424)
    expect(items[0]?.display_name).toBe('Egg, whole, raw, fresh')
    const identities = await userDb.all<{ uuid: string; created_at: number; updated_at: number }>(
      `SELECT uuid, created_at, updated_at FROM meals WHERE id = ?
       UNION ALL
       SELECT uuid, created_at, updated_at FROM log_items WHERE meal_id = ?`,
      [mealId, mealId],
    )
    expect(identities).toHaveLength(2)
    expect(identities.every((row) => isValidUuid(row.uuid))).toBe(true)
    expect(identities.every((row) => row.created_at === NOW && row.updated_at === NOW)).toBe(true)
  })

  it('uses the FNDDS default portion weight, not a hardcoded 100 g', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    expect(selection.grams).toBe(50) // the seeded is_fndds_default row, not the 100 g fallback
  })

  it('resolving a selected result does not write before review', async () => {
    await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    expect(await userDb.all('SELECT id FROM meals')).toHaveLength(0)
  })

  it('preserves an explicitly selected historical local date and meal slot', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg', 143))
    const mealId = await logManualFood(userDb, selection, NOW, { localDate: '2024-02-29', mealSlot: 'dinner' })
    expect(await userDb.get('SELECT local_date, meal_slot FROM meals WHERE id = ?', [mealId]))
      .toEqual({ local_date: '2024-02-29', meal_slot: 'dinner' })
  })

  it('does not fabricate missing core nutrition as zero', async () => {
    await nutritionDb.run(`INSERT INTO foods (id,source,source_id,name,energy_kcal,protein_g,fat_g,carb_g,completeness_score,license,updated_at) VALUES (3,'fdc_sr_legacy','998','Incomplete',100,NULL,1,2,0.5,'CC0',?)`,[NOW])
    await expect(resolveSelection(nutritionDb, candidateFor('usda:998','Incomplete',100))).rejects.toThrow(/unavailable/)
  })

  it('stores an immutable per-100g snapshot and scales once when totaling the serving', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    const mealId = await logManualFood(userDb, selection, NOW)

    const item = await userDb.get<{ snap_energy_kcal: number; snap_protein_g: number; served_kcal: number }>(
      `SELECT snap_energy_kcal, snap_protein_g,
              snap_energy_kcal * grams / 100 AS served_kcal
       FROM log_items WHERE meal_id = ?`,
      [mealId],
    )
    expect(item?.snap_energy_kcal).toBeCloseTo(143, 6)
    expect(item?.snap_protein_g).toBeCloseTo(12.6, 6)
    expect(item?.served_kcal).toBeCloseTo(71.5, 1)
  })

  it('falls back to 100 g when the corpus row has no portion data at all', async () => {
    await nutritionDb.run(
      `INSERT INTO foods (id, source, source_id, name, energy_kcal, protein_g, fat_g, carb_g,
                          completeness_score, license, updated_at)
       VALUES (2, 'fdc_sr_legacy', '999', 'Mystery food, no portions', 200, 10, 5, 20, 1, 'CC0', ?)`,
      [NOW],
    )
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:999', 'Mystery food, no portions', 200))
    expect(selection.grams).toBe(100)
  })

  it('two selections create two separate meals, not one overwritten row', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    const first = await logManualFood(userDb, selection, NOW)
    const second = await logManualFood(userDb, selection, NOW + 1000)
    expect(first).not.toBe(second)

    const items = await userDb.all('SELECT id FROM log_items')
    expect(items).toHaveLength(2)
  })

  it('records structured operation with actor/idempotency and supports undo', async () => {
    const selection = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    const mealId = await logManualFood(userDb, selection, NOW, {
      actor: 'user',
      idempotencyKey: 'manual-egg-1',
    })

    // 1. Verify operation recorded
    const ops = await listOperations(userDb, { entityType: 'meals', entityId: mealId })
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op_type).toBe('insert')
    expect(ops[0]!.actor).toBe('user')
    expect(ops[0]!.idempotency_key).toBe('manual-egg-1')

    // 2. Test idempotency on replay
    const replayedMealId = await logManualFood(userDb, selection, NOW + 500, {
      actor: 'user',
      idempotencyKey: 'manual-egg-1',
    })
    expect(replayedMealId).toBe(mealId)
    expect(await userDb.all('SELECT id FROM meals')).toHaveLength(1)

    // 3. Test undo
    const undoRes = await undoOperation(userDb, ops[0]!.id, NOW + 1000)
    expect(undoRes.success).toBe(true)

    // Meal and items are cleanly removed by undo
    expect(await userDb.get('SELECT id FROM meals WHERE id = ?', [mealId])).toBeNull()
    expect(await userDb.all('SELECT id FROM log_items WHERE meal_id = ?', [mealId])).toHaveLength(0)
  })

  it('uses resolved.servingSizeG when present on the resolved food', async () => {
    const candidate = candidateFor('dish:in:roti', 'Roti', 297)
    const resolved = {
      foodId: 'dish:in:roti',
      sourceId: 'dish:in:roti',
      sourceVersion: 'v0.1',
      attribution: 'Nut AI Dish KB',
      name: 'Roti',
      brand: null,
      energyKcal: 297,
      proteinG: 9.5,
      fatG: 3.2,
      carbG: 58.1,
      fiberG: 9.8,
      sugarG: 1.2,
      sodiumMg: 150,
      servingSizeG: 40,
      servingDesc: '40g standard portion',
      license: 'proprietary',
      source: 'indian_dish_kb',
    }
    const selection = await resolveSelection(nutritionDb, candidate, resolved)
    expect(selection.grams).toBe(40)
  })

  it('logManualMealWithItems logs multiple items atomically under a single meal', async () => {
    const item1 = await resolveSelection(nutritionDb, candidateFor('usda:173424', 'Egg, whole, raw, fresh', 143))
    const item2 = {
      ...item1,
      displayName: 'Roti',
      grams: 40,
      foodId: null,
      matchedFoodSource: 'indian_dish_kb',
    }

    const mealId = await import('./manual-food.js').then((m) =>
      m.logManualMealWithItems(userDb, [item1, item2], NOW),
    )

    expect(mealId).toBeGreaterThan(0)
    const meal = await userDb.get('SELECT * FROM meals WHERE id = ?', [mealId])
    expect(meal).not.toBeNull()

    const items = await userDb.all<{ sort_order: number; display_name: string; grams: number }>(
      'SELECT sort_order, display_name, grams FROM log_items WHERE meal_id = ? ORDER BY sort_order ASC',
      [mealId],
    )
    expect(items).toHaveLength(2)
    expect(items[0]?.display_name).toBe('Egg, whole, raw, fresh')
    expect(items[0]?.sort_order).toBe(0)
    expect(items[1]?.display_name).toBe('Roti')
    expect(items[1]?.sort_order).toBe(1)
    expect(items[1]?.grams).toBe(40)
  })
})
