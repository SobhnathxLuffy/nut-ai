import { beforeEach, describe, expect, it } from 'vitest'
import {
  migrate,
  undoOperation,
  redoOperation,
  recordOperation,
  type DbAdapter,
} from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { getLoggedMeal, updateLoggedMeal } from './logged-meals'
import {
  subscribeFoodMutations,
  setLastDeletedMealUndoUuid,
  type FoodMutation,
} from './food-mutations'

const NOW = 1_754_200_000_000

describe('Logged Meals Data Layer (Edit, Delete, Undo, Redo, Aggregate Restoration)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON;')
    await migrate(db, NOW)
    setLastDeletedMealUndoUuid(null)
  })

  async function createTestMeal(mealId = 1, options?: { localDate?: string; slot?: string }) {
    const date = options?.localDate ?? '2026-09-13'
    const slot = options?.slot ?? 'lunch'
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction, analysis_status, uuid, created_at, updated_at, revision, sync_state)
       VALUES (?, ?, ?, ?, NULL, 1.0, 'complete', 'meal-uuid-1', ?, ?, 1, 'local')`,
      [mealId, NOW, date, slot, NOW, NOW],
    )
    await db.run(
      `INSERT INTO log_items (id, meal_id, matched_food_id, matched_food_source, raw_model_label, display_name, grams, gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, is_estimate, macros_user_edited, sort_order, logged_at, uuid, created_at, updated_at, revision, sync_state)
       VALUES (101, ?, 'D036', 'ifct', 'Cauliflower', 'Cauliflower sabzi', 150, 'manual', 'user', 50, 2.5, 2.0, 6.0, 0, 0, 0, ?, 'item-uuid-101', ?, ?, 1, 'local'),
              (102, ?, 'A015', 'ifct', 'Rice', 'Steamed rice', 200, 'manual', 'user', 130, 2.7, 0.3, 28.0, 0, 0, 1, ?, 'item-uuid-102', ?, ?, 1, 'local')`,
      [mealId, NOW, NOW, NOW, mealId, NOW, NOW, NOW],
    )
    await db.run(
      `INSERT INTO scan_cost_ledger (id, meal_id, provider, model, input_tokens, output_tokens, cost_usd, local_month, created_at)
       VALUES (201, ?, 'anthropic', 'claude-3-5-haiku', 500, 200, 0.0012, '2026-09', ?)`,
      [mealId, NOW],
    )
  }

  it('reads logged meal detail and components correctly', async () => {
    await createTestMeal(1)
    const meal = await getLoggedMeal(db, 1)
    expect(meal).not.toBeNull()
    expect(meal?.id).toBe(1)
    expect(meal?.date).toBe('2026-09-13')
    expect(meal?.slot).toBe('lunch')
    expect(meal?.items.length).toBe(2)
    expect(meal?.items[0]).toEqual({
      id: 101,
      name: 'Cauliflower sabzi',
      grams: 150,
      kcalPer100g: 50,
    })
    expect(meal?.items[1]).toEqual({
      id: 102,
      name: 'Steamed rice',
      grams: 200,
      kcalPer100g: 130,
    })
  })

  it('edits meal date, slot, and items with validation and undo/redo support', async () => {
    await createTestMeal(1)
    const mutations: FoodMutation[] = []
    const unsubscribe = subscribeFoodMutations((m) => mutations.push(m))

    const editTimestamp = NOW + 60_000
    const opUuid = await updateLoggedMeal(
      db,
      {
        id: 1,
        date: '2026-09-14',
        slot: 'dinner',
        items: [
          { id: 101, name: 'Gobi Masala', grams: 180, kcalPer100g: 50 },
          { id: 102, name: 'Brown rice', grams: 220, kcalPer100g: 130 },
        ],
      },
      editTimestamp,
    )

    expect(mutations).toHaveLength(1)
    expect(mutations[0]?.kind).toBe('meal')
    expect(mutations[0]?.operationUuid).toBe(opUuid)

    // Verify updated values in database
    const updated = await getLoggedMeal(db, 1)
    expect(updated?.date).toBe('2026-09-14')
    expect(updated?.slot).toBe('dinner')
    expect(updated?.items[0]?.name).toBe('Gobi Masala')
    expect(updated?.items[0]?.grams).toBe(180)
    expect(updated?.items[1]?.name).toBe('Brown rice')
    expect(updated?.items[1]?.grams).toBe(220)

    // Undo the edit
    const undoRes = await undoOperation(db, opUuid, editTimestamp + 1000)
    expect(undoRes.success).toBe(true)

    const reverted = await getLoggedMeal(db, 1)
    expect(reverted?.date).toBe('2026-09-13')
    expect(reverted?.slot).toBe('lunch')
    expect(reverted?.items[0]?.name).toBe('Cauliflower sabzi')
    expect(reverted?.items[0]?.grams).toBe(150)
    expect(reverted?.items[1]?.name).toBe('Steamed rice')
    expect(reverted?.items[1]?.grams).toBe(200)

    // Redo the edit
    const redoRes = await redoOperation(db, opUuid)
    expect(redoRes.success).toBe(true)

    const reApplied = await getLoggedMeal(db, 1)
    expect(reApplied?.date).toBe('2026-09-14')
    expect(reApplied?.slot).toBe('dinner')
    expect(reApplied?.items[0]?.name).toBe('Gobi Masala')
    expect(reApplied?.items[0]?.grams).toBe(180)

    unsubscribe()
  })

  it('rejects invalid inputs during updateLoggedMeal without modifying database', async () => {
    await createTestMeal(1)

    // Invalid date
    await expect(
      updateLoggedMeal(
        db,
        {
          id: 1,
          date: 'invalid-date',
          slot: 'lunch',
          items: [{ id: 101, name: 'Food', grams: 100, kcalPer100g: 50 }],
        },
        NOW,
      ),
    ).rejects.toThrow('Choose a valid date')

    // Empty name
    await expect(
      updateLoggedMeal(
        db,
        {
          id: 1,
          date: '2026-09-13',
          slot: 'lunch',
          items: [{ id: 101, name: '   ', grams: 100, kcalPer100g: 50 }],
        },
        NOW,
      ),
    ).rejects.toThrow('Each food needs a name and grams greater than zero')

    // Grams <= 0 or NaN
    await expect(
      updateLoggedMeal(
        db,
        {
          id: 1,
          date: '2026-09-13',
          slot: 'lunch',
          items: [{ id: 101, name: 'Food', grams: 0, kcalPer100g: 50 }],
        },
        NOW,
      ),
    ).rejects.toThrow('Each food needs a name and grams greater than zero')

    await expect(
      updateLoggedMeal(
        db,
        {
          id: 1,
          date: '2026-09-13',
          slot: 'lunch',
          items: [{ id: 101, name: 'Food', grams: -10, kcalPer100g: 50 }],
        },
        NOW,
      ),
    ).rejects.toThrow('Each food needs a name and grams greater than zero')

    await expect(
      updateLoggedMeal(
        db,
        {
          id: 1,
          date: '2026-09-13',
          slot: 'lunch',
          items: [{ id: 101, name: 'Food', grams: Number.NaN, kcalPer100g: 50 }],
        },
        NOW,
      ),
    ).rejects.toThrow('Each food needs a name and grams greater than zero')
  })

  it('proves delete, undo, and redo restore meal + items + scan_cost_ledger together with exact integrity', async () => {
    await createTestMeal(1)

    // Capture meal, items, and ledger rows before deletion
    const mealBefore = await db.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = 1')
    const itemsBefore = await db.all<Record<string, unknown>>('SELECT * FROM log_items WHERE meal_id = 1 ORDER BY id')
    const ledgerBefore = await db.all<Record<string, unknown>>('SELECT * FROM scan_cost_ledger WHERE meal_id = 1 ORDER BY id')

    expect(mealBefore).not.toBeNull()
    expect(itemsBefore).toHaveLength(2)
    expect(ledgerBefore).toHaveLength(1)

    // Perform deletion as an operation
    const deleteOp = await recordOperation(db, {
      entityType: 'meals',
      entityId: 1,
      opType: 'delete',
      prevJson: { meal: mealBefore, items: itemsBefore, ledger: ledgerBefore },
      actor: 'user',
      createdAt: NOW + 10_000,
    })

    await db.run('DELETE FROM log_items WHERE meal_id = 1')
    await db.run('DELETE FROM scan_cost_ledger WHERE meal_id = 1')
    await db.run('DELETE FROM meals WHERE id = 1')

    // Confirm all rows are deleted
    expect(await db.get('SELECT * FROM meals WHERE id = 1')).toBeNull()
    expect(await db.all('SELECT * FROM log_items WHERE meal_id = 1')).toHaveLength(0)
    expect(await db.all('SELECT * FROM scan_cost_ledger WHERE meal_id = 1')).toHaveLength(0)

    // Perform an unrelated operation (e.g. log an exercise entry)
    await db.run(
      `INSERT INTO exercise_entries (id, local_date, name, kcal, provenance, logged_at, uuid, created_at, updated_at, revision, sync_state)
       VALUES (501, '2026-09-13', 'Evening Jog', 250, 'manual', ?, 'ex-uuid-501', ?, ?, 1, 'local')`,
      [NOW + 20_000, NOW + 20_000, NOW + 20_000],
    )
    const exerciseOp = await recordOperation(db, {
      entityType: 'exercise_entries',
      entityId: 501,
      opType: 'insert',
      newJson: { id: 501, name: 'Evening Jog', kcal: 250 },
      actor: 'user',
      createdAt: NOW + 20_000,
    })

    // Now contextual undo specifically targets the meal deletion operation UUID
    const undoMeal = await undoOperation(db, deleteOp.uuid, NOW + 30_000)
    expect(undoMeal.success).toBe(true)

    // Verify meal, items, and ledger are completely restored!
    const mealAfter = await db.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = 1')
    const itemsAfter = await db.all<Record<string, unknown>>('SELECT * FROM log_items WHERE meal_id = 1 ORDER BY id')
    const ledgerAfter = await db.all<Record<string, unknown>>('SELECT * FROM scan_cost_ledger WHERE meal_id = 1 ORDER BY id')

    expect(mealAfter).toEqual(mealBefore)
    expect(itemsAfter).toEqual(itemsBefore)
    expect(ledgerAfter).toEqual(ledgerBefore)

    // Verify unrelated operation (exercise entry) is completely intact and untouched!
    const exerciseAfter = await db.get<Record<string, unknown>>('SELECT * FROM exercise_entries WHERE id = 501')
    expect(exerciseAfter).not.toBeNull()
    expect(exerciseAfter?.['name']).toBe('Evening Jog')
    const liveExerciseOp = await db.get<{ undone_at: number | null }>('SELECT undone_at FROM operations WHERE id = ?', [exerciseOp.id])
    expect(liveExerciseOp?.undone_at).toBeNull()

    // Redo re-deletes the meal aggregate
    const redoMeal = await redoOperation(db, deleteOp.uuid)
    expect(redoMeal.success).toBe(true)

    expect(await db.get('SELECT * FROM meals WHERE id = 1')).toBeNull()
    expect(await db.all('SELECT * FROM log_items WHERE meal_id = 1')).toHaveLength(0)
    expect(await db.all('SELECT * FROM scan_cost_ledger WHERE meal_id = 1')).toHaveLength(0)

    // Exercise is still intact
    expect(await db.get('SELECT * FROM exercise_entries WHERE id = 501')).not.toBeNull()
  })
})
