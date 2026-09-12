export interface RecipeIngredient {
  readonly foodId: string
  readonly gramWeight: number
  readonly energyKcal: number
  readonly proteinG: number
  readonly fatG: number
  readonly carbG: number
  readonly fiberG: number
  readonly sugarG: number
  readonly sodiumMg: number
}

export interface RecipeVersion {
  readonly preparation: 'boiled' | 'fried' | 'roasted' | 'raw'
  readonly addedOilG: number
  readonly addedWaterG: number
  readonly finalCookedWeightG: number
  readonly servings: number
  readonly ingredients: readonly RecipeIngredient[]
}

export interface ResolvedRecipeServing {
  readonly servingSizeG: number
  readonly energyKcal: number
  readonly proteinG: number
  readonly fatG: number
  readonly carbG: number
  readonly fiberG: number
  readonly sugarG: number
  readonly sodiumMg: number
}

// 902 kcal / 100g = 9.02 kcal/g for pure fat/oil
const OIL_KCAL_PER_G = 9.02

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number`)
  }
}

/** Reject impossible values before they become durable recipe history. */
export function validateRecipeVersion(version: RecipeVersion): void {
  requireFiniteNonNegative(version.addedOilG, 'addedOilG')
  requireFiniteNonNegative(version.addedWaterG, 'addedWaterG')
  if (!Number.isFinite(version.finalCookedWeightG) || version.finalCookedWeightG <= 0) {
    throw new RangeError('finalCookedWeightG must be greater than zero')
  }
  if (!Number.isFinite(version.servings) || version.servings <= 0) {
    throw new RangeError('servings must be greater than zero')
  }
  for (const ingredient of version.ingredients) {
    requireFiniteNonNegative(ingredient.gramWeight, 'ingredient.gramWeight')
    requireFiniteNonNegative(ingredient.energyKcal, 'ingredient.energyKcal')
    requireFiniteNonNegative(ingredient.proteinG, 'ingredient.proteinG')
    requireFiniteNonNegative(ingredient.fatG, 'ingredient.fatG')
    requireFiniteNonNegative(ingredient.carbG, 'ingredient.carbG')
    requireFiniteNonNegative(ingredient.fiberG, 'ingredient.fiberG')
    requireFiniteNonNegative(ingredient.sugarG, 'ingredient.sugarG')
    requireFiniteNonNegative(ingredient.sodiumMg, 'ingredient.sodiumMg')
  }
}

export function computeRecipeServing(version: RecipeVersion): ResolvedRecipeServing {
  validateRecipeVersion(version)
  let sumEnergy = 0
  let sumProtein = 0
  let sumFat = 0
  let sumCarb = 0
  let sumFiber = 0
  let sumSugar = 0
  let sumSodium = 0

  for (const ing of version.ingredients) {
    const factor = ing.gramWeight / 100.0
    sumEnergy += ing.energyKcal * factor
    sumProtein += ing.proteinG * factor
    sumFat += ing.fatG * factor
    sumCarb += ing.carbG * factor
    sumFiber += ing.fiberG * factor
    sumSugar += ing.sugarG * factor
    sumSodium += ing.sodiumMg * factor
  }

  // Add oil nutrients
  if (version.addedOilG > 0) {
    sumEnergy += version.addedOilG * OIL_KCAL_PER_G
    sumFat += version.addedOilG
  }

  const totalYield = version.finalCookedWeightG
  const servingWeight = totalYield / version.servings
  const multiplier = totalYield > 0 ? (servingWeight / totalYield) : 0

  return {
    servingSizeG: servingWeight,
    energyKcal: sumEnergy * multiplier,
    proteinG: sumProtein * multiplier,
    fatG: sumFat * multiplier,
    carbG: sumCarb * multiplier,
    fiberG: sumFiber * multiplier,
    sugarG: sumSugar * multiplier,
    sodiumMg: sumSodium * multiplier
  }
}
