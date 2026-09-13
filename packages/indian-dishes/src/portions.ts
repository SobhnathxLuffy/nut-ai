import type { DishDefinition } from '@nutai/core-schema'

export interface PortionResult {
  grams: number
  pathway: string
  confidence: number // 0-1
}

/**
 * Calculates mass from food-family-specific portion strategies.
 * e.g., '1 dosa (8 inch)', '1 katori dal'.
 */
export function estimatePortion(
  dish: DishDefinition,
  strategyId: string,
  quantity: number = 1
): PortionResult | null {
  if (!dish.portionModel || !dish.portionModel.strategies) {
    return null
  }

  const strategy = dish.portionModel.strategies.find(s => s === strategyId)
  if (!strategy) {
    return null
  }

  // Linear scaling by quantity if standard portion grams exist
  const grams = dish.portionModel.standardPortionGrams ? dish.portionModel.standardPortionGrams * quantity : 100 * quantity

  return {
    grams,
    pathway: `dish_portion:${strategy}`,
    confidence: 0.85
  }
}

/**
 * Get all available portion strategies for a dish.
 */
export function getPortionStrategies(dish: DishDefinition): string[] {
  return dish.portionModel?.strategies || []
}
