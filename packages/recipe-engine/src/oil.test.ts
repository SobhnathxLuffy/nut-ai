import { describe, expect, it } from 'vitest'
import { estimateOilAbsorption, roundGrams, dishIsFried } from './index.js'

describe('estimateOilAbsorption — used-vs-absorbed pan oil (owner QA 2026-10)', () => {
  it("matches the owner's example: 14 g in the pan → 4.9–9.1 g absorbed (medium confidence)", () => {
    const est = estimateOilAbsorption({ usedGrams: 14, rawFoodGrams: 1000, frying: true })
    expect(est.frying).toBe(true)
    expect(roundGrams(est.absorbedLow)).toBe(4.9)
    expect(roundGrams(est.absorbedHigh)).toBe(9.1)
    expect(roundGrams(est.absorbedMid)).toBe(7)
    expect(est.confidence).toBe('medium')
  })

  it('never charges more oil than was poured, nor more than the food-mass ceiling', () => {
    // Tiny pour into a big pot: fraction rules.
    const small = estimateOilAbsorption({ usedGrams: 2, rawFoodGrams: 5000, frying: true })
    expect(small.absorbedHigh).toBeLessThanOrEqual(2)
    // Huge pour for a tiny food: the 28%-of-food ceiling bites.
    const huge = estimateOilAbsorption({ usedGrams: 100, rawFoodGrams: 100, frying: true })
    expect(huge.absorbedHigh).toBeLessThanOrEqual(100 * 0.28)
    expect(huge.absorbedMid).toBeLessThanOrEqual(huge.absorbedHigh)
    expect(huge.absorbedLow).toBeLessThanOrEqual(huge.absorbedMid)
  })

  it('non-fried fat is fully consumed — absorbed equals used at high confidence', () => {
    const tadka = estimateOilAbsorption({ usedGrams: 14, rawFoodGrams: 1000, frying: false })
    expect(tadka.frying).toBe(false)
    expect(tadka.absorbedLow).toBe(14)
    expect(tadka.absorbedMid).toBe(14)
    expect(tadka.absorbedHigh).toBe(14)
    expect(tadka.confidence).toBe('high')
  })

  it('is scale-free: per-100 g and per-serving inputs produce the same factor', () => {
    // The engine computes per 100 g of raw batch, the composer per serving —
    // the absorbed/used factor must be identical or they drift.
    const per100 = estimateOilAbsorption({ usedGrams: 13, rawFoodGrams: 87, frying: true })
    const perServing = estimateOilAbsorption({ usedGrams: 17.33, rawFoodGrams: 115.99, frying: true })
    expect(perServing.absorbedMid / perServing.usedGrams).toBeCloseTo(per100.absorbedMid / per100.usedGrams, 6)
  })
})

describe('dishIsFried', () => {
  it('detects frying from cooking methods', () => {
    expect(dishIsFried({ cooking: { methods: ['assemble_or_shape', 'cook_or_fry'] } })).toBe(true)
    expect(dishIsFried({ cooking: { methods: ['deep_fried'] } })).toBe(true)
    expect(dishIsFried({ cooking: { methods: ['boil_or_simmer'] } })).toBe(false)
  })

  it('falls back to the uncertainty model admitting frying_oil_absorption', () => {
    expect(dishIsFried({ uncertaintyModel: { highImpactUnknowns: ['frying_oil_absorption'] } })).toBe(true)
    expect(dishIsFried({ uncertaintyModel: { highImpactUnknowns: ['piece_weight'] } })).toBe(false)
  })

  it('is false for nullish dishes', () => {
    expect(dishIsFried(null)).toBe(false)
    expect(dishIsFried(undefined)).toBe(false)
  })
})
