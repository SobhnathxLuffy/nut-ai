import type { ScanResult } from '@nutai/pipeline'

/**
 * Quick-mode eligibility — the whole #1 product decision in one predicate.
 *
 * Quick mode is a BETTER DEFAULT, not a dumber one: it shows a one-tap "Log
 * it" only when nothing in the result is worth the user's attention, and it
 * falls back to the full review automatically the moment anything deserves a
 * look. The review screen remains the fix screen; quick mode just refuses to
 * hide the fix screen when it matters.
 *
 * A scan is quick-eligible when ALL of these hold:
 * - at least one ingredient survived the pipeline (nothing to blindly log);
 * - no clarifying question is currently highlighted (a question IS the app
 *   asking for a check — skipping it would be dishonest);
 * - no row is a bare AI estimate (a DB miss is exactly when review pays);
 * - the meal-level band is tight (±15% or better — the same half-width the
 *   baselines table reserves for countable, geometry-pinned pathways).
 *
 * `results.mealBand.halfPct` is the honest, measured signal — NOT the model's
 * self-reported confidence, which packages/confidence documents as the worse
 * side of the elicitation gap and never uses as a gate.
 */
export const QUICK_MAX_MEAL_BAND = 0.15

export function isQuickEligible(result: ScanResult): boolean {
  if (result.meal.ingredients.length === 0) return false
  if (result.questions.some((q) => q.state === 'highlighted')) return false
  if (result.meal.ingredients.some((r) => r.isEstimate)) return false
  return result.mealBand.halfPct <= QUICK_MAX_MEAL_BAND
}
