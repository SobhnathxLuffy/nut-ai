import type { DishDefinition } from '@nutai/core-schema'
import { computeRecipeServing, type RecipeVersion, type RecipeIngredient } from '@nutai/recipe-engine'
import type { DbAdapter } from '@nutai/db-adapter'

export interface DishTotalOptions {
  dish: DishDefinition
  db: DbAdapter
  servings?: number
}

/**
 * Computes nutrition for an Indian dish using its recipe template.
 * Satisfies Part E requirement: Calculate nutrition via ingredients * quantities -> cooked yield -> serving weight -> nutrition.
 * Never invents fixed AI calories.
 */
export async function computeDishNutrition({ dish, db, servings = 1 }: DishTotalOptions) {
  if (!dish.recipeTemplate) {
    throw new Error('Dish is missing recipe template')
  }

  const ingredients: RecipeIngredient[] = []
  let totalRawMass = 0

  for (const slot of dish.recipeTemplate.ingredientSlots) {
    if (slot.nutritionMapping.mappingStatus === 'mapped' && slot.nutritionMapping.canonicalFoodId) {
      // Find food in nutrition.db
      const food = await db.get<any>(
        'SELECT energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg FROM foods WHERE id = ?',
        [slot.nutritionMapping.canonicalFoodId]
      )
      
      if (food) {
        // Calculate mass based on amount prior range average
        // In a real usage, the app would supply specific user amounts
        let massGrams = 0
        if (slot.amountPrior?.kind === 'broad_mass_fraction_engineering_prior') {
          massGrams = ((slot.amountPrior.range[0] + slot.amountPrior.range[1]) / 2) * 100 // Assume 100g base for calculation
        } else {
          massGrams = 100
        }
        
        totalRawMass += massGrams
        ingredients.push({
          foodId: slot.nutritionMapping.canonicalFoodId,
          gramWeight: massGrams,
          energyKcal: food.energy_kcal || 0,
          proteinG: food.protein_g || 0,
          fatG: food.fat_g || 0,
          carbG: food.carb_g || 0,
          fiberG: food.fiber_g || 0,
          sugarG: food.sugar_g || 0,
          sodiumMg: food.sodium_mg || 0
        })
      }
    }
  }

  // Calculate yield
  let cookedYieldG = totalRawMass
  if (dish.cooking?.yieldModel?.verifiedNumericYield) {
    cookedYieldG = totalRawMass * dish.cooking.yieldModel.verifiedNumericYield
  }

  const version: RecipeVersion = {
    preparation: 'boiled', // TODO: map from dish.cooking.methods
    addedOilG: 0,
    addedWaterG: 0,
    finalCookedWeightG: cookedYieldG,
    servings,
    ingredients
  }

  return computeRecipeServing(version)
}
