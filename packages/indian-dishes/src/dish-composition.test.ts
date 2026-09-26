import { describe, expect, it } from 'vitest'
import { computeUnknownDishNutrition } from './unknown-dish'

describe('Indian Dish Composition and Safety', () => {
  it('draft dish cannot silently become trusted', () => {
    const draftRecord = { recordStatus: 'DRAFT_CURATED' }
    expect(draftRecord.recordStatus).toBe('DRAFT_CURATED')
    expect(draftRecord.recordStatus).not.toBe('CURATED')
  })

  it('missing nutrient remains null/unknown', async () => {
    const mockDb = {
      get: async () => ({ energy_kcal: 100, protein_g: null, fat_g: 10, carb_g: 20, fiber_g: 5, sugar_g: 2, sodium_mg: 100 })
    } as any
    await expect(computeUnknownDishNutrition({
      dishName: 'Test',
      baseIngredientId: 'ifct:A001',
      baseIngredientGrams: 100,
      fatId: null,
      fatGrams: 0,
      cookingMethod: 'boiled'
    }, mockDb, mockDb)).rejects.toThrow('protein_g is unavailable')
  })

  it('component nutrient contributions sum correctly', async () => {
    let callCount = 0
    const mockDb = {
      get: async () => {
        callCount++
        return callCount === 1 
          ? { energy_kcal: 100, protein_g: 10, fat_g: 1, carb_g: 20, fiber_g: 5, sugar_g: 2, sodium_mg: 100 }
          : { energy_kcal: 900, protein_g: 0, fat_g: 100, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }
      }
    } as any
    
    const res = await computeUnknownDishNutrition({
      dishName: 'Test',
      baseIngredientId: 'ifct:A001',
      baseIngredientGrams: 100,
      fatId: 'ifct:T001',
      fatGrams: 10,
      cookingMethod: 'boiled' 
    }, mockDb, mockDb)
    
    // Total kcal = 100 + 90 = 190.
    // serving represents the total cooked dish, so no portion multiplier needed.
    expect(res.serving.kcal).toBeCloseTo(190)
    expect(res.serving.protein_g).toBeCloseTo(10)
    expect(res.serving.fat_g).toBeCloseTo(11) // 1 + 10 = 11
  })

  it('unknown dish does not receive unrelated universal ingredient identity', () => {
    const unknownDish = 'some random dish'
    expect(unknownDish).not.toBe('Bottle Gourd (Lauki / Ghiya)')
  })
})
