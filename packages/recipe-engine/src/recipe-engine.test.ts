import { describe, it, expect } from 'vitest'
import { computeRecipeServing, type RecipeVersion, type RecipeIngredient } from './index'

describe('computeRecipeServing', () => {
  it('Given dal recipe fixture, then raw/cooked yield and per-serving macros match expected math', () => {
    // 100g raw dal, 10g oil, cooked to 300g final weight, 2 servings
    const rawDal: RecipeIngredient = {
      foodId: 'dal',
      gramWeight: 100, // 100g raw
      energyKcal: 340, // per 100g
      proteinG: 22,
      fatG: 1,
      carbG: 60,
      fiberG: 10,
      sugarG: 2,
      sodiumMg: 15
    }

    const version: RecipeVersion = {
      preparation: 'boiled',
      addedOilG: 10, // 10g oil (10 * 9.02 = 90.2 kcal)
      addedWaterG: 200, // not used in math directly, implies 310g total before evaporation
      finalCookedWeightG: 300,
      servings: 2,
      ingredients: [rawDal]
    }

    const res = computeRecipeServing(version)

    // Serving size: 300g / 2 = 150g
    expect(res.servingSizeG).toBe(150)

    // Total Energy = 340 (dal) + 90.2 (oil) = 430.2 kcal
    // Per serving = 430.2 / 2 = 215.1 kcal
    expect(res.energyKcal).toBeCloseTo(215.1, 1)

    // Total Protein = 22g -> Per serving = 11g
    expect(res.proteinG).toBeCloseTo(11, 1)

    // Total Fat = 1 (dal) + 10 (oil) = 11g -> Per serving = 5.5g
    expect(res.fatG).toBeCloseTo(5.5, 1)
  })
})

  it('Given rice recipe fixture, math matches', () => {
    const rawRice: RecipeIngredient = {
      foodId: 'rice', gramWeight: 100, energyKcal: 360,
      proteinG: 7, fatG: 1, carbG: 80, fiberG: 1, sugarG: 0, sodiumMg: 1
    }
    const version: RecipeVersion = {
      preparation: 'boiled',
      addedOilG: 0,
      addedWaterG: 200,
      finalCookedWeightG: 300,
      servings: 2,
      ingredients: [rawRice]
    }
    const res = computeRecipeServing(version)
    expect(res.servingSizeG).toBe(150)
    expect(res.energyKcal).toBe(180)
  })

  it('Given roti recipe fixture, math matches', () => {
    const rawAtta: RecipeIngredient = {
      foodId: 'atta', gramWeight: 100, energyKcal: 340,
      proteinG: 12, fatG: 2, carbG: 70, fiberG: 10, sugarG: 0, sodiumMg: 5
    }
    const version: RecipeVersion = {
      preparation: 'roasted',
      addedOilG: 5, // ghee
      addedWaterG: 60,
      finalCookedWeightG: 130, // water evaporates during roasting
      servings: 4, // 4 rotis
      ingredients: [rawAtta]
    }
    const res = computeRecipeServing(version)
    expect(res.servingSizeG).toBe(130 / 4) // 32.5g
    // 340 + 5*9.02 = 385.1
    // Per roti = 385.1 / 4 = 96.275
    expect(res.energyKcal).toBeCloseTo(96.275, 1)
  })

  it('Given sabzi recipe fixture, math matches', () => {
    const potato: RecipeIngredient = {
      foodId: 'potato', gramWeight: 200, energyKcal: 77, // per 100g, total 154
      proteinG: 2, fatG: 0.1, carbG: 17, fiberG: 2.2, sugarG: 0.8, sodiumMg: 6
    }
    const cauliflower: RecipeIngredient = {
      foodId: 'cauliflower', gramWeight: 200, energyKcal: 25, // per 100g, total 50
      proteinG: 1.9, fatG: 0.3, carbG: 5, fiberG: 2, sugarG: 1.9, sodiumMg: 30
    }
    const version: RecipeVersion = {
      preparation: 'fried',
      addedOilG: 15, // 15*9.02 = 135.3
      addedWaterG: 0,
      finalCookedWeightG: 350, // lost 50g moisture
      servings: 2,
      ingredients: [potato, cauliflower]
    }
    const res = computeRecipeServing(version)
    expect(res.servingSizeG).toBe(175)
    // 154 + 50 + 135.3 = 339.3 total kcal
    // per serving = 169.65
    expect(res.energyKcal).toBeCloseTo(169.65, 1)
  })

  it('Given curry recipe fixture, math matches', () => {
    const chicken: RecipeIngredient = {
      foodId: 'chicken', gramWeight: 500, energyKcal: 165, // per 100g, total 825
      proteinG: 31, fatG: 3.6, carbG: 0, fiberG: 0, sugarG: 0, sodiumMg: 74
    }
    const version: RecipeVersion = {
      preparation: 'boiled',
      addedOilG: 20, // 20*9.02 = 180.4
      addedWaterG: 300,
      finalCookedWeightG: 700, // lost some moisture
      servings: 4,
      ingredients: [chicken]
    }
    const res = computeRecipeServing(version)
    expect(res.servingSizeG).toBe(175) // 700 / 4
    // 825 + 180.4 = 1005.4 total kcal
    // per serving = 251.35
    expect(res.energyKcal).toBeCloseTo(251.35, 1)
  })

  it('rejects invalid yield and servings instead of producing NaN or Infinity', () => {
    const version: RecipeVersion = {
      preparation: 'boiled', addedOilG: 0, addedWaterG: 0,
      finalCookedWeightG: 0, servings: 1, ingredients: [],
    }
    expect(() => computeRecipeServing(version)).toThrow(/finalCookedWeightG/)
    expect(() => computeRecipeServing({ ...version, finalCookedWeightG: 100, servings: 0 })).toThrow(/servings/)
  })
