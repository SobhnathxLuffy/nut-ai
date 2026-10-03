/**
 * Oil semantics — the one model that decides how much pan oil is actually
 * EATEN (owner QA 2026-10: "Fat used (g) = 13.4" next to "Open unknowns:
 * Frying oil absorption" was a contradiction. If the app counts all 13.4 g of
 * sunflower oil as eaten, the honesty system quietly turns pan oil into body
 * oil "with bureaucratic efficiency").
 *
 * THE MODEL:
 *
 *   Oil used (in the pan)  →  oil actually absorbed by the food.
 *
 *   Non-fried dishes (tadka, ghee finish, simmered curries) consume
 *   essentially all of their fat — absorbed = used, high confidence.
 *
 *   Fried dishes (cook_or_fry / deep_fried) lose most of the pan oil back to
 *   the kadhai/plate: published shallow-fry absorption sits at roughly
 *   35–65% of the oil actually applied to the food, and no food can carry
 *   more than ~28% of its own weight in oil (the ceiling the confidence
 *   engine already quotes: "Fried food absorbs 10-28% of its weight").
 *
 *   Nutrition charges the absorbed MID; the honest range and the confidence
 *   travel with the number wherever it is displayed.
 *
 * CONSUMERS (one model, every surface):
 *   - computeDishNutrition (totals.ts) — the curated dish KB numbers.
 *   - computeUnknownDishNutrition (unknown-dish.ts) — the decomposer.
 *   - computeRecipeServing (recipe-engine) — household recipes (fried only).
 *   - the dish composer / food-search decomposer UIs show
 *     "Oil in the pan" vs "Estimated absorbed by the food".
 *
 * ZERO imports, zero React Native — pure arithmetic, node-purity safe.
 */

/** Fraction of the USED oil the food absorbs when fried (owner spec:
 * "Oil used: 14 g → Estimated absorbed: 5–9 g" ≈ 35–65%). */
export const FRYING_ABSORBED_FRACTION_OF_USED = { low: 0.35, high: 0.65 } as const

/** Physical ceiling: no food carries more than ~28% of its own weight in
 * absorbed oil (matches the confidence engine's "Fried food absorbs 10-28%
 * of its weight" copy). */
export const FRYING_ABSORBED_CEILING_OF_FOOD_MASS = 0.28 as const

export interface OilAbsorptionEstimate {
  /** False → the used oil is the eaten oil (tadka / ghee / simmered). */
  frying: boolean
  /** Oil added to the pan (per serving or per batch — the units are the
   * caller's; the ratios are unit-free). */
  usedGrams: number
  /** What the food actually takes up: point value + honest range. */
  absorbedLow: number
  absorbedMid: number
  absorbedHigh: number
  /** 'high' = non-fried (all of it is eaten); 'medium' = fried range. */
  confidence: 'high' | 'medium'
}

export function estimateOilAbsorption(input: {
  usedGrams: number
  /** Mass of the FOOD (everything except the added fat) in the same units. */
  rawFoodGrams: number
  frying: boolean
}): OilAbsorptionEstimate {
  const used = Number.isFinite(input.usedGrams) && input.usedGrams > 0 ? input.usedGrams : 0
  if (!input.frying || used <= 0) {
    return { frying: false, usedGrams: used, absorbedLow: used, absorbedMid: used, absorbedHigh: used, confidence: 'high' }
  }
  // The food cannot absorb more oil than was poured, and cannot carry more
  // than its own-weight ceiling.
  const ceiling = Number.isFinite(input.rawFoodGrams) && input.rawFoodGrams > 0
    ? input.rawFoodGrams * FRYING_ABSORBED_CEILING_OF_FOOD_MASS
    : used
  const low = Math.min(used * FRYING_ABSORBED_FRACTION_OF_USED.low, used, ceiling)
  const high = Math.min(used * FRYING_ABSORBED_FRACTION_OF_USED.high, used, ceiling)
  return {
    frying: true,
    usedGrams: used,
    // UNROUNDED: the model must stay exactly scale-free — a per-100 g batch
    // computation and a per-serving computation must produce the SAME factor,
    // or the engine and the composer drift by half-kcals. Display sites round
    // via roundGrams(); arithmetic never does.
    absorbedLow: low,
    absorbedMid: (low + high) / 2,
    absorbedHigh: high,
    confidence: 'medium',
  }
}

/** One-decimal gram rounding for DISPLAY of an absorption estimate. */
export function roundGrams(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Does this dish FRY? The cooking methods are the primary signal
 * (`cook_or_fry` is the street-snack method string, `deep_fried` the
 * decomposer's); the uncertainty model's own `frying_oil_absorption` unknown
 * is the honest fallback — a dish that admits frying-oil absorption is its
 * top unknown IS a fried dish.
 */
export function dishIsFried(dish: {
  cooking?: { methods?: readonly string[] | null } | null | undefined
  uncertaintyModel?: { highImpactUnknowns?: readonly string[] | null } | null | undefined
} | null | undefined): boolean {
  if (!dish) return false
  const methods = dish.cooking?.methods ?? []
  if (methods.includes('cook_or_fry') || methods.includes('deep_fried') || methods.includes('fry')) return true
  return (dish.uncertaintyModel?.highImpactUnknowns ?? []).includes('frying_oil_absorption')
}
