/**
 * The stored domain model.
 *
 * SPEC-accuracy-engine.md §6.1. One invariant pays for the entire product:
 *
 *   Every ingredient row, regardless of origin, is stored as
 *   (food_reference, grams, per-100g nutrient snapshot) — NEVER as a bare
 *   calorie or macro number.
 *
 * Everything good downstream falls out of that:
 *   - Corrections are free, instant, and offline forever, on BOTH inference
 *     paths, because a correction is arithmetic over values already on device.
 *   - Historical logs never silently change when the nutrition database updates,
 *     because the snapshot was copied at add time and is immutable thereafter.
 *   - Saved meals survive any database update for the same reason.
 *
 * The alternative — storing opaque totals — is what forces a second paid model
 * call to fix a wrong number, and what lets a database update rewrite what you
 * ate last March.
 */

/**
 * Per-100 g nutrient values, copied from a database row AT ADD TIME and immutable
 * thereafter. Never re-looked-up live.
 *
 * `null`/absent means NOT REPORTED. It is never a fabricated `0` — USDA's own
 * disclaimer is explicit that a missing value means data were not supplied, not
 * that the amount is zero, and only ~20% of Open Food Facts entries carry any
 * micronutrient data at all. The UI renders "not reported" visually distinctly
 * from "0 mg"; conflating them is an accuracy-honesty failure, not a cosmetic one.
 */
export interface NutrientRow100g {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g?: number | null
  sugar_g?: number | null
  sodium_mg?: number | null
  micros?: Record<string, number | null>
}

/**
 * How a row's gram figure was arrived at. Drives the row's uncertainty band
 * (§4.9) and is ordered by trust — see the reconciliation ladder in §4.6.
 * This is recorded rather than derived so the eval harness can attribute error
 * to a pathway instead of pooling it.
 */
export type GramPathway =
  /** Tier 0 — printed label arithmetic. Exact; the only estimate left is servings. */
  | 'packaged_exact'
  /** Tier 1 — countable food × standard per-unit mass. Cheapest reliable path. */
  | 'discrete_count'
  /** Tier 2 — this user's own correction history for this food class (≥3 samples). */
  | 'personal_prior'
  /** Tier 3 — geometry calibrated against a known-size reference object in frame. */
  | 'geometry_exact_ref'
  | 'geometry_soft_ref'
  /** Tier 4 — FNDDS standard portion keyed to a qualitative size word. */
  | 'fndds_standard_portion'
  /** Tier 4b — container volume × fill fraction, for liquids. */
  | 'container_fill'
  /** Tier 5 — the model's own guess. Lowest trust, always the widest band. */
  | 'model_guess'
  /** Hard-clamped. Flagged, never silently truncated; forces lowest confidence. */
  | 'clamped'
  /** The user typed the number. No band — this is ground truth for this meal. */
  | 'user_edited'

export type IngredientOrigin =
  | 'vision_model'
  | 'barcode'
  | 'label_ocr'
  | 'db_search'
  | 'manual_custom'
  /** Pushed by answering a clarifying chip — e.g. the oil the user confirmed. */
  | 'assumption_filler'
  /**
   * Transcribed from a brand's published nutrition facts found by the web-search
   * refinement. Carries a source URL in its assumptions; distinct from
   * vision_model because a citation and a guess are different classes of claim.
   */
  | 'web_lookup'

export interface AssumptionTag {
  type: string
  /** Grams this assumption contributes, when it is a mass assumption. */
  gramsEquiv?: number
  userConfirmed: boolean
}

export interface IngredientRow {
  id: string
  displayName: string
  /** FK into foods/user_foods. Null for a pure model estimate with no DB match. */
  sourceFoodId: string | null
  /** The ONE quantity the user edits directly. */
  grams: number
  /** Copied at add time. Immutable. Never re-looked-up live. */
  nutrientSnapshot: NutrientRow100g
  origin: IngredientOrigin
  /** Where a web_lookup row's numbers were transcribed from. Shown in the UI. */
  sourceUrl?: string | null
  /** Human-readable source/license attribution shown beside resolved food data. */
  sourceAttribution?: string | null
  gramPathway: GramPathway
  /** Half-width of this row's uncertainty band, as a fraction. §7.2. */
  bandHalfPct: number
  /** Drives the amber "AI estimate" badge — a DB miss, not merely low confidence. */
  isEstimate: boolean
  assumptions: AssumptionTag[]
  /**
   * True once the user has directly edited a macro on this row. Forces calories to
   * be recomputed via Atwater and the "recalculated from macros" note to show.
   * See §6.2 regime 2.
   */
  macrosUserEdited?: boolean
}

export interface LoggedMeal {
  id: string
  loggedAt: string
  ingredients: IngredientRow[]
  /**
   * 1.0 = ate all of it. Applied as a FINAL multiplier to the summed totals, not
   * per-ingredient — which matches how people actually reason about "I ate about
   * half of this plate."
   */
  portionEatenFraction: number
  engineId: string
  promptVersion: string | null
  schemaVersion: string | null
  clampFlags: unknown[]
}

export interface MacroTotals {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number
  /** Like fiber: a null on a row contributes 0 to the sum, never a fake zero claim. */
  sugar_g: number
  sodium_mg: number
}
