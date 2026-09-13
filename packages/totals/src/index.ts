import type { IngredientRow, LoggedMeal, MacroTotals } from '@nutai/core-schema'

/**
 * Totals, recompute, and display rounding.
 *
 * SPEC-accuracy-engine.md §6. Pure arithmetic over per-100 g snapshots. Zero
 * network, zero device APIs, sub-millisecond.
 *
 * This module is why no correction ever needs a paid model call again. The
 * inference model's only job was producing the initial IngredientRow[]. Every
 * subsequent action is local arithmetic over values already on the device:
 *
 *   edit grams          -> factor changes, snapshot does not. Multiplication.
 *   swap identity       -> new snapshot copied from a local SQLite row. Instant.
 *   answer "oil?"       -> push a synthetic ingredient row, then recompute.
 *   answer "all of it?" -> set portionEatenFraction. One multiplier.
 *   add / remove        -> splice. There is no data-model difference between
 *                          "the AI added rice and I removed it" and "I removed
 *                          rice because I didn't eat it."
 */

export function zeroTotals(): MacroTotals {
  return { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }
}

export function scaleTotals(t: MacroTotals, factor: number): MacroTotals {
  return {
    kcal: t.kcal * factor,
    protein_g: t.protein_g * factor,
    fat_g: t.fat_g * factor,
    carbs_g: t.carbs_g * factor,
    fiber_g: t.fiber_g * factor,
    sugar_g: t.sugar_g * factor,
    sodium_mg: t.sodium_mg * factor,
  }
}

/** Totals contributed by a single row, before the whole-meal portion multiplier. */
export function rowTotals(row: IngredientRow): MacroTotals {
  const factor = row.grams / 100
  const s = row.nutrientSnapshot
  return {
    kcal: s.kcal * factor,
    protein_g: s.protein_g * factor,
    fat_g: s.fat_g * factor,
    carbs_g: s.carbs_g * factor,
    // A missing micronutrient contributes 0 to a SUM - that is arithmetic, not a
    // claim that the food contains none. The distinction survives on the row
    // itself (null vs 0) and is rendered distinctly in the UI; it cannot survive
    // addition.
    fiber_g: (s.fiber_g ?? 0) * factor,
    sugar_g: (s.sugar_g ?? 0) * factor,
    sodium_mg: (s.sodium_mg ?? 0) * factor,
  }
}

/**
 * The whole meal. Full float precision throughout - rounding happens exactly once,
 * at the display layer (§6.3 Regime B).
 */
export function recomputeTotals(meal: LoggedMeal): MacroTotals {
  const raw = meal.ingredients.reduce<MacroTotals>((acc, row) => {
    const t = rowTotals(row)
    acc.kcal += t.kcal
    acc.protein_g += t.protein_g
    acc.fat_g += t.fat_g
    acc.carbs_g += t.carbs_g
    acc.fiber_g += t.fiber_g
    acc.sugar_g += t.sugar_g
    acc.sodium_mg += t.sodium_mg
    return acc
  }, zeroTotals())

  return scaleTotals(raw, meal.portionEatenFraction)
}

/**
 * Atwater. Calories from macro grams.
 *
 * This is the direct, non-optional fix for the documented bug where editing
 * protein from 226 g to 175 g left calories sitting unchanged at 2,964 kcal with
 * fat and carbs also unchanged. Any macro edit anywhere in the app recomputes
 * through this function. Mandatory, every time, no exceptions.
 */
export function reconcileFromMacros(protein_g: number, carbs_g: number, fat_g: number): number {
  return protein_g * 4 + carbs_g * 4 + fat_g * 9
}

/**
 * Which basis produced an item's calorie figure. Surfaced to the user rather than
 * switched silently (§6.2).
 *
 * `database`  - an untouched, DB-resolved row. Display the row's own energy value.
 *   USDA and manufacturer figures may bake in food-specific Atwater factors that a
 *   naive 4/4/9 would not reproduce (fiber's true ~2 kcal/g rather than 4;
 *   alcohol's 7). Do not touch it.
 *
 * `recomputed` - the user edited a macro. Recompute, and show the inline
 *   "recalculated from macros" note so the basis switch is disclosed, not silent.
 */
export type CalorieBasis = 'database' | 'recomputed'

export function calorieBasisFor(row: IngredientRow): CalorieBasis {
  return row.macrosUserEdited ? 'recomputed' : 'database'
}

/** An item's calories under whichever regime produced it (§6.2). */
export function itemCalories(row: IngredientRow): number {
  const t = rowTotals(row)
  return calorieBasisFor(row) === 'recomputed'
    ? reconcileFromMacros(t.protein_g, t.carbs_g, t.fat_g)
    : t.kcal
}

// ---------------------------------------------------------------------------
// Display rounding - §6.3. Two regimes, deliberately separate. Conflating them is
// precisely how numbers end up visibly disagreeing with each other.
// ---------------------------------------------------------------------------

/**
 * Regime B - aggregated or derived totals: a meal, a day, any sum where no printed
 * label exists to match.
 *
 * Grams: one decimal below 10 g, whole grams at 10 g and above.
 */
export function roundDisplayGrams(g: number): number {
  return g < 10 ? Math.round(g * 10) / 10 : Math.round(g)
}

export interface DisplayTotals {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number
  sugar_g: number
  sodium_mg: number
}

/**
 * Calories for display are computed from the ALREADY-ROUNDED macro grams.
 *
 * This guarantees a user can hand-multiply the macros they can see and get the
 * calorie figure they can see. A displayed calorie number that does not match
 * displayed-macros x 4/4/9 is its own distinct failure - separate from the edit
 * bug - and this rule kills it even when nothing was ever edited.
 *
 * Worked example from the spec: three items summing to 480.9 kcal / 52.69 P /
 * 6.19 F / 50.0 C. Macros display as 53 / 6 / 50, so calories display as
 * round(4*53 + 4*50 + 9*6) = 466. We STORE and EXPORT 480.9; we SHOW 466, and 466
 * is exactly reproducible from the visible macros. Every nutrition label makes
 * this same trade. Internal consistency is the property a user can actually check;
 * exact agreement with an unrounded truth they cannot see is not.
 */
export function toDisplayTotals(t: MacroTotals): DisplayTotals {
  const protein_g = roundDisplayGrams(t.protein_g)
  const fat_g = roundDisplayGrams(t.fat_g)
  const carbs_g = roundDisplayGrams(t.carbs_g)
  return {
    kcal: Math.round(reconcileFromMacros(protein_g, carbs_g, fat_g)),
    protein_g,
    fat_g,
    carbs_g,
    fiber_g: roundDisplayGrams(t.fiber_g),
    sugar_g: roundDisplayGrams(t.sugar_g),
    sodium_mg: Math.round(t.sodium_mg),
  }
}

/**
 * Regime A - "as labeled", for a SINGLE packaged/branded item, shown on a barcode
 * product screen or a disambiguation sheet.
 *
 * FDA 21 CFR 101.9(c), because our Branded Foods data originates from what is
 * printed on real US labels - matching the label's own convention is the only way
 * our number can match the package in the user's hand.
 *
 * These MUST NOT be used for sums. FDA's tiered increments are defined for a
 * single serving's declared value and do not compose additively: summing three
 * already-label-rounded fat values gives a different answer from rounding the true
 * sum once.
 */
export const labelRounding = {
  /** Nearest 5 up to and including 50; nearest 10 above 50; under 5 may be zero. */
  calories(kcal: number): number {
    if (kcal < 5) return 0
    if (kcal <= 50) return Math.round(kcal / 5) * 5
    return Math.round(kcal / 10) * 10
  },

  /** Nearest 0.5 g below 5 g; nearest 1 g at or above 5 g; under 0.5 g is zero. */
  fat(g: number): number {
    if (g < 0.5) return 0
    if (g < 5) return Math.round(g * 2) / 2
    return Math.round(g)
  },

  /** Zero below 5 mg; nearest 5 mg from 5-140 mg; nearest 10 mg above 140 mg. */
  sodium(mg: number): number {
    if (mg < 5) return 0
    if (mg <= 140) return Math.round(mg / 5) * 5
    return Math.round(mg / 10) * 10
  },

  /**
   * Nearest gram. Below 0.5 g may be expressed as zero; between 0.5 and 1 g the
   * label may instead read "contains less than 1 gram" - that string case belongs
   * to the UI, so this returns 0 and callers check `isTrace`.
   */
  gramNutrient(g: number): number {
    if (g < 0.5) return 0
    return Math.round(g)
  },

  /** True when the label convention is the words "contains less than 1 gram". */
  isTrace(g: number): boolean {
    return g >= 0.5 && g < 1
  },

  /** Nearest 5 mg; declaration not required below 2 mg. */
  cholesterol(mg: number): number {
    if (mg < 2) return 0
    return Math.round(mg / 5) * 5
  },

  /** Nearest 2% to 10%; nearest 5% above 10% to 50%; nearest 10% above 50%. */
  percentDV(pct: number): number {
    if (pct <= 10) return Math.round(pct / 2) * 2
    if (pct <= 50) return Math.round(pct / 5) * 5
    return Math.round(pct / 10) * 10
  },
} as const

