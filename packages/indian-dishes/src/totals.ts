import type { DishDefinition } from '@nutai/core-schema'
import type { DbAdapter } from '@nutai/db-adapter'
import { dishIsFried, estimateOilAbsorption, type OilAbsorptionEstimate } from '@nutai/recipe-engine'

export interface DishTotalOptions {
  dish: DishDefinition
  nutritionDb: DbAdapter
  ifctDb?: DbAdapter
  servings?: number
}

export interface DishOilSemantics extends OilAbsorptionEstimate {
  /** Grams for THIS serving (the estimate input is per-100 g of raw batch). */
  usedGramsPerServing: number
  absorbedLowPerServing: number
  absorbedMidPerServing: number
  absorbedHighPerServing: number
}

export interface DishNutritionTotal {
  servingSizeG: number
  energyKcal: number | null
  proteinG: number | null
  fatG: number | null
  carbG: number | null
  fiberG: number | null
  sugarG: number | null
  sodiumMg: number | null
  /**
   * Owner QA 2026-10: the "Fat used" number and the "frying oil absorption"
   * open unknown were contradictory — full pan oil charged as eaten while the
   * card admitted absorption was unknown. Present on fried dishes: nutrition
   * charges the ABSORBED mid; used vs absorbed (range, confidence) travels
   * with the number. Null on dishes whose fat is fully consumed (tadka,
   * ghee-finished, simmered) — there is nothing uncertain to report.
   */
  oilSemantics: DishOilSemantics | null
}

interface FoodRow {
  energy_kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

const MAPPED = new Set(['AUTO_MAPPED', 'MANUAL_OVERRIDE', 'mapped'])

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function finiteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

async function loadMappedFood(
  nutritionDb: DbAdapter,
  ifctDb: DbAdapter | undefined,
  foodId: string,
): Promise<FoodRow | null> {
  const fields = 'energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg'
  if (foodId.startsWith('ifct:')) {
    if (!ifctDb) throw new Error(`IFCT database is required for ${foodId}`)
    return ifctDb.get<FoodRow>(`SELECT ${fields} FROM foods WHERE source = 'ifct' AND source_id = ?`, [foodId.slice(5)])
  }
  if (foodId.startsWith('usda:')) {
    return nutritionDb.get<FoodRow>(`SELECT ${fields} FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?`, [foodId.slice(5)])
  }
  throw new Error(`Unsupported source-qualified food ID: ${foodId}`)
}

/**
 * Compute a reviewed dish from ingredient rows, verified ratios, cooked yield,
 * and verified portion weight. Draft templates fail closed. Missing nutrients
 * propagate as unknown rather than being converted to zero.
 */
export async function computeDishNutrition({
  dish,
  nutritionDb,
  ifctDb,
  servings = 1,
}: DishTotalOptions): Promise<DishNutritionTotal> {
  if (!finitePositive(servings)) throw new RangeError('servings must be a finite positive number')
  if (dish.provenance?.recordStatus !== 'CURATED' && dish.provenance?.recordStatus !== 'VERIFIED') {
    throw new Error('Dish recipe is not curated for deterministic nutrition')
  }
  if (dish.recipeTemplate.numericRatiosVerified !== true) {
    throw new Error('Dish ingredient ratios are not verified')
  }
  const yieldMultiplier = dish.cooking?.yieldModel?.verifiedNumericYield
  const portionG = dish.portionModel?.standardPortionGrams
  if (!finitePositive(yieldMultiplier)) throw new Error('Dish cooked yield is not verified')
  if (!finitePositive(portionG) || dish.portionModel.standardPortionStatus !== 'verified') {
    throw new Error('Dish standard portion is not verified')
  }

  const components: Array<{ grams: number; food: FoodRow; isFatSlot: boolean }> = []
  let usedFatPer100 = 0
  for (const slot of dish.recipeTemplate.ingredientSlots) {
    const mapping = slot.nutritionMapping
    if (!MAPPED.has(mapping.mappingStatus) || !mapping.canonicalFoodId) {
      throw new Error(`Ingredient slot ${slot.label} is not mapped`)
    }
    if (!slot.amountPrior || slot.amountPrior.verified !== true) {
      throw new Error(`Ingredient ratio for ${slot.label} is not verified`)
    }
    const [low, high] = slot.amountPrior.range
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low) {
      throw new Error(`Ingredient ratio for ${slot.label} is invalid`)
    }
    const food = await loadMappedFood(nutritionDb, ifctDb, mapping.canonicalFoodId)
    if (!food) throw new Error(`Mapped food no longer exists: ${mapping.canonicalFoodId}`)
    const grams = ((low + high) / 2) * 100
    // Fat-variable slots (role or label) are the pan oil the semantics below
    // split into used vs absorbed.
    const isFatSlot = slot.role === 'fat_variable' || /(^|_)(fat|oil|ghee)(_|$)/.test(slot.label)
    if (isFatSlot) usedFatPer100 += grams
    components.push({ grams, food, isFatSlot })
  }
  const rawMass = components.reduce((sum, component) => sum + component.grams, 0)
  if (!finitePositive(rawMass)) throw new Error('Dish recipe has no positive ingredient mass')
  const cookedYieldG = rawMass * yieldMultiplier
  const requestedG = portionG * servings
  const scale = requestedG / cookedYieldG

  // Owner QA 2026-10 oil semantics: on fried dishes the fat slot is "oil in
  // the pan", not "oil eaten". The recipe batch (and therefore the verified
  // yield and every per-serving gram) is unchanged — only the fat slot's
  // NUTRIENT contribution scales down to the absorbed mid.
  const fried = dishIsFried(dish)
  let oilSemantics: DishOilSemantics | null = null
  let fatNutrientFactor = 1
  if (fried && usedFatPer100 > 0) {
    const estimate = estimateOilAbsorption({
      usedGrams: usedFatPer100,
      rawFoodGrams: rawMass - usedFatPer100,
      frying: true,
    })
    fatNutrientFactor = estimate.absorbedMid / usedFatPer100
    oilSemantics = {
      ...estimate,
      usedGramsPerServing: Math.round(usedFatPer100 * scale * 10) / 10,
      absorbedLowPerServing: Math.round(estimate.absorbedLow * scale * 10) / 10,
      absorbedMidPerServing: Math.round(estimate.absorbedMid * scale * 10) / 10,
      absorbedHighPerServing: Math.round(estimate.absorbedHigh * scale * 10) / 10,
    }
  }

  const nutrient = (key: keyof FoodRow): number | null => {
    if (components.some((component) => !finiteNonNegative(component.food[key]))) return null
    const value = components.reduce(
      (sum, component) => sum + component.food[key]! * (component.isFatSlot ? component.grams * fatNutrientFactor : component.grams) / 100,
      0,
    ) * scale
    return Number.isFinite(value) ? value : null
  }
  return {
    servingSizeG: requestedG,
    energyKcal: nutrient('energy_kcal'),
    proteinG: nutrient('protein_g'),
    fatG: nutrient('fat_g'),
    carbG: nutrient('carb_g'),
    fiberG: nutrient('fiber_g'),
    sugarG: nutrient('sugar_g'),
    sodiumMg: nutrient('sodium_mg'),
    oilSemantics,
  }
}
