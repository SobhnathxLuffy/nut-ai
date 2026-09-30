/**
 * Dish-portion hints — the bridge from a DishDefinition's curated portion
 * model to the scan-time gram ladder.
 *
 * Task 2-c. The Dish KB stores a curated `standardPortionGrams` per dish
 * (verified by the curation pass), but that number never reached the gram
 * engine: the scan path had no way to carry "1 Plain Dosa = 80 g, curated"
 * from the KB into the portion estimate. `portionHintsForDish` converts the
 * portion model into the PortionHint wire shape ({ unit, typical, min, max,
 * source }) that the DishKB source attaches to its resolved foods, the
 * resolver exposes as ResolvedFood.portionHints, the pipeline spreads into
 * ResolvedRow, and the gram engine's population-prior tier consumes.
 *
 * HONESTY RULES:
 *   - The TYPICAL grams are the KB's curated number, never rewritten here.
 *   - The KB carries no measured spread, so the range is a WIDENED envelope
 *     (±25%) around the curated number, and the source string says so. This
 *     mirrors the tightest honest ranges in the @nutai/portion-priors
 *     population dataset — it is a disclosure of "single curated point value",
 *     not a fabricated distribution.
 *   - The unit label is BEST-EFFORT: the KB stores strategies, not a household
 *     unit. The grams are the payload; the label only helps the UI and the
 *     gram engine's count logic.
 */

/**
 * The structural twin of @nutai/portion-priors' PortionHint. Declared locally,
 * not imported, because @nutai/indian-dishes is built ahead of that package in
 * the tools build chain (`npm run build:tools-pkgs`) and must not gain a build
 * order dependency for a type. Structural identity is verified by test in the
 * portion-priors package.
 */
export interface DishPortionHint {
  unit: string
  typical: number
  min: number
  max: number
  source: string
}

/**
 * Widening applied to the curated standard portion, since the KB stores a
 * point value with no measured spread. ±25% covers home-vs-restaurant cooking
 * drift for most dish families without inventing false precision.
 */
export const DISH_PORTION_RANGE_FRACTION = 0.25

/**
 * Below this, a ±25% integer-gram envelope cannot be expressed honestly
 * (min would collide with typical). No curated dish portion is anywhere near
 * this small — the real floor in the manifest is a chutney/pickle serving —
 * so an unusable value yields NO hint rather than a fake range.
 */
export const MIN_DISH_PORTION_HINT_G = 5

/** Loosely-typed portion model: the Dish KB row is parsed from raw JSON. */
export interface DishPortionModelLike {
  strategies?: string[] | null
  standardPortionGrams?: number | null
  standardPortionStatus?: string | null
  assumptionClass?: string | null
}

/**
 * Best-effort household unit for the standard portion, from the curated
 * strategy list. The KB's strategies name HOW the portion is measured
 * (count / katori_volume / plate_volume / measured_g, ...), not a unit — this
 * maps the strongest signal to the PortionUnit vocabulary.
 *
 * Deliberate orderings (checked against the 362-dish manifest):
 *   - katori_volume before piece: dal/chole/khichdi list both and the standard
 *     portion is the katori (150-250 g), not a piece.
 *   - piece BEFORE bowl: Gulab Jamun lists bowl_volume (the syrup bowl) after
 *     count — the standard 50 g is the piece.
 *   - katori only up to 250 g: a 300 g biryani "plate" is not a katori even
 *     though katori_volume appears as a secondary strategy.
 */
export function householdUnitForStrategies(
  strategies: readonly string[] | null | undefined,
  standardPortionGrams: number,
): string {
  const has = (s: string): boolean => strategies?.includes(s) ?? false
  if (has('katori_volume') && standardPortionGrams <= 250) return 'katori'
  const pieceStrategy =
    has('count') || has('piece_count') || has('piece_weight_g') || has('paneer_cube_count')
  if (pieceStrategy && standardPortionGrams <= 150) return 'piece'
  if (has('bowl_volume') && standardPortionGrams <= 400) return 'bowl'
  if (has('glass_volume') || has('ml')) return 'cup'
  if (has('ladle') || has('serving_spoon')) return 'ladle'
  return 'serving'
}

/**
 * Convert a dish's portion model into the PortionHint wire shape. Returns an
 * empty array (never null) when the dish has no usable curated portion — an
 * absent hint is honest, a zero-gram hint is not.
 */
export function portionHintsForDish(dish: {
  canonicalName?: string | null
  portionModel?: DishPortionModelLike | null
}): DishPortionHint[] {
  const std = dish.portionModel?.standardPortionGrams
  if (typeof std !== 'number' || !Number.isFinite(std) || std < MIN_DISH_PORTION_HINT_G) return []

  const fraction = DISH_PORTION_RANGE_FRACTION
  const typical = Math.round(std)
  let min = Math.max(1, Math.round(std * (1 - fraction)))
  let max = Math.max(min + 1, Math.round(std * (1 + fraction)))
  // Rounding must never collapse the envelope onto the point value.
  if (min >= typical) min = typical - 1
  if (max <= typical) max = typical + 1
  const unit = householdUnitForStrategies(dish.portionModel?.strategies, std)

  const status = dish.portionModel?.standardPortionStatus ?? 'unknown'
  const assumption = dish.portionModel?.assumptionClass
  const name = dish.canonicalName ?? 'unknown dish'
  const source =
    `Nut AI Dish KB v0.1: curated standard portion for "${name}" ` +
    `(status: ${status}${assumption ? `, ${assumption}` : ''}; range widened ±25%)`

  return [{ unit, typical, min, max, source }]
}
