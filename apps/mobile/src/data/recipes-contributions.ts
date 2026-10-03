import type { RecipeIngredientDraft } from './recipes'

/**
 * Per-ingredient contributed macros for household recipes (Wave 5A, item O3 —
 * AGENTS.md §0.2: "recipe ingredient rows still do not show per-ingredient
 * contributed macros inline").
 *
 * The arithmetic REUSES the recipe engine's serving math rather than
 * re-deriving it: `computeRecipeServing` sums each ingredient as
 * `per-100g × grams / 100`, adds the oil, then scales the whole batch by
 * `servingWeight / yield` (= 1 / servings). Contributions apply the same
 * per-ingredient factor and the same multiplier, so the caption numbers sit in
 * the SAME frame as the totals the recipe screen displays and logs — one
 * serving. This mirrors the unknown-dish decomposer's `ingredientBreakdown`
 * (packages/indian-dishes/src/unknown-dish.ts: "kcal/macros scaled by
 * portion/cookedYield so the breakdown sums to the serving numbers"), which is
 * the app's established per-ingredient breakdown pattern.
 *
 * Unknown is not zero (AGENTS.md §5.2): a missing per-100g macro stays `null`
 * in the contribution and null-propagates through the sum, exactly as
 * `computeRecipeServing` nulls an aggregate when any ingredient lacks it.
 */

/** The per-100g macro fields the caption needs — `Pick`ed so `RecipeDraft`/`EditableRecipe` ingredients are always structural matches. */
export type ContributionIngredient = Pick<
  RecipeIngredientDraft,
  'foodId' | 'displayName' | 'gramWeight' | 'energyKcal' | 'proteinG' | 'carbG' | 'fatG'
>

/**
 * Structural input so one helper serves both render paths: a saved recipe
 * (`RecipeDraft` / `EditableRecipe` satisfies this) and the editor's live
 * form (parsed from the text inputs by the caller).
 */
export interface RecipeContributionSource {
  readonly servings: number
  readonly finalCookedWeightG: number
  readonly ingredients: readonly ContributionIngredient[]
}

/** One ingredient's contributed macros, in the one-serving frame. */
export interface RecipeIngredientContribution {
  readonly id: string
  readonly name: string
  /** Grams as entered for this ingredient (raw amount, NOT serving-scaled). */
  readonly grams: number
  readonly kcal: number | null
  readonly protein: number | null
  readonly carbs: number | null
  readonly fat: number | null
}

/** Null-propagating macro sum (the sum-check against the recipe totals). */
export interface ContributionSum {
  readonly kcal: number | null
  readonly protein: number | null
  readonly carbs: number | null
  readonly fat: number | null
}

export function ingredientContributions(recipe: RecipeContributionSource): RecipeIngredientContribution[] {
  const { servings, finalCookedWeightG: yieldGrams } = recipe
  // The engine's exact multiplier expression (computeRecipeServing:
  // servingWeight = yield / servings; totals × servingWeight / yield — which
  // cancels to 1 / servings). Saved recipes always pass validateRecipeVersion,
  // so the first branch is the engine-identical path. Degraded editor states
  // (blank/zero yield or servings) must not throw (AGENTS.md §8.3): a blank
  // yield keeps 1 / servings, and invalid servings fall back to the
  // whole-recipe frame until the draft becomes saveable.
  const multiplier = yieldGrams > 0 && servings > 0
    ? (yieldGrams / servings) / yieldGrams
    : servings > 0 ? 1 / servings : 1
  return recipe.ingredients.map((ingredient) => {
    const factor = (ingredient.gramWeight / 100) * multiplier
    return {
      id: ingredient.foodId,
      name: ingredient.displayName,
      grams: ingredient.gramWeight,
      kcal: ingredient.energyKcal === null ? null : ingredient.energyKcal * factor,
      protein: ingredient.proteinG === null ? null : ingredient.proteinG * factor,
      carbs: ingredient.carbG === null ? null : ingredient.carbG * factor,
      fat: ingredient.fatG === null ? null : ingredient.fatG * factor,
    }
  })
}

/**
 * Sum-check helper: sums the contributions macro-by-macro. A null anywhere
 * nulls that macro for the whole sum — the same "unknown is not zero"
 * propagation `computeRecipeServing` applies to its totals — so
 * `sumIngredientContributions(ingredientContributions(recipe))` plus the oil
 * share (the engine's `computeRecipeServing(recipe)` minus
 * `computeRecipeServing({ ...recipe, addedOilG: 0 })`) reconciles with the
 * displayed per-serving totals within float tolerance.
 */
export function sumIngredientContributions(contributions: readonly RecipeIngredientContribution[]): ContributionSum {
  let kcal = 0
  let protein = 0
  let carbs = 0
  let fat = 0
  let knownKcal = true
  let knownProtein = true
  let knownCarbs = true
  let knownFat = true
  for (const contribution of contributions) {
    if (contribution.kcal === null) knownKcal = false; else kcal += contribution.kcal
    if (contribution.protein === null) knownProtein = false; else protein += contribution.protein
    if (contribution.carbs === null) knownCarbs = false; else carbs += contribution.carbs
    if (contribution.fat === null) knownFat = false; else fat += contribution.fat
  }
  return {
    kcal: knownKcal ? kcal : null,
    protein: knownProtein ? protein : null,
    carbs: knownCarbs ? carbs : null,
    fat: knownFat ? fat : null,
  }
}

/**
 * Caption text for one ingredient row, shared by the editor and list render
 * paths so they can never drift: `→ 170 kcal · 11.0g P · 30.0g C · 0.5g F`.
 *
 * Rounding matches the surfaces these captions sit beside: kcal with
 * Math.round (the recipe list row and the decomposer's breakdown), P/C/F at
 * one decimal (the decomposer's breakdown and the composite-meal caption).
 * Missing macros degrade the same way the decomposer's breakdown does —
 * 'kcal unknown', and a null macro is omitted rather than shown as zero.
 */
export function formatIngredientContribution(contribution: RecipeIngredientContribution): string {
  const kcal = contribution.kcal === null ? 'kcal unknown' : `${Math.round(contribution.kcal)} kcal`
  const macros = [
    contribution.protein === null ? null : `${contribution.protein.toFixed(1)}g P`,
    contribution.carbs === null ? null : `${contribution.carbs.toFixed(1)}g C`,
    contribution.fat === null ? null : `${contribution.fat.toFixed(1)}g F`,
  ].filter((part): part is string => part !== null)
  return macros.length > 0 ? `→ ${kcal} · ${macros.join(' · ')}` : `→ ${kcal}`
}
