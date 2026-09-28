import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { NUTRITION_SCHEMA } from '@nutai/db-adapter'
import { HouseholdDishSource } from './household-dish-source.js'

const NOW = 1_760_000_000_000

async function seedCorpus(db: DbAdapter): Promise<void> {
  await db.exec(NUTRITION_SCHEMA)
  await db.run(
    `INSERT INTO foods (id, source, source_id, name, energy_kcal, protein_g, fat_g, carb_g, license, basis_confidence, completeness_score)
     VALUES (1, 'ifct', 'F006', 'Potato', 77, 2, 0.1, 17, 'test', 'high', 1)`,
  )
}

/**
 * The saved "My Version" dish: potato 200 g + the user's custom ghee 10 g,
 * portion 150 g. resolveById must replay exactly that arithmetic per-100 g.
 */
const HOUSEHOLD_TEMPLATE = JSON.stringify({
  ingredientSlots: [
    { label: 'Potato', nutritionMapping: { canonicalFoodId: 'ifct:F006' }, amountPrior: { kind: 'HOUSEHOLD_MEASURED', grams: 200, verified: true } },
    { label: 'Homemade ghee', nutritionMapping: { canonicalFoodId: 'userfood:018f7fc7-7c00-7000-8000-000000000001' }, amountPrior: { kind: 'HOUSEHOLD_MEASURED', grams: 10, verified: true } },
  ],
  addedFat: null,
  cookingMethod: 'sauteed',
})

describe('HouseholdDishSource', () => {
  let userDb: DbAdapter
  let nutritionDb: DbAdapter

  beforeEach(async () => {
    userDb = openMemoryDb()
    nutritionDb = openMemoryDb()
    await migrate(userDb, NOW)
    await seedCorpus(nutritionDb)
    await userDb.run(
      `INSERT INTO user_foods (uuid, name, basis, energy_kcal, protein_g, fat_g, carb_g, serving_size_g, created_at, updated_at, revision, sync_state)
       VALUES ('018f7fc7-7c00-7000-8000-000000000001', 'Homemade ghee', 'per_100g', 900, 0, 100, 0, 100, ?, ?, 1, 'local')`,
      [NOW, NOW],
    )
    await userDb.run(
      `CREATE TABLE IF NOT EXISTS dish_definitions (
        id TEXT PRIMARY KEY NOT NULL, search_rowid INTEGER, canonical_name TEXT, category TEXT,
        family TEXT, parent_dish_id TEXT, recipe_template_json TEXT, portion_model_json TEXT, record_status TEXT)`,
    )
    await userDb.run(
      `INSERT INTO dish_definitions (id, canonical_name, recipe_template_json, portion_model_json, record_status)
       VALUES ('dish:in:aloo-matar_household_1', 'Aloo Matar (My Version)', ?, ?, 'HOUSEHOLD')`,
      [HOUSEHOLD_TEMPLATE, JSON.stringify({ standardPortionGrams: 150, standardPortionStatus: 'verified' })],
    )
  })

  it('surfaces saved household variants by name', async () => {
    const source = new HouseholdDishSource(userDb, nutritionDb, nutritionDb)
    const rows = await source.search('"aloo" "matar"')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.foodId).toBe('household_dish:dish:in:aloo-matar_household_1')
    expect(rows[0]!.name).toBe('Aloo Matar (My Version)')
  })

  it('replays the saved grams and portion exactly, per-100 g', async () => {
    const source = new HouseholdDishSource(userDb, nutritionDb, nutritionDb)
    const resolved = await source.resolveById('household_dish:dish:in:aloo-matar_household_1')
    expect(resolved).not.toBeNull()
    // Raw mass 210 g → per-100 g potato kcal = 77*(200/210) + 900*(10/210)
    const expectedKcal = 77 * (200 / 210) + 900 * (10 / 210)
    expect(resolved!.energyKcal).toBeCloseTo(expectedKcal, 5)
    expect(resolved!.fatG).toBeCloseTo(0.1 * (200 / 210) + 100 * (10 / 210), 5)
    expect(resolved!.proteinG).toBeCloseTo(2 * (200 / 210), 5)
    expect(resolved!.servingSizeG).toBe(150)
  })

  it('fails closed when a slot has no food mapping or grams', async () => {
    await userDb.run(
      `INSERT INTO dish_definitions (id, canonical_name, recipe_template_json, portion_model_json, record_status)
       VALUES ('dish:broken', 'Broken Dish (My Version)', ?, '{}', 'HOUSEHOLD')`,
      [JSON.stringify({ ingredientSlots: [{ label: 'Mystery', nutritionMapping: { canonicalFoodId: null } }] })],
    )
    const source = new HouseholdDishSource(userDb, nutritionDb, nutritionDb)
    expect(await source.resolveById('household_dish:dish:broken')).toBeNull()
  })

  it('never resolves the row from the read-only corpus as a household dish', async () => {
    const source = new HouseholdDishSource(userDb, nutritionDb, nutritionDb)
    expect(await source.resolveById('dish:in:aloo-matar')).toBeNull()
    expect(await source.resolveById('household_dish:missing')).toBeNull()
  })
})
