import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './node.js'
import { MIGRATIONS, USER_SCHEMA_VERSION } from './schema.js'
import { currentVersion, migrate } from './migrate.js'

describe('schema v11 custom-food servings', () => {
  it('migrates a populated v10 database without changing nutrient values', async () => {
    const db = openMemoryDb()
    const now = Date.now()
    await migrate(db, now, 10)
    await db.run(
      `INSERT INTO user_foods
       (name, basis, serving_size_g, energy_kcal, protein_g, fat_g, carb_g, created_at,
        uuid, updated_at, revision, sync_state)
       VALUES ('Existing food', 'per_100g', 35, 400, 10, 12, 60, ?,
               '01992820-0000-7000-8000-000000000011', ?, 1, 'local')`,
      [now, now],
    )

    const result = await migrate(db, now + 1)
    expect(result.applied).toEqual([11])
    expect(await currentVersion(db)).toBe(USER_SCHEMA_VERSION)
    const row = await db.get<{
      serving_size_g: number
      serving_amount: number
      serving_unit: string
      energy_kcal: number
    }>('SELECT serving_size_g, serving_amount, serving_unit, energy_kcal FROM user_foods')
    expect(row).toEqual({ serving_size_g: 35, serving_amount: 35, serving_unit: 'g', energy_kcal: 400 })
  })

  it('keeps the shipped v1 migration immutable and v11 forward-only', () => {
    expect(MIGRATIONS[0]?.version).toBe(1)
    expect(MIGRATIONS.at(-1)?.version).toBe(11)
  })
})
