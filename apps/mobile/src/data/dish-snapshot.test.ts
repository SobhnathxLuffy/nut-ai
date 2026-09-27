import { describe, expect, it } from 'vitest'
import { per100Snapshot } from './dish-snapshot'

/**
 * QA SECTION-B P0-1 — the composer → food-review snapshot contract.
 *
 * The litti chokha case from the report: 4 components resolve to 1,225 kcal
 * raw, cooked yield 214 g, final portion 160 g. The correct portion total is
 * 1,225 × (160/214) ≈ 915.9 kcal. The composer used to send that PORTION TOTAL
 * as nutrientSnapshot.kcal; food-review multiplies by grams/100, producing the
 * reported 1,465 kcal — a ~60% inflation on every household-variant log.
 *
 * The contract under test: the payload snapshot is PER-100 g, so the review's
 * own math (snapshot × grams / 100) must recover the composer's portion total.
 */
const LITTI_PORTION_KCAL = (1225 * 160) / 214
const LITTI_PORTION = {
  kcal: LITTI_PORTION_KCAL,
  protein_g: 12.0,
  carbs_g: 52.0,
  fat_g: 97.0,
}

describe('per100Snapshot — the food-review payload basis', () => {
  it('expresses the portion total on the per-100 g basis', () => {
    const snap = per100Snapshot(LITTI_PORTION, 160)
    expect(snap.kcal).toBeCloseTo(LITTI_PORTION_KCAL * (100 / 160), 6)
    expect(snap.protein_g).toBeCloseTo(12 * (100 / 160), 6)
    expect(snap.carbs_g).toBeCloseTo(52 * (100 / 160), 6)
    expect(snap.fat_g).toBeCloseTo(97 * (100 / 160), 6)
  })

  it('round-trips through food-review math: snapshot × grams / 100 = composer total', () => {
    const snap = per100Snapshot(LITTI_PORTION, 160)
    // Exactly the computation food-review.tsx performs for display and save.
    expect((snap.kcal * 160) / 100).toBeCloseTo(LITTI_PORTION_KCAL, 6)
    // The reported bug showed 1,465 here (915.93 × 160/100 applied twice).
    expect((snap.kcal * 160) / 100).not.toBeCloseTo(1465, 0)
  })

  it('is basis-independent: per-100 g is identical for any portion of the same dish', () => {
    const from160 = per100Snapshot(LITTI_PORTION, 160)
    const from80 = per100Snapshot(
      {
        kcal: LITTI_PORTION_KCAL / 2,
        protein_g: 6,
        carbs_g: 26,
        fat_g: 48.5,
      },
      80,
    )
    expect(from80.kcal).toBeCloseTo(from160.kcal, 9)
    expect(from80.protein_g).toBeCloseTo(from160.protein_g, 9)
  })

  it('collapses to zeros on a non-positive or non-finite portion', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const snap = per100Snapshot(LITTI_PORTION, bad)
      expect(snap.kcal).toBe(0)
      expect(snap.protein_g).toBe(0)
      expect(snap.carbs_g).toBe(0)
      expect(snap.fat_g).toBe(0)
    }
  })

  it('treats null component values as unknown → 0, never fabricated numbers', () => {
    const snap = per100Snapshot({ kcal: 300, protein_g: null, carbs_g: null, fat_g: null }, 150)
    expect(snap.kcal).toBeCloseTo(200, 6)
    expect(snap.protein_g).toBe(0)
    expect(snap.carbs_g).toBe(0)
    expect(snap.fat_g).toBe(0)
  })
})
