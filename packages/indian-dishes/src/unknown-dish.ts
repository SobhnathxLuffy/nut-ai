import type { DbAdapter } from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'
import { estimateOilAbsorption, roundGrams, type OilAbsorptionEstimate } from '@nutai/recipe-engine'

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
  // Groundnut oil and butter cover the remaining curated fat slots (frying
  // oil for snacks, butter for naan/dal makhani) so every recipe fat can be
  // REPRESENTED by the selector instead of silently duplicated next to it.
  { optionId: 'groundnut-oil-14g', label: 'Groundnut Oil (1 tbsp / 14g)', foodId: 'ifct:T005', defaultGrams: 14 },
  { optionId: 'butter-14g', label: 'Butter (1 tbsp / 14g)', foodId: 'usda:173430', defaultGrams: 14 },
  { optionId: 'no-added-oil', label: 'No Added Oil / Dry Roasted', foodId: null, defaultGrams: 0 },
]

export const COOKING_METHOD_OPTIONS: CookingMethodOption[] = [
  { label: 'Curried / Gravy (Simmered with water & spices)', method: 'curried', yieldMultiplier: 1.25, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', waterYieldModifier: 1.25 } },
  { label: 'Sautéed / Dry Sabzi (Stir fried)', method: 'sauteed', yieldMultiplier: 0.85, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', moistureLossFraction: 0.15 } },
  // Owner QA 2026-10: deep-fried dishes no longer add phantom oil on top of
  // the oil the user already counted — estimateOilAbsorption (oil.ts) charges
  // the absorbed SUBSET of the used oil instead.
  { label: 'Deep Fried (Fritters, snacks)', method: 'deep_fried', yieldMultiplier: 0.80, yieldPrior: { assumptionClass: 'GENERIC_PRIOR', foodFamilyFallback: 'universal', moistureLossFraction: 0.30 } },
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
  /**
   * Additional ingredients beyond the primary/secondary pair. A real dish has
   * more than two components — the decomposer accepts the full list, dedupes
   * by foodId (summing grams), and folds everything into the same arithmetic.
   * `userfood:` IDs are allowed: custom ingredients the user created live in
   * the user DB and participate exactly like corpus rows.
   */
  extraIngredients?: Array<{ foodId: string; grams: number }>
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
  /**
   * Owner QA 2026-10: used-vs-absorbed pan oil, present when the decomposition
   * is deep-fried with an explicit fat — nutrition charges the absorbed mid.
   */
  oilSemantics: OilAbsorptionEstimate | null
  /**
   * Per-ingredient contribution to the REQUESTED PORTION (grams as entered;
   * kcal/macros scaled by portion/cookedYield so the breakdown sums to the
   * serving numbers). Ingredients whose nutrient rows are null propagate null.
   */
  ingredientBreakdown: Array<{
    foodId: string
    grams: number
    kcal: number | null
    protein_g: number | null
    carbs_g: number | null
    fat_g: number | null
  }>
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
  userDb?: DbAdapter,
): Promise<FoodNutrientRow | null> {
  const fields = 'energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg'
  if (foodId.startsWith('ifct:')) {
    if (!ifctDb) return null
    return ifctDb.get<FoodNutrientRow>(`SELECT ${fields} FROM foods WHERE source = 'ifct' AND source_id = ?`, [foodId.slice(5)])
  }
  if (foodId.startsWith('usda:')) {
    return nutritionDb.get<FoodNutrientRow>(`SELECT ${fields} FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?`, [foodId.slice(5)])
  }
  if (foodId.startsWith('userfood:')) {
    // Custom ingredients created by the user are stored per-100 g in user_foods.
    if (!userDb) return null
    return userDb.get<FoodNutrientRow>(`SELECT ${fields} FROM user_foods WHERE uuid = ? AND deleted_at IS NULL`, [foodId.slice('userfood:'.length)])
  }
  return null
}

/**
 * The single cooked-yield model shared by the decomposer and the dish
 * composer: water-adding methods scale the pot UP, moisture-loss methods
 * shrink it. One model, two UIs, zero drift.
 *
 * Owner QA 2026-10: this model USED to add "absorbed oil beyond what the user
 * counted" to the yield while nutrition charged the full used oil — a
 * double-charging contradiction. Oil absorption now lives in ONE place
 * (estimateOilAbsorption, oil.ts): the used fat is part of the pan batch for
 * yield purposes, and only its absorbed subset is charged as eaten.
 */
export function resolveCookedYieldGrams(
  rawMassGrams: number,
  method: UnknownDishDecompositionInput['cookingMethod'],
): { cookedYieldGrams: number } {
  const methodOpt = COOKING_METHOD_OPTIONS.find((m) => m.method === method)
  const prior = methodOpt?.yieldPrior
  let cookedYieldGrams = rawMassGrams

  if (prior?.waterYieldModifier) {
    cookedYieldGrams = rawMassGrams * prior.waterYieldModifier
  } else if (prior?.moistureLossFraction) {
    cookedYieldGrams = rawMassGrams * (1 - prior.moistureLossFraction)
  }

  return { cookedYieldGrams }
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
  userDb?: DbAdapter,
): Promise<UnknownDishNutritionResult> {
  const merged = new Map<string, number>()
  const addIngredient = (foodId: string, grams: number): void => {
    if (!Number.isFinite(grams) || grams <= 0) return
    merged.set(foodId, (merged.get(foodId) ?? 0) + grams)
  }
  addIngredient(input.baseIngredientId, input.baseIngredientGrams)
  if (input.fatId && input.fatGrams > 0) addIngredient(input.fatId, input.fatGrams)
  if (input.secondaryIngredientId) addIngredient(input.secondaryIngredientId, input.secondaryIngredientGrams ?? 0)
  for (const extra of input.extraIngredients ?? []) addIngredient(extra.foodId, extra.grams)

  const explicitFatGrams = input.fatId && input.fatGrams > 0 ? input.fatGrams : 0
  const ingredients = [...merged.entries()].map(([foodId, grams]) => ({
    foodId,
    grams,
    row: null as FoodNutrientRow | null,
  }))

  const rawMassGrams = ingredients.reduce((sum, ing) => sum + ing.grams, 0)
  if (rawMassGrams <= 0) throw new Error('Ingredient mass must be positive')

  // Owner QA 2026-10 oil semantics: for deep-fried decompositions the user's
  // fat is "oil in the pan", not "oil eaten" — only the absorbed subset is
  // charged. One model everywhere: estimateOilAbsorption (oil.ts).
  const oilAbsorption = estimateOilAbsorption({
    usedGrams: explicitFatGrams,
    rawFoodGrams: Math.max(rawMassGrams - explicitFatGrams, 0),
    frying: input.cookingMethod === 'deep_fried' && explicitFatGrams > 0,
  })

  let cookedYieldGrams: number
  if (input.customYieldMultiplier) {
    cookedYieldGrams = rawMassGrams * input.customYieldMultiplier
  } else {
    cookedYieldGrams = resolveCookedYieldGrams(rawMassGrams, input.cookingMethod).cookedYieldGrams
  }

  // The oil ingredient's EFFECTIVE grams are the absorbed subset — the rest
  // of the poured oil stays in the kadhai and is not eaten. The pan batch
  // (and therefore the yield) is unchanged.
  if (oilAbsorption.frying && oilAbsorption.absorbedMid < explicitFatGrams) {
    const factor = oilAbsorption.absorbedMid / explicitFatGrams
    const oilEntry = ingredients.find((i) => i.foodId === input.fatId)
    if (oilEntry) oilEntry.grams *= factor
  }

  const portionGrams = input.portionGrams ?? (cookedYieldGrams > 0 ? cookedYieldGrams : 100)

  const totals: Record<keyof FoodNutrientRow, number> = {
    energy_kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0,
  }
  const known: Record<keyof FoodNutrientRow, boolean> = {
    energy_kcal: true, protein_g: true, fat_g: true, carb_g: true, fiber_g: true, sugar_g: true, sodium_mg: true,
  }

  for (const ing of ingredients) {
    const row = await fetchNutrientRow(ing.foodId, nutritionDb, ifctDb, userDb)
    if (!row) throw new Error(`Ingredient ${ing.foodId} is unavailable in the bundled food data`)
    ing.row = row
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

  // Per-ingredient contribution to the requested portion.
  const ingredientBreakdown = ingredients.map((ing) => {
    const factor = (ing.grams / 100) * portionMultiplier
    const row = ing.row!
    const at = (key: keyof FoodNutrientRow): number | null =>
      row[key] === null || factor <= 0 ? (row[key] === null ? null : 0) : row[key]! * factor
    return {
      foodId: ing.foodId,
      grams: ing.grams,
      kcal: at('energy_kcal'),
      protein_g: at('protein_g'),
      carbs_g: at('carb_g'),
      fat_g: at('fat_g'),
    }
  })

  const assumptions = ['Nutrition is estimated from the ingredients and cooking method you selected.']
  if (oilAbsorption.frying) {
    assumptions.push(
      `Oil in the pan: ${roundGrams(oilAbsorption.usedGrams)} g — an estimated ${roundGrams(oilAbsorption.absorbedLow)}–${roundGrams(oilAbsorption.absorbedHigh)} g is absorbed by the food (medium confidence); the rest stays in the kadhai and is not counted as eaten.`,
    )
  }

  return {
    dishName: input.dishName,
    rawMassGrams,
    cookedYieldGrams,
    portionGrams,
    per100g,
    serving,
    isEstimate: true,
    assumptions,
    oilSemantics: oilAbsorption.frying ? oilAbsorption : null,
    ingredientBreakdown,
  }
}
