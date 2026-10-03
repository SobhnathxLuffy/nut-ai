import { estimateOilAbsorption } from './oil.js'

export * from './oil.js'

export interface RecipeIngredient {
  readonly foodId: string
  readonly gramWeight: number
  readonly energyKcal: number | null
  readonly proteinG: number | null
  readonly fatG: number | null
  readonly carbG: number | null
  readonly fiberG: number | null
  readonly sugarG: number | null
  readonly sodiumMg: number | null
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
  readonly energyKcal: number | null
  readonly proteinG: number | null
  readonly fatG: number | null
  readonly carbG: number | null
  readonly fiberG: number | null
  readonly sugarG: number | null
  readonly sodiumMg: number | null
}

// 902 kcal / 100g = 9.02 kcal/g for pure fat/oil
const OIL_KCAL_PER_G = 9.02

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number`)
  }
}

function requireNullableNonNegative(value: number | null, field: string): void {
  if (value !== null) requireFiniteNonNegative(value, field)
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
    requireNullableNonNegative(ingredient.energyKcal, 'ingredient.energyKcal')
    requireNullableNonNegative(ingredient.proteinG, 'ingredient.proteinG')
    requireNullableNonNegative(ingredient.fatG, 'ingredient.fatG')
    requireNullableNonNegative(ingredient.carbG, 'ingredient.carbG')
    requireNullableNonNegative(ingredient.fiberG, 'ingredient.fiberG')
    requireNullableNonNegative(ingredient.sugarG, 'ingredient.sugarG')
    requireNullableNonNegative(ingredient.sodiumMg, 'ingredient.sodiumMg')
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
  const known = { energy: true, protein: true, fat: true, carb: true, fiber: true, sugar: true, sodium: true }

  for (const ing of version.ingredients) {
    const factor = ing.gramWeight / 100.0
    if (ing.energyKcal === null) known.energy = false; else sumEnergy += ing.energyKcal * factor
    if (ing.proteinG === null) known.protein = false; else sumProtein += ing.proteinG * factor
    if (ing.fatG === null) known.fat = false; else sumFat += ing.fatG * factor
    if (ing.carbG === null) known.carb = false; else sumCarb += ing.carbG * factor
    if (ing.fiberG === null) known.fiber = false; else sumFiber += ing.fiberG * factor
    if (ing.sugarG === null) known.sugar = false; else sumSugar += ing.sugarG * factor
    if (ing.sodiumMg === null) known.sodium = false; else sumSodium += ing.sodiumMg * factor
  }

  // Add oil nutrients. Owner QA 2026-10 oil semantics: `preparation: 'fried'`
  // means the oil was poured into a pan and only part of it stays with the
  // food — charge the ABSORBED subset (one shared model, estimateOilAbsorption
  // in oil.ts), not the full pour. Boiled/roasted/raw preparations consume
  // their fat (tadka, dressing, ghee finish) and stay at 100%.
  const ingredientMassG = version.ingredients.reduce((sum, ing) => sum + ing.gramWeight, 0)
  const oilAbsorption = estimateOilAbsorption({
    usedGrams: version.addedOilG,
    rawFoodGrams: ingredientMassG,
    frying: version.preparation === 'fried',
  })
  const effectiveOilG = oilAbsorption.frying ? oilAbsorption.absorbedMid : version.addedOilG
  if (effectiveOilG > 0) {
    sumEnergy += effectiveOilG * OIL_KCAL_PER_G
    sumFat += effectiveOilG
  }

  const totalYield = version.finalCookedWeightG
  const servingWeight = totalYield / version.servings
  const multiplier = totalYield > 0 ? (servingWeight / totalYield) : 0

  return {
    servingSizeG: servingWeight,
    energyKcal: known.energy ? sumEnergy * multiplier : null,
    proteinG: known.protein ? sumProtein * multiplier : null,
    fatG: known.fat ? sumFat * multiplier : null,
    carbG: known.carb ? sumCarb * multiplier : null,
    fiberG: known.fiber ? sumFiber * multiplier : null,
    sugarG: known.sugar ? sumSugar * multiplier : null,
    sodiumMg: known.sodium ? sumSodium * multiplier : null
  }
}
