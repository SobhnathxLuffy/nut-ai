import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DishDefinition } from '@nutai/core-schema'
import type { DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { computeDishNutrition } from './totals.js'

function dish(status: 'DRAFT_CURATED' | 'CURATED' = 'CURATED'): DishDefinition {
  return {
    schemaVersion: 'test', id: 'dish:test', canonicalName: 'Test dal', category: 'dal', family: 'dal', priorityBatch: 'A',
    cooking: { methods: ['boil'], yieldModel: { measurementPriority: ['measured'], verifiedNumericYield: 2 } },
    recipeTemplate: {
      templateStatus: status, numericRatiosVerified: true, requiresHumanRecipeCalibration: false,
      calculationMode: 'ingredient_sum_then_cooked_yield_then_serving_fraction',
      ingredientSlots: [{
        label: 'dal', role: 'dominant', required: true,
        amountPrior: { kind: 'broad_mass_fraction_engineering_prior', range: [1, 1], verified: true },
        nutritionMapping: { preferredSources: ['IFCT'], canonicalFoodId: 'ifct:B003', mappingStatus: 'MANUAL_OVERRIDE' },
      }, {
        label: 'water', role: 'process', required: true,
        amountPrior: { kind: 'broad_mass_fraction_engineering_prior', range: [1, 1], verified: true },
        nutritionMapping: { preferredSources: ['USDA_FDC'], canonicalFoodId: 'usda:174158', mappingStatus: 'MANUAL_OVERRIDE' },
      }],
    },
    portionModel: { strategies: ['weight'], standardPortionGrams: 200, standardPortionStatus: 'verified' },
    provenance: { recordStatus: status, nutritionEmbedded: false, sourceVerificationRequired: false },
  }
}

describe('deterministic Indian dish totals', () => {
  let nutrition: DbAdapter
  let ifct: DbAdapter
  beforeEach(async () => {
    nutrition = openMemoryDb(); ifct = openMemoryDb()
    const schema = `CREATE TABLE foods (source TEXT, source_id TEXT, energy_kcal REAL, protein_g REAL, fat_g REAL, carb_g REAL, fiber_g REAL, sugar_g REAL, sodium_mg REAL);`
    await nutrition.exec(schema); await ifct.exec(schema)
    await ifct.run('INSERT INTO foods VALUES (?,?,?,?,?,?,?,?,?)', ['ifct', 'B003', 324, 23, 2, 51, 18, null, 20])
    await nutrition.run('INSERT INTO foods VALUES (?,?,?,?,?,?,?,?,?)', ['fdc_foundation', '174158', 0, 0, 0, 0, 0, 0, 0])
  })
  afterEach(async () => { await nutrition.close(); await ifct.close() })

  it('uses source-qualified IDs, verified yield, and serving weight', async () => {
    const result = await computeDishNutrition({ dish: dish(), nutritionDb: nutrition, ifctDb: ifct })
    expect(result.servingSizeG).toBe(200)
    expect(result.energyKcal).toBe(162)
    expect(result.proteinG).toBe(11.5)
    expect(result.sugarG).toBeNull()
  })

  it('fails closed for draft records instead of fabricating a number', async () => {
    await expect(computeDishNutrition({ dish: dish('DRAFT_CURATED'), nutritionDb: nutrition, ifctDb: ifct })).rejects.toThrow(/not curated/)
  })
})
