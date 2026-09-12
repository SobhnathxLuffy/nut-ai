import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncMetadata, migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  listShortcuts,
  mealSnapshot,
  recentFoods,
  removeShortcut,
  saveShortcut,
} from './shortcuts.js'

const NOW = 1_760_000_000_000
const TODAY = '2025-10-09'

describe('Logging Shortcuts (SRH-004)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)
  })

  async function seedMeal(
    id: number,
    name: string,
    loggedAt: number,
    localDate: string,
    options?: { deleted?: boolean; engineId?: string; photoUri?: string },
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
        options?.deleted ? loggedAt : null,
        sync.sync_state,
        loggedAt,
        localDate,
        'lunch',
        options?.photoUri ?? 'file:///photo.jpg',
        1.0,
        'complete',
        options?.engineId ?? 'vision-v1',
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
        options?.deleted ? loggedAt : null,
        sync.sync_state,
        id,
        101,
        'ifct',
        name,
        150,
        'scale',
        'user',
        200,
        10,
        5,
        25,
        3,
        1,
        300,
        0,
        0,
        loggedAt,
      ],
    )
    return id
  }

  it('captures an immutable meal snapshot stripping photo URI', async () => {
    await seedMeal(1, 'Dal Fry', NOW, TODAY, { photoUri: 'file:///secret-photo.jpg' })
    const snapshot = await mealSnapshot(db, 1)

    expect(snapshot.meal['id']).toBe(1)
    expect(snapshot.meal['photo_uri']).toBeNull()
    expect(snapshot.items.length).toBe(1)
    expect(snapshot.items[0]?.['display_name']).toBe('Dal Fry')
    expect(snapshot.items[0]?.['snap_energy_kcal']).toBe(200)
  })

  it('throws when snapshotting a non-existent or deleted meal', async () => {
    await expect(mealSnapshot(db, 999)).rejects.toThrow('Meal no longer exists')

    await seedMeal(2, 'Old Meal', NOW, TODAY, { deleted: true })
    await expect(mealSnapshot(db, 2)).rejects.toThrow('Meal no longer exists')
  })

  it('saves, lists, and removes shortcuts across favorite, usual, and saved types', async () => {
    await seedMeal(1, 'Protein Shake', NOW, TODAY)

    // Save as favorite
    const favId = await saveShortcut(db, 1, 'favorite', 'My Morning Shake', NOW)
    expect(favId).toBeGreaterThan(0)

    // Save as usual
    const usualId = await saveShortcut(db, 1, 'usual', 'Daily Usual Shake', NOW)
    expect(usualId).toBeGreaterThan(0)

    // List shortcuts
    const shortcuts = await listShortcuts(db)
    expect(shortcuts.length).toBe(2)
    expect(shortcuts.some((s) => s.kind === 'favorite' && s.name === 'My Morning Shake')).toBe(true)
    expect(shortcuts.some((s) => s.kind === 'usual' && s.name === 'Daily Usual Shake')).toBe(true)

    // Remove favorite
    await removeShortcut(db, favId, NOW + 100)
    const remaining = await listShortcuts(db)
    expect(remaining.length).toBe(1)
    expect(remaining[0]?.kind).toBe('usual')
  })

  it('validates shortcut inputs strictly', async () => {
    await seedMeal(1, 'Rice Bowl', NOW, TODAY)

    // Empty or whitespace name
    await expect(saveShortcut(db, 1, 'favorite', '   ', NOW)).rejects.toThrow('Enter a shortcut name')

    // Name too long (> 120 chars)
    await expect(saveShortcut(db, 1, 'favorite', 'a'.repeat(121), NOW)).rejects.toThrow('Enter a shortcut name')

    // Invalid kind
    // @ts-expect-error test runtime validation
    await expect(saveShortcut(db, 1, 'invalid_kind', 'Rice', NOW)).rejects.toThrow('Enter a shortcut name')
  })

  it('calculates recents within 30 days and ignores deleted or test fixture rows', async () => {
    // 1. Meal within 30 days
    await seedMeal(1, 'Paneer Tikka', NOW - 5 * 86_400_000, '2025-10-04')
    // 2. Meal older than 30 days (35 days ago)
    await seedMeal(2, 'Ancient Rice', NOW - 35 * 86_400_000, '2025-09-04')
    // 3. Deleted meal within 30 days
    await seedMeal(3, 'Deleted Salad', NOW - 2 * 86_400_000, '2025-10-07', { deleted: true })
    // 4. Test engine meal within 30 days
    await seedMeal(4, 'Test Engine Oatmeal', NOW - 1 * 86_400_000, '2025-10-08', { engineId: 'test-mock-engine' })
    // 5. Another Paneer Tikka (to test frequency grouping)
    await seedMeal(5, 'Paneer Tikka', NOW - 1 * 86_400_000, '2025-10-08')

    const recents = await recentFoods(db, NOW)
    expect(recents.length).toBe(1)
    expect(recents[0]?.name).toBe('Paneer Tikka')
    expect(recents[0]?.frequency).toBe(2)
  })
})
