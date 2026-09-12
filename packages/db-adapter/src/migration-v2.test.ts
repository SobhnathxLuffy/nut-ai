import { beforeEach, describe, expect, it } from 'vitest'
import { openMemoryDb } from './node.js'
import { currentVersion, migrate } from './migrate.js'
import { USER_SCHEMA } from './schema.js'
import { deterministicUuidV7, generateUuidV7, isValidUuid } from './uuid.js'
import type { DbAdapter } from './types.js'

describe('UUIDv7 generator', () => {
  it('generates valid RFC 9562 UUIDv7 strings', () => {
    const uuid = generateUuidV7()
    expect(isValidUuid(uuid)).toBe(true)
    // Version digit at index 14 must be 7
    expect(uuid.charAt(14)).toBe('7')
    // Variant digit at index 19 must be 8, 9, a, or b
    expect(['8', '9', 'a', 'b']).toContain(uuid.charAt(19).toLowerCase())
  })

  it('generates monotonically increasing UUIDs for increasing timestamps', () => {
    const u1 = generateUuidV7(1_000_000)
    const u2 = generateUuidV7(2_000_000)
    expect(u1 < u2).toBe(true)
  })

  it('generates stable, namespaced UUIDs for migration backfills', () => {
    expect(deterministicUuidV7(1_000_000, 'meals:1')).toBe(
      deterministicUuidV7(1_000_000, 'meals:1'),
    )
    expect(deterministicUuidV7(1_000_000, 'meals:1')).not.toBe(
      deterministicUuidV7(1_000_000, 'meals:2'),
    )
  })
})

describe('Schema v2 Migration', () => {
  let db: DbAdapter
  const NOW = 1_754_100_000_000

  beforeEach(() => {
    db = openMemoryDb()
  })

  it('migrates a fresh database directly to v2', async () => {
    const res = await migrate(db, NOW, 2)
    expect(res.to).toBe(2)
    expect(res.applied).toEqual([1, 2])
    expect(await currentVersion(db)).toBe(2)

    // Verify sync columns exist on meals
    const cols = await db.all<{ name: string }>('PRAGMA table_info(meals)')
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('uuid')
    expect(colNames).toContain('updated_at')
    expect(colNames).toContain('revision')
    expect(colNames).toContain('deleted_at')
    expect(colNames).toContain('sync_state')
  })

  it('upgrades a populated v1 database, backfilling UUIDs idempotently', async () => {
    // 1. Manually establish v1
    await db.exec(USER_SCHEMA)
    await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)', [NOW - 1000])

    // Seed v1 data
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at)
       VALUES (1, ?, '2026-08-01', 'lunch', 1.0, 'complete', ?)`,
      [NOW - 500, NOW - 500],
    )
    await db.run(
      `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source, logged_at)
       VALUES (10, 1, 'corpus', 'Rice', 150, 'count', 'model', ?)`,
      [NOW - 500],
    )
    await db.run(
      `INSERT INTO weight_entries (id, local_date, weight_kg, logged_at) VALUES (5, '2026-08-01', 75.5, ?)`,
      [NOW - 400],
    )
    await db.run(
      `INSERT INTO exercise_entries (id, local_date, name, kcal, provenance, logged_at) VALUES (6, '2026-08-01', 'Run', 300, 'manual', ?)`,
      [NOW - 300],
    )
    await db.run(
      `INSERT INTO user_foods (id, name, created_at) VALUES (7, 'Custom Dal', ?)`,
      [NOW - 200],
    )
    await db.run(
      `INSERT INTO saved_meals (id, name, items_json, created_at) VALUES (8, 'Favorite Lunch', '[]', ?)`,
      [NOW - 100],
    )
    await db.run(
      `INSERT INTO user_containers (id, label, type, created_at) VALUES (9, 'Blue Bowl', 'bowl', ?)`,
      [NOW - 50],
    )
    await db.run(
      `INSERT INTO goals (id, effective_from, goal_type, target_kcal, target_raw_kcal, protein_g, fat_g, carbs_g, bmr, tdee)
       VALUES (2, ?, 'maintain', 2000, 2000, 120, 60, 250, 1600, 2000)`,
      [NOW - 20],
    )

    // 2. Run forward migration to v2
    const res = await migrate(db, NOW, 2)
    expect(res.from).toBe(1)
    expect(res.to).toBe(2)
    expect(res.applied).toEqual([2])

    // Verify all rows received UUIDs
    const meal = await db.get<{ id: number; uuid: string; revision: number; sync_state: string }>('SELECT * FROM meals WHERE id = 1')
    expect(meal).not.toBeNull()
    expect(isValidUuid(meal!.uuid)).toBe(true)
    expect(meal!.revision).toBe(1)
    expect(meal!.sync_state).toBe('local')

    const item = await db.get<{ id: number; meal_id: number; uuid: string; created_at: number }>(
      'SELECT * FROM log_items WHERE id = 10',
    )
    expect(item).not.toBeNull()
    expect(item!.meal_id).toBe(1)
    expect(isValidUuid(item!.uuid)).toBe(true)
    expect(item!.created_at).toBe(NOW - 500)

    const weight = await db.get<{ uuid: string }>('SELECT uuid FROM weight_entries WHERE id = 5')
    expect(isValidUuid(weight!.uuid)).toBe(true)

    const exercise = await db.get<{ uuid: string }>('SELECT uuid FROM exercise_entries WHERE id = 6')
    expect(isValidUuid(exercise!.uuid)).toBe(true)

    const food = await db.get<{ uuid: string }>('SELECT uuid FROM user_foods WHERE id = 7')
    expect(isValidUuid(food!.uuid)).toBe(true)

    const saved = await db.get<{ uuid: string }>('SELECT uuid FROM saved_meals WHERE id = 8')
    expect(isValidUuid(saved!.uuid)).toBe(true)

    const container = await db.get<{ uuid: string }>('SELECT uuid FROM user_containers WHERE id = 9')
    expect(isValidUuid(container!.uuid)).toBe(true)

    const goal = await db.get<{ uuid: string }>('SELECT uuid FROM goals WHERE id = 2')
    expect(isValidUuid(goal!.uuid)).toBe(true)

    // 3. Verify idempotency
    const res2 = await migrate(db, NOW + 1000, 2)
    expect(res2.applied).toEqual([])
    const mealAfter = await db.get<{ uuid: string }>('SELECT uuid FROM meals WHERE id = 1')
    expect(mealAfter!.uuid).toBe(meal!.uuid)
  })

  it('enforces uniqueness on uuid column', async () => {
    await migrate(db, NOW)
    const fixedUuid = generateUuidV7()

    await db.run(
      `INSERT INTO meals (id, uuid, logged_at, local_date, created_at) VALUES (1, ?, ?, '2026-08-01', ?)`,
      [fixedUuid, NOW, NOW],
    )

    await expect(
      db.run(
        `INSERT INTO meals (id, uuid, logged_at, local_date, created_at) VALUES (2, ?, ?, '2026-08-01', ?)`,
        [fixedUuid, NOW, NOW],
      ),
    ).rejects.toThrow()
  })

  it('repairs null UUID metadata when upgrading a database that already reached v4', async () => {
    await migrate(db, NOW, 4)
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, created_at)
       VALUES (91, ?, '2026-08-01', ?)`,
      [NOW, NOW],
    )

    await migrate(db, NOW + 1, 5)
    const repaired = await db.get<{ uuid: string; updated_at: number }>(
      'SELECT uuid, updated_at FROM meals WHERE id = 91',
    )
    expect(repaired?.uuid).toBe(deterministicUuidV7(NOW, 'meals:91'))
    expect(repaired?.updated_at).toBe(NOW)
  })
})
