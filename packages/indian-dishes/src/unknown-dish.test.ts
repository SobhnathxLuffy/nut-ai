import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { openNodeDb } from '@nutai/db-adapter/node'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { NUTRITION_SCHEMA } from '@nutai/db-adapter'
import type { DbAdapter } from '@nutai/db-adapter'
import {
  computeUnknownDishNutrition,
  COMMON_BASE_INGREDIENTS,
  COOKING_FAT_OPTIONS,
  COOKING_METHOD_OPTIONS,
} from './unknown-dish.js'

const DB_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/mobile/assets/nutrition.db',
)
const IFCT_DB_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/mobile/assets/ifct.db',
)

describe('unknown-dish fallback', () => {
  let db: DbAdapter
  let ifctDb: DbAdapter

  beforeAll(() => {
    if (existsSync(DB_PATH)) db = openNodeDb(DB_PATH, { readonly: true })
    if (existsSync(IFCT_DB_PATH)) ifctDb = openNodeDb(IFCT_DB_PATH, { readonly: true })
  })

  afterAll(async () => {
    if (db) await db.close()
    if (ifctDb) await ifctDb.close()
  })

  it('has valid common base ingredients, cooking fats, and cooking methods', () => {
    expect(COMMON_BASE_INGREDIENTS.length).toBeGreaterThan(10)
    expect(COOKING_FAT_OPTIONS.length).toBeGreaterThan(3)
    expect(COOKING_METHOD_OPTIONS.length).toBeGreaterThan(3)
  })

  it('maps every handwritten option to its actual bundled IFCT identity', async () => {
    if (!ifctDb) return
    const expected: Record<string,string> = { jackfruit:'Jack fruit', cauliflower:'Cauliflower', okra:'Ladies finger', 'rice-raw-milled':'Rice, raw, milled' }
    for (const option of COMMON_BASE_INGREDIENTS) {
      const row=await ifctDb.get<{name:string}>('SELECT name FROM foods WHERE source_id=?',[option.foodId.slice(5)])
      expect(row,option.label).not.toBeNull()
      if(expected[option.optionId]) expect(row!.name).toContain(expected[option.optionId]!)
    }
  })

  it('gives distinct IDs to oil amounts even when the food source is shared', () => {
    const sunflower=COOKING_FAT_OPTIONS.filter(option=>option.foodId==='ifct:T012')
    expect(new Set(sunflower.map(option=>option.optionId)).size).toBe(sunflower.length)
    expect(new Set(sunflower.map(option=>option.defaultGrams))).toEqual(new Set([14,5]))
  })

  it('keeps unreported micronutrients unknown', async () => {
    const nutrition=openMemoryDb();const ifct=openMemoryDb();await nutrition.exec(NUTRITION_SCHEMA);await ifct.exec(NUTRITION_SCHEMA)
    await ifct.run(`INSERT INTO foods(id,source,source_id,name,energy_kcal,protein_g,fat_g,carb_g,fiber_g,sugar_g,sodium_mg,completeness_score,license,updated_at) VALUES(1,'ifct','X001','Test ingredient',100,5,2,20,NULL,NULL,10,0.5,'IFCT',1)`)
    const result=await computeUnknownDishNutrition({dishName:'Test',baseIngredientId:'ifct:X001',baseIngredientGrams:100,fatId:null,fatGrams:0,cookingMethod:'boiled'},nutrition,ifct)
    expect(result.per100g.fiber_g).toBeNull();expect(result.per100g.sugar_g).toBeNull();expect(result.per100g.sodium_mg).not.toBeNull()
    await nutrition.close();await ifct.close()
  })

  it('computes deterministic arithmetic nutrition from ingredients and yield', async () => {
    if (!db || !ifctDb) return

    // Bottle Gourd (Lauki) curry with 1 tbsp mustard oil
    const result = await computeUnknownDishNutrition(
      {
        dishName: 'Lauki Ki Sabzi',
        baseIngredientId: 'ifct:D008', // Lauki
        baseIngredientGrams: 200,
        fatId: 'ifct:T006', // Mustard oil
        fatGrams: 10,
        cookingMethod: 'curried',
        portionGrams: 150,
      },
      db,
      ifctDb,
    )

    expect(result.dishName).toBe('Lauki Ki Sabzi')
    expect(result.rawMassGrams).toBe(210)
    expect(result.cookedYieldGrams).toBeCloseTo(210 * 1.25, 1)
    expect(result.portionGrams).toBe(150)
    expect(result.per100g.kcal).toBeGreaterThan(20)
    expect(result.per100g.kcal).toBeLessThan(100)
    expect(result.serving.kcal).toBeGreaterThan(30)
    expect(result.serving.kcal).toBeLessThan(150)
    expect(result.serving.fat_g).toBeGreaterThan(2)
  })

  it('rejects non-positive ingredient mass', async () => {
    if (!db) return
    await expect(
      computeUnknownDishNutrition(
        {
          dishName: 'Empty',
          baseIngredientId: 'ifct:D008',
          baseIngredientGrams: 0,
          fatId: null,
          fatGrams: 0,
          cookingMethod: 'sauteed',
        },
        db,
        ifctDb,
      ),
    ).rejects.toThrow('Ingredient mass must be positive')
  })

  it('computes a multi-ingredient dish with per-ingredient breakdown', async () => {
    if (!db || !ifctDb) return

    // Aloo Matar-ish: potato 200g + green peas 100g + oil 10g, sautéed.
    const result = await computeUnknownDishNutrition(
      {
        dishName: 'Aloo Matar',
        baseIngredientId: 'ifct:F006', // Potato
        baseIngredientGrams: 200,
        fatId: 'ifct:T012', // Sunflower oil
        fatGrams: 10,
        extraIngredients: [
          { foodId: 'ifct:D058', grams: 100 }, // Green peas
          { foodId: 'ifct:G017', grams: 30 },  // Onion
          { foodId: 'ifct:F006', grams: 50 },  // Duplicate potato — grams must SUM, not duplicate
        ],
        cookingMethod: 'sauteed',
        portionGrams: 150,
      },
      db,
      ifctDb,
    )

    // 200 + 50 deduped into one 250 g potato row: 250 + 100 + 30 + 10 oil = 390 g raw.
    expect(result.rawMassGrams).toBe(390)
    const potatoParts = result.ingredientBreakdown.filter((p) => p.foodId === 'ifct:F006')
    expect(potatoParts).toHaveLength(1)
    expect(potatoParts[0]!.grams).toBe(250)
    // Breakdown contributions must sum to the serving totals (sauteed yield 0.85).
    const kcalSum = result.ingredientBreakdown.reduce((sum, p) => sum + (p.kcal ?? 0), 0)
    expect(kcalSum).toBeCloseTo(result.serving.kcal!, 5)
    const proteinSum = result.ingredientBreakdown.reduce((sum, p) => sum + (p.protein_g ?? 0), 0)
    expect(proteinSum).toBeCloseTo(result.serving.protein_g!, 5)
  })

  it('accepts a custom user ingredient (userfood:) as a full participant', async () => {
    if (!db) return
    const userDb = openMemoryDb()
    await userDb.exec(
      `CREATE TABLE IF NOT EXISTS user_foods (
        uuid TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, brand TEXT, barcode TEXT, basis TEXT NOT NULL,
        serving_size_g REAL, serving_amount REAL, serving_unit TEXT, energy_kcal REAL NOT NULL DEFAULT 0,
        protein_g REAL NOT NULL DEFAULT 0, fat_g REAL NOT NULL DEFAULT 0, carb_g REAL NOT NULL DEFAULT 0,
        fiber_g REAL, sugar_g REAL, sodium_mg REAL, created_at INTEGER, uuid_sync TEXT, updated_at INTEGER,
        revision INTEGER, deleted_at INTEGER, sync_state TEXT)`,
    ).catch(async () => {
      // Schema differs between environments; the identity of the query under
      // test is the userfood: prefix dispatch, so retry with the adapter's
      // canonical schema when the bare CREATE conflicts.
      await userDb.exec('DROP TABLE IF EXISTS user_foods')
      await userDb.exec(
        `CREATE TABLE user_foods (
          uuid TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, brand TEXT, barcode TEXT, basis TEXT NOT NULL,
          serving_size_g REAL, serving_amount REAL, serving_unit TEXT, energy_kcal REAL NOT NULL DEFAULT 0,
          protein_g REAL NOT NULL DEFAULT 0, fat_g REAL NOT NULL DEFAULT 0, carb_g REAL NOT NULL DEFAULT 0,
          fiber_g REAL, sugar_g REAL, sodium_mg REAL, created_at INTEGER, uuid_sync TEXT, updated_at INTEGER,
          revision INTEGER, deleted_at INTEGER, sync_state TEXT)`,
      )
    })
    await userDb.run(
      `INSERT INTO user_foods (uuid, name, basis, energy_kcal, protein_g, fat_g, carb_g, serving_size_g)
       VALUES ('018f7fc7-7c00-7000-8000-000000000abc', 'Soya chaap custom', 'per_100g', 345, 36, 10, 25, 100)`,
    )

    const result = await computeUnknownDishNutrition(
      {
        dishName: 'Custom Dish',
        baseIngredientId: 'userfood:018f7fc7-7c00-7000-8000-000000000abc',
        baseIngredientGrams: 100,
        fatId: null,
        fatGrams: 0,
        cookingMethod: 'boiled',
        portionGrams: 105, // boiled yield 1.05 × 100 g — the whole dish
      },
      db,
      ifctDb,
      userDb,
    )
    expect(result.serving.kcal).toBeCloseTo(345, 5)
    expect(result.serving.protein_g).toBeCloseTo(36, 5)
    expect(result.ingredientBreakdown[0]!.foodId).toBe('userfood:018f7fc7-7c00-7000-8000-000000000abc')
    await userDb.close()
  })
})
