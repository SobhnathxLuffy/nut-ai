import type { DbAdapter } from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'

export interface BaseIngredientOption {
  optionId: string
  label: string
  foodId: string
  defaultRawGrams: number
}

export interface FatOption {
  optionId: string
  label: string
  foodId: string | null
  defaultGrams: number
}

export interface GenericYieldPrior {
  assumptionClass: 'GENERIC_PRIOR'
  foodFamilyFallback: 'universal' // Extensible for 'battered_vegetable', 'filled_pastry', etc.
  moistureLossFraction?: number
  oilAbsorptionFraction?: number
  waterYieldModifier?: number
}

export interface CookingMethodOption {
  label: string
  method: 'curried' | 'sauteed' | 'deep_fried' | 'roasted' | 'boiled'
  yieldMultiplier: number
  yieldPrior?: GenericYieldPrior
}

export const COMMON_BASE_INGREDIENTS: BaseIngredientOption[] = [
  { optionId: 'lauki', label: 'Bottle Gourd (Lauki / Ghiya)', foodId: 'ifct:D008', defaultRawGrams: 150 },
  { optionId: 'jackfruit-raw', label: 'Jackfruit (Kathal)', foodId: 'ifct:D051', defaultRawGrams: 150 },
  { optionId: 'potato', label: 'Potato (Aloo)', foodId: 'ifct:F006', defaultRawGrams: 120 },
  { optionId: 'cauliflower', label: 'Cauliflower (Gobi)', foodId: 'ifct:D036', defaultRawGrams: 120 },
  { optionId: 'brinjal', label: 'Brinjal / Eggplant (Baingan)', foodId: 'ifct:D010', defaultRawGrams: 150 },
  { optionId: 'okra', label: 'Okra / Ladyfinger (Bhindi)', foodId: 'ifct:D056', defaultRawGrams: 120 },
  { optionId: 'spinach', label: 'Spinach (Palak)', foodId: 'ifct:C033', defaultRawGrams: 150 },
  { optionId: 'paneer', label: 'Paneer (Cottage Cheese)', foodId: 'ifct:L003', defaultRawGrams: 100 },
  { optionId: 'chicken-leg-skinless', label: 'Chicken, leg, skinless', foodId: 'ifct:N001', defaultRawGrams: 150 },
  { optionId: 'egg-whole-raw', label: 'Egg, whole, raw', foodId: 'ifct:M001', defaultRawGrams: 100 },
  { optionId: 'red-gram-dal', label: 'Toor dal (Red gram)', foodId: 'ifct:B021', defaultRawGrams: 60 },
  { optionId: 'bengal-gram-dal', label: 'Bengal gram dal', foodId: 'ifct:B001', defaultRawGrams: 60 },
  { optionId: 'atta', label: 'Wheat Flour (Atta)', foodId: 'ifct:A019', defaultRawGrams: 60 },
  { optionId: 'rice-raw-milled', label: 'White Rice, raw', foodId: 'ifct:A015', defaultRawGrams: 60 },
]

export const COOKING_FAT_OPTIONS: FatOption[] = [
  { optionId: 'mustard-oil-14g', label: 'Mustard Oil (1 tbsp / 14g)', foodId: 'ifct:T006', defaultGrams: 14 },
  { optionId: 'ghee-14g', label: 'Ghee (1 tbsp / 14g)', foodId: 'ifct:T013', defaultGrams: 14 },
  { optionId: 'sunflower-oil-14g', label: 'Sunflower Oil (1 tbsp / 14g)', foodId: 'ifct:T012', defaultGrams: 14 },
  { optionId: 'sunflower-oil-5g', label: 'Light Oil / Tadka (1 tsp / 5g)', foodId: 'ifct:T012', defaultGrams: 5 },
  { optionId: 'no-added-oil', label: 'No Added Oil / Dry Roasted', foodId: null, defaultGrams: 0 },
]

export const COOKING_METHOD_OPTIONS: CookingMethodOption[] = [
  { label: 'Curried / Gravy (Simmered with water & spices)', method: 'curried', yieldMultiplier: 1.25, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', waterYieldModifier: 1.25 } },
  { label: 'Sautéed / Dry Sabzi (Stir fried)', method: 'sauteed', yieldMultiplier: 0.85, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', moistureLossFraction: 0.15 } },
  { label: 'Deep Fried (Fritters, snacks)', method: 'deep_fried', yieldMultiplier: 0.80, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', moistureLossFraction: 0.30, oilAbsorptionFraction: 0.10 } },
  { label: 'Dry Roasted / Tandoor', method: 'roasted', yieldMultiplier: 0.75, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', moistureLossFraction: 0.25 } },
  { label: 'Boiled / Steamed', method: 'boiled', yieldMultiplier: 1.05, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', waterYieldModifier: 1.05 } },
]

export interface UnknownDishDecompositionInput {
  dishName: string
  baseIngredientId: string
  baseIngredientGrams: number
  fatId: string | null
  fatGrams: number
  secondaryIngredientId?: string | null
  secondaryIngredientGrams?: number
  cookingMethod: 'curried' | 'sauteed' | 'deep_fried' | 'roasted' | 'boiled'
  customYieldMultiplier?: number
  portionGrams?: number
}

export interface UnknownDishNutritionResult {
  dishName: string
  rawMassGrams: number
  cookedYieldGrams: number
  portionGrams: number
  per100g: NutrientRow100g
  serving: NutrientRow100g
  isEstimate: true
  assumptions: string[]
}

interface FoodNutrientRow {
  energy_kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

async function fetchNutrientRow(
  foodId: string,
  nutritionDb: DbAdapter,
  ifctDb?: DbAdapter,
): Promise<FoodNutrientRow | null> {
  const fields = 'energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg'
  if (foodId.startsWith('ifct:')) {
    if (!ifctDb) return null
    return ifctDb.get<FoodNutrientRow>(`SELECT ${fields} FROM foods WHERE source = 'ifct' AND source_id = ?`, [foodId.slice(5)])
  }
  if (foodId.startsWith('usda:')) {
    return nutritionDb.get<FoodNutrientRow>(`SELECT ${fields} FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?`, [foodId.slice(5)])
  }
  return null
}

/**
 * Computes deterministic nutrition for an unknown dish using ingredient decomposition.
 * Fully arithmetic: ingredient weights × nutrient rows × yield multiplier × portion weight.
 * No flat or fabricated calories.
 */
export async function computeUnknownDishNutrition(
  input: UnknownDishDecompositionInput,
  nutritionDb: DbAdapter,
  ifctDb?: DbAdapter,
): Promise<UnknownDishNutritionResult> {
  const ingredients: Array<{ foodId: string; grams: number }> = [
    { foodId: input.baseIngredientId, grams: input.baseIngredientGrams },
  ]

  let explicitFatGrams = 0
  if (input.fatId && input.fatGrams > 0) {
    ingredients.push({ foodId: input.fatId, grams: input.fatGrams })
    explicitFatGrams = input.fatGrams
  }

  if (input.secondaryIngredientId && (input.secondaryIngredientGrams ?? 0) > 0) {
    ingredients.push({ foodId: input.secondaryIngredientId, grams: input.secondaryIngredientGrams! })
  }

  const rawMassGrams = ingredients.reduce((sum, ing) => sum + ing.grams, 0)
  if (rawMassGrams <= 0) throw new Error('Ingredient mass must be positive')

  let cookedYieldGrams = rawMassGrams
  const methodOpt = COOKING_METHOD_OPTIONS.find((m) => m.method === input.cookingMethod)

  if (methodOpt?.yieldPrior) {
    const prior = methodOpt.yieldPrior
    if (prior.waterYieldModifier) {
      cookedYieldGrams = rawMassGrams * prior.waterYieldModifier
    } else if (prior.moistureLossFraction) {
      cookedYieldGrams = rawMassGrams * (1 - prior.moistureLossFraction)
    }

    if (prior.oilAbsorptionFraction) {
      const absorbedOil = rawMassGrams * prior.oilAbsorptionFraction
      if (absorbedOil > explicitFatGrams) {
        const addedOil = absorbedOil - explicitFatGrams
        const oilId = input.fatId || 'ifct:T012'
        const existing = ingredients.find((i) => i.foodId === oilId)
        if (existing) existing.grams += addedOil
        else ingredients.push({ foodId: oilId, grams: addedOil })
        cookedYieldGrams += addedOil
      }
    }
  }

  if (input.customYieldMultiplier) {
    cookedYieldGrams = rawMassGrams * input.customYieldMultiplier
  }

  const portionGrams = input.portionGrams ?? (cookedYieldGrams > 0 ? cookedYieldGrams : 100)

  const totals: Record<keyof FoodNutrientRow, number> = {
    energy_kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0,
  }
  const known: Record<keyof FoodNutrientRow, boolean> = {
    energy_kcal: true, protein_g: true, fat_g: true, carb_g: true, fiber_g: true, sugar_g: true, sodium_mg: true,
  }

  for (const ing of ingredients) {
    const row = await fetchNutrientRow(ing.foodId, nutritionDb, ifctDb)
    if (!row) throw new Error(`Ingredient ${ing.foodId} is unavailable in the bundled food data`)
    const factor = ing.grams / 100
    for (const key of Object.keys(totals) as Array<keyof FoodNutrientRow>) {
      const value = row[key]
      if (value === null) known[key] = false
      else totals[key] += value * factor
    }
  }

  const scaled = (key: keyof FoodNutrientRow, multiplier: number): number | null =>
    known[key] ? totals[key] * multiplier : null
  const requiredScaled = (key: 'energy_kcal' | 'protein_g' | 'fat_g' | 'carb_g', multiplier: number): number => {
    if (!known[key]) throw new Error(`Core nutrition ${key} is unavailable for an ingredient`)
    return totals[key] * multiplier
  }

  // Per-100g of cooked dish
  const per100Multiplier = 100 / cookedYieldGrams
  const per100g: NutrientRow100g = {
    kcal: requiredScaled('energy_kcal', per100Multiplier),
    protein_g: requiredScaled('protein_g', per100Multiplier),
    fat_g: requiredScaled('fat_g', per100Multiplier),
    carbs_g: requiredScaled('carb_g', per100Multiplier),
    fiber_g: scaled('fiber_g', per100Multiplier),
    sugar_g: scaled('sugar_g', per100Multiplier),
    sodium_mg: scaled('sodium_mg', per100Multiplier),
  }

  // Per requested portion
  const portionMultiplier = portionGrams / cookedYieldGrams
  const serving: NutrientRow100g = {
    kcal: requiredScaled('energy_kcal', portionMultiplier),
    protein_g: requiredScaled('protein_g', portionMultiplier),
    fat_g: requiredScaled('fat_g', portionMultiplier),
    carbs_g: requiredScaled('carb_g', portionMultiplier),
    fiber_g: scaled('fiber_g', portionMultiplier),
    sugar_g: scaled('sugar_g', portionMultiplier),
    sodium_mg: scaled('sodium_mg', portionMultiplier),
  }

  return {
    dishName: input.dishName,
    rawMassGrams,
    cookedYieldGrams,
    portionGrams,
    per100g,
    serving,
    isEstimate: true,
    assumptions: ['Nutrition is estimated from the ingredients and cooking method you selected.'],
  }
}
