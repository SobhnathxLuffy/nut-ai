import type { DishDefinition } from '@nutai/core-schema'
import type { DbAdapter } from '@nutai/db-adapter'

export interface DishTotalOptions {
  dish: DishDefinition
  nutritionDb: DbAdapter
  ifctDb?: DbAdapter
  servings?: number
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

  const components: Array<{ grams: number; food: FoodRow }> = []
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
    components.push({ grams: ((low + high) / 2) * 100, food })
  }
  const rawMass = components.reduce((sum, component) => sum + component.grams, 0)
  if (!finitePositive(rawMass)) throw new Error('Dish recipe has no positive ingredient mass')
  const cookedYieldG = rawMass * yieldMultiplier
  const requestedG = portionG * servings
  const scale = requestedG / cookedYieldG

  const nutrient = (key: keyof FoodRow): number | null => {
    if (components.some((component) => !finiteNonNegative(component.food[key]))) return null
    const value = components.reduce((sum, component) => sum + component.food[key]! * component.grams / 100, 0) * scale
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
  }
}
