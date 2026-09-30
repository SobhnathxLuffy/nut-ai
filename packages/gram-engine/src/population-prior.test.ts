import { describe, expect, it } from 'vitest'
import type { Item } from '@nutai/core-schema'
import { estimateGrams } from './index.js'
import type { FoodDb, PersonalPriors, PopulationPriorInput } from './types.js'

/**
 * Task 2-c — Tier 1.5: the population portion prior.
 *
 * These tests lock the LAST-MILE consumer side of the contract: the gram
 * engine must turn `resolved.portionHints` (spread in by the pipeline from the
 * resolver's ResolvedFood) into a reconciled candidate, with spread derived
 * from the range width — and leave every existing pathway untouched when no
 * hint is present.
 */

function item(over: Partial<Item> = {}): Item {
  return {
    name: 'Roti',
    brand: null,
    canonical_food_key: 'roti',
    food_form: 'flat',
    qualitative_size: 'medium',
    weight_basis: 'cooked',
    model_gram_estimate: 200,
    identification_confidence: 0.9,
    portion_confidence: 0.5,
    uncertainty_reason: 'none',
    visible_reference_objects: [],
    container: null,
    cooking_method_cues: [],
    is_beverage: false,
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    fallback_macros_at_estimate: {
      calories_kcal: 130, protein_g: 4, carbs_g: 25, fat_g: 1, fiber_g: 1, sodium_mg: 100,
    },
    ...over,
  }
}

const emptyPriors: PersonalPriors = { get: () => null, containers: new Map() }
const db: FoodDb = { fnddsPortionGrams: () => null }

const ROTI_HINT = {
  unit: 'piece',
  typical: 45,
  min: 35,
  max: 60,
  source: 'IFCT 2017 household measures / NIN RDA 2020 (curated range)',
}

const DAL_HINT = {
  unit: 'katori',
  typical: 150,
  min: 120,
  max: 180,
  source: 'IFCT 2017 household measures / NIN RDA 2020 (curated range)',
}

describe('tier 1.5 — population portion prior', () => {
  it('uses the hint typical for one unit when no count is present', () => {
    const r = estimateGrams({
      item: item({ model_gram_estimate: 30 }),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'dish:in:roti', description: 'Roti', portionHints: [ROTI_HINT] },
    })
    expect(r.grams).toBe(45)
    // Borrowed pathway — see the PATHWAY NOTE in estimateGrams; the honest
    // basis is the marker, not the string.
    expect(r.pathway).toBe('personal_prior')
    expect(r.populationPriorApplied).toEqual({
      unit: 'piece',
      source: ROTI_HINT.source,
      typicalGrams: 45,
      minGrams: 35,
      maxGrams: 60,
    })
    // (60-35)/(2*45) = 0.278 — inside the honest clamp window.
    expect(r.spread).toBeCloseTo(25 / 90, 6)
  })

  it('scales by the model count for repeated household units', () => {
    const r = estimateGrams({
      item: item({ food_form: 'discrete', qualitative_size: 'count:2' }),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'dish:in:roti', description: 'Roti', portionHints: [ROTI_HINT] },
    })
    expect(r.grams).toBe(90)
  })

  it('scales vessel units too ("2 katori dal" is two katoris, not one)', () => {
    const r = estimateGrams({
      item: item({ canonical_food_key: 'dal', qualitative_size: 'count:2' }),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'ifct:dal', description: 'Dal, cooked', portionHints: [DAL_HINT] },
    })
    expect(r.grams).toBe(300)
  })

  it('clamps the range-derived spread into [0.15, 0.35]', () => {
    // (120-20)/(2*70) = 0.714 -> clamped to 0.35.
    const wide = estimateGrams({
      item: item({ model_gram_estimate: null }),
      priors: emptyPriors,
      db,
      resolved: {
        foodId: 'x',
        description: 'Mystery curry',
        portionHints: [{ unit: 'serving', typical: 70, min: 20, max: 120, source: 'test' }],
      },
    })
    expect(wide.grams).toBe(70)
    expect(wide.spread).toBe(0.35)

    // (36-34)/(2*35) = 0.029 -> lifted to the 0.15 floor.
    const tight = estimateGrams({
      item: item({ model_gram_estimate: null }),
      priors: emptyPriors,
      db,
      resolved: {
        foodId: 'y',
        description: 'Very consistent food',
        portionHints: [{ unit: 'piece', typical: 35, min: 34, max: 36, source: 'test' }],
      },
    })
    expect(tight.spread).toBe(0.15)
  })

  it('outweighs the model guess but not a trusted personal prior', () => {
    const withHint: Parameters<typeof estimateGrams>[0] = {
      item: item(),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'dish:in:roti', description: 'Roti', portionHints: [ROTI_HINT] },
    }
    // Population prior (0.7) drives over the raw model guess (0.25).
    expect(estimateGrams(withHint).grams).toBe(45)

    // ...but the user's own history (0.9) still wins: 200 * 1.5 = 300.
    const personal = estimateGrams({
      ...withHint,
      priors: {
        get: () => ({
          foodConceptKey: 'roti',
          ewmaRatio: 1.5,
          ratioVariance: 0.01,
          sampleCount: 5,
          medianGrams: 300,
          lastCorrectedAt: 0,
        }),
        containers: new Map(),
      },
    })
    expect(personal.grams).toBe(300)
    expect(personal.personalPriorApplied?.sampleCount).toBe(5)
    expect(personal.populationPriorApplied).toBeUndefined()
  })

  it('accepts a directly injected populationPrior when the row carries no hints', () => {
    const injected: PopulationPriorInput = DAL_HINT
    const r = estimateGrams({
      item: item({ canonical_food_key: 'dal', model_gram_estimate: null }),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'ifct:B021', description: 'Red gram dal' },
      populationPrior: injected,
    })
    expect(r.grams).toBe(150)
    expect(r.populationPriorApplied?.typicalGrams).toBe(150)
  })

  it('the resolved row\'s dish-specific hint wins over an injected population prior', () => {
    const r = estimateGrams({
      item: item(),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'dish:in:roti', description: 'Roti', portionHints: [ROTI_HINT] },
      populationPrior: { unit: 'piece', typical: 999, min: 900, max: 1200, source: 'generic' },
    })
    expect(r.grams).toBe(45)
    expect(r.populationPriorApplied?.source).toBe(ROTI_HINT.source)
  })

  it('absent hints leave every existing pathway unchanged', () => {
    // Same shape as the pre-2-c behavior tests: model guess, no marker.
    const r = estimateGrams({
      item: item(),
      priors: emptyPriors,
      db,
      resolved: { foodId: 'usda:1', description: 'Chicken breast' },
    })
    expect(r.pathway).toBe('model_guess')
    expect(r.grams).toBe(200)
    expect(r.populationPriorApplied).toBeUndefined()

    // Tier 1 discrete count still short-circuits before tier 1.5 when FNDDS
    // has a per-unit row.
    const counted = estimateGrams({
      item: item({ food_form: 'discrete', qualitative_size: 'count:3' }),
      priors: emptyPriors,
      db: { fnddsPortionGrams: (_id, measure) => (measure === 'per_unit' ? 50 : null) },
      resolved: { foodId: 'egg', description: 'Egg', portionHints: [ROTI_HINT] },
    })
    expect(counted.pathway).toBe('discrete_count')
    expect(counted.grams).toBe(150)
  })
})
