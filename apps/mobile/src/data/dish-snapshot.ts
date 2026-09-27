/**
 * P0-1 — the household-variant payload contract.
 *
 * `food-review.tsx` renders every snapshot value as `value × grams / 100`: the
 * nutrientSnapshot carried in the encoded payload is PER-100 g — the same single
 * computational basis as `ResolvedFood` ("Per-100 g. Always."). The dish composer
 * used to stuff the PORTION TOTAL into that field, so food-review scaled it by
 * grams/100 a second time and every household-variant log was inflated by
 * (portion/100) — the QA's litti case showed 1,465 kcal for a 916 kcal portion,
 * a ~60% over-count that silently corrupted daily totals, reports and adaptive
 * targets. This helper converts portion totals to the per-100 g basis the
 * review screen and every totals read expect.
 */

export interface PortionTotals {
  kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export interface Per100Snapshot {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: 0
  sugar_g: 0
  sodium_mg: 0
}

/**
 * Convert nutrition totals for one portion into the per-100 g snapshot basis.
 * A non-positive or non-finite portion has no basis, so every value becomes 0 —
 * callers must reject such portions before building a payload at all.
 */
export function per100Snapshot(totals: PortionTotals, portionG: number): Per100Snapshot {
  const scale = Number.isFinite(portionG) && portionG > 0 ? 100 / portionG : 0
  const toPer100 = (v: number | null): number =>
    v === null || !Number.isFinite(v) ? 0 : v * scale
  return {
    kcal: toPer100(totals.kcal),
    protein_g: toPer100(totals.protein_g),
    carbs_g: toPer100(totals.carbs_g),
    fat_g: toPer100(totals.fat_g),
    fiber_g: 0,
    sugar_g: 0,
    sodium_mg: 0,
  }
}
