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
})
