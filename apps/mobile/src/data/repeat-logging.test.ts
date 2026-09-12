import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSyncMetadata,
  listOperations,
  migrate,
  redoOperation,
  undoOperation,
  type DbAdapter,
} from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  copyYesterday,
  dateOffset,
  mealSnapshot,
  remapTimestamp,
  repeatSnapshots,
  type MealSnapshot,
} from './shortcuts.js'

const NOW = 1_760_000_000_000
const YESTERDAY = '2025-10-08'
const TODAY = '2025-10-09'

describe('Repeat Logging and Copy-Yesterday Actions (SRH-005)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)
  })

  async function seedMeal(
    id: number,
    slot: string,
    foodName: string,
    loggedAt: number,
    localDate: string,
  ): Promise<number> {
    const sync = createSyncMetadata(loggedAt)
    await db.run(
      `INSERT INTO meals (
        id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction, analysis_status, engine_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sync.uuid,
        sync.created_at,
        sync.updated_at,
        sync.revision,
        null,
        sync.sync_state,
        loggedAt,
        localDate,
        slot,
        'file:///photo.jpg',
        1.0,
        'complete',
        'vision-v1',
      ],
    )

    await db.run(
      `INSERT INTO log_items (
        id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        meal_id, matched_food_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
        snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
        is_estimate, sort_order, logged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id * 10,
        sync.uuid,
        sync.created_at,
        sync.updated_at,
        sync.revision,
        null,
        sync.sync_state,
        id,
        101,
        'ifct',
        foodName,
        200,
        'scale',
        'user',
        250,
        15,
        6,
        30,
        4,
        2,
        400,
        0,
        0,
        loggedAt,
      ],
    )
    return id
  }

  it('correctly offsets dates and remaps timestamps', () => {
    expect(dateOffset('2025-10-09', -1)).toBe('2025-10-08')
    expect(dateOffset('2025-10-09', 1)).toBe('2025-10-10')

    const ts = new Date(2025, 9, 8, 8, 30, 0).getTime() // Oct 8, 8:30 AM
    const remapped = remapTimestamp(ts, '2025-10-09')
    const remappedDate = new Date(remapped)
    expect(remappedDate.getFullYear()).toBe(2025)
    expect(remappedDate.getMonth()).toBe(9)
    expect(remappedDate.getDate()).toBe(9)
    expect(remappedDate.getHours()).toBe(8)
    expect(remappedDate.getMinutes()).toBe(30)
  })

  it('repeats meal snapshots with new IDs, new UUIDs, and identical nutrient snapshots', async () => {
    await seedMeal(1, 'breakfast', 'Oatmeal & Milk', NOW - 86_400_000, YESTERDAY)
    const snapshot = await mealSnapshot(db, 1)

    const repeatedIds = await repeatSnapshots(db, [snapshot], TODAY, NOW)
    expect(repeatedIds.length).toBe(1)
    const newMealId = repeatedIds[0]!
    expect(newMealId).not.toBe(1)

    // Inspect repeated meal row
    const meal = await db.get<{
      uuid: string
      local_date: string
      meal_slot: string
      photo_uri: string | null
    }>('SELECT * FROM meals WHERE id = ?', [newMealId])
    expect(meal?.local_date).toBe(TODAY)
    expect(meal?.meal_slot).toBe('breakfast')
    expect(meal?.uuid).not.toBe(snapshot.meal['uuid'])
    expect(meal?.photo_uri).toBeNull()

    // Inspect repeated log items
    const items = await db.all<{
      display_name: string
      snap_energy_kcal: number
      snap_protein_g: number
    }>('SELECT * FROM log_items WHERE meal_id = ?', [newMealId])
    expect(items.length).toBe(1)
    expect(items[0]?.display_name).toBe('Oatmeal & Milk')
    expect(items[0]?.snap_energy_kcal).toBe(250)
    expect(items[0]?.snap_protein_g).toBe(15)
  })

  it('copies yesterday meals into today with copyYesterday', async () => {
    await seedMeal(1, 'breakfast', 'Poha', NOW - 86_400_000, YESTERDAY)
    await seedMeal(2, 'dinner', 'Paneer Bhurji', NOW - 86_400_000 + 3600_000, YESTERDAY)

    const copiedIds = await copyYesterday(db, TODAY, NOW)
    expect(copiedIds.length).toBe(2)

    const todayMeals = await db.all<{ id: number; meal_slot: string }>(
      'SELECT id, meal_slot FROM meals WHERE local_date = ? AND deleted_at IS NULL ORDER BY id',
      [TODAY],
    )
    expect(todayMeals.length).toBe(2)
    expect(todayMeals[0]?.meal_slot).toBe('breakfast')
    expect(todayMeals[1]?.meal_slot).toBe('dinner')
  })

  it('atomically undoes and redoes repeat operations', async () => {
    await seedMeal(1, 'lunch', 'Khichdi', NOW - 86_400_000, YESTERDAY)
    const copiedIds = await copyYesterday(db, TODAY, NOW)
    expect(copiedIds.length).toBe(1)

    // Confirm meal exists today
    let count = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM meals WHERE local_date = ? AND deleted_at IS NULL',
      [TODAY],
    )
    expect(count?.count).toBe(1)

    // Find the recorded batch operation
    const ops = await listOperations(db, { entityType: 'batch', limit: 1 })
    expect(ops.length).toBe(1)
    const op = ops[0]!

    // Undo operation
    const undoRes = await undoOperation(db, op.id, NOW + 1000)
    expect(undoRes.success).toBe(true)

    // Meal should be removed
    count = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM meals WHERE local_date = ? AND deleted_at IS NULL',
      [TODAY],
    )
    expect(count?.count).toBe(0)

    // Redo operation
    const redoRes = await redoOperation(db, op.id)
    expect(redoRes.success).toBe(true)

    // Meal is restored
    count = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM meals WHERE local_date = ? AND deleted_at IS NULL',
      [TODAY],
    )
    expect(count?.count).toBe(1)
  })

  it('rejects invalid repeat requests', async () => {
    // Empty snapshots array
    await expect(repeatSnapshots(db, [], TODAY)).rejects.toThrow('No meals to copy')

    // More than 100 meals
    const fakeSnapshot = {
      meal: { id: 1, logged_at: NOW, local_date: TODAY },
      items: [{ id: 10, meal_id: 1, display_name: 'Food', grams: 100 }],
      ledger: [],
    } as unknown as MealSnapshot
    const tooMany = Array(101).fill(fakeSnapshot)
    await expect(repeatSnapshots(db, tooMany, TODAY)).rejects.toThrow('Copy at most 100 meals at a time')

    // Invalid local date
    await expect(repeatSnapshots(db, [fakeSnapshot], 'invalid-date')).rejects.toThrow()
  })

  it('handles idempotency key deduplication on repeat operations', async () => {
    await seedMeal(1, 'snack', 'Almonds', NOW - 86_400_000, YESTERDAY)
    const snapshot = await mealSnapshot(db, 1)

    const firstRun = await repeatSnapshots(db, [snapshot], TODAY, NOW, 'repeat-key-123')
    const secondRun = await repeatSnapshots(db, [snapshot], TODAY, NOW, 'repeat-key-123')

    expect(firstRun).toEqual(secondRun)
    const count = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM meals WHERE local_date = ?',
      [TODAY],
    )
    expect(count?.count).toBe(1)
  })
})
