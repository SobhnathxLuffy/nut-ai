import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, USER_SCHEMA_VERSION, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { RecipeSource } from './recipe-source.js'

const NOW = 1_754_200_000_000

describe('RecipeSource', () => {
  let db: DbAdapter
  let source: RecipeSource

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON;')
    await migrate(db, NOW)
    source = new RecipeSource(db)

    await db.run(
      `INSERT INTO recipes (id, uuid, name, created_at, updated_at, sync_state, revision)
       VALUES (1, '018f7fc7-7c00-7000-8000-000000000001', 'Everyday dal', ?, ?, 'local', 1)`,
      [NOW, NOW],
    )
    await db.run(
      `INSERT INTO recipe_versions
       (id, uuid, recipe_id, version_number, preparation, added_oil_g, added_water_g,
        final_cooked_weight_g, servings, created_at, updated_at, sync_state, revision)
       VALUES (1, '018f7fc7-7c00-7000-8000-000000000002', 1, 1, 'boiled', 10, 200, 300, 2, ?, ?, 'local', 1)`,
      [NOW, NOW],
    )
    await db.run(
      `INSERT INTO recipe_components
       (id, uuid, recipe_version_id, food_id, gram_weight, created_at, sync_state,
        snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, snap_fiber_g, snap_sugar_g,
        snap_sodium_mg, updated_at, revision)
       VALUES (1, '018f7fc7-7c00-7000-8000-000000000003', 1, 'ifct:42', 100, ?, 'local',
               340, 22, 1, 60, 10, 2, 15, ?, 1)`,
      [NOW, NOW],
    )
  })

  it('resolves a recipe from immutable version snapshots', async () => {
    const food = await source.resolveById('recipe:018f7fc7-7c00-7000-8000-000000000001')
    expect(food?.source).toBe('recipe')
    expect(food?.sourceId).toBe('018f7fc7-7c00-7000-8000-000000000001')
    expect(food?.servingSizeG).toBe(150)
    expect(food?.energyKcal).toBeCloseTo(215.1, 1)
    expect(food?.fatG).toBeCloseTo(5.5, 1)
  })

  it('searches resolver FTS expressions against the small recipe table', async () => {
    const results = await source.search('"everyday" AND "dal"')
    expect(results).toHaveLength(1)
    expect(results[0]?.foodId).toBe('recipe:018f7fc7-7c00-7000-8000-000000000001')
  })

  it('upgrades a populated v7 recipe database without losing its version rows', async () => {
    const legacy = openMemoryDb()
    await legacy.exec('PRAGMA foreign_keys = ON;')
    await migrate(legacy, NOW, 7)
    await legacy.run(
      `INSERT INTO recipes (id, uuid, name, created_at, updated_at, sync_state)
       VALUES (1, '018f7fc7-7c00-7000-8000-000000000011', 'Legacy dal', ?, ?, 'local')`,
      [NOW, NOW],
    )
    await legacy.run(
      `INSERT INTO recipe_versions
       (id, uuid, recipe_id, version_number, preparation, final_cooked_weight_g, servings, created_at, sync_state)
       VALUES (1, '018f7fc7-7c00-7000-8000-000000000012', 1, 1, 'boiled', 200, 2, ?, 'local')`,
      [NOW],
    )

    const result = await migrate(legacy, NOW + 1)
    expect(result.to).toBe(USER_SCHEMA_VERSION)
    expect(await legacy.get('SELECT id FROM recipe_versions WHERE id = 1')).not.toBeNull()
    const columns = await legacy.all<{ name: string }>('PRAGMA table_info(recipe_components)')
    expect(columns.map((column) => column.name)).toContain('snap_energy_kcal')
  })
})
