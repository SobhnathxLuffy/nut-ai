import { describe, expect, it } from 'vitest'
import type { Item, VisionPayload } from '@nutai/core-schema'
import {
  highImpactQuestionFrom,
  MAX_UNCERTAINTY_FACTORS,
  portionContextFrom,
  rowQualityFrom,
  strongestDisclosedFatLevel,
  summaryFrom,
  uncertaintyFactorsFrom,
} from './scan-contract.js'

/**
 * The contract v1.3.0 mappers' defensive guarantees.
 *
 * The e2e suite covers the happy paths through runPipeline; THIS file pins
 * what happens when the mapper input is garbage — because the mapper is the
 * module that promises "an honesty block that cannot be trusted says
 * nothing, and never throws". It is also the seam that keeps a
 * schema-version skew from converting a paid scan into a crash.
 */

function payload(over: Partial<VisionPayload> = {}): VisionPayload {
  return {
    schema_version: '1.2.0',
    is_food: true,
    refusal_reason: null,
    items: [],
    meal_overall: { identification_confidence: 0.9, portion_confidence: 0.6, assumptions: [], clarifying_questions: [] },
    ...over,
  } as VisionPayload
}

function item(over: Partial<Item> = {}): Item {
  return {
    name: 'X', brand: null, canonical_food_key: 'x', food_form: 'discrete',
    qualitative_size: 'medium', weight_basis: 'cooked', model_gram_estimate: 100,
    identification_confidence: 0.9, portion_confidence: 0.6, uncertainty_reason: 'none',
    visible_reference_objects: [], container: null, cooking_method_cues: [],
    is_beverage: false, beverage_category: null, legible_label_text: null,
    stated_assumptions: [], clarifying_questions: [],
    fallback_macros_at_estimate: { calories_kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 0, sodium_mg: 0 },
    ...over,
  } as Item
}

describe('portionContextFrom degrades garbage to the documented neutral', () => {
  it('nulls a missing or non-object block', () => {
    expect(portionContextFrom(payload())).toBeNull()
    expect(portionContextFrom({ portion_context: 'the whole meal' } as unknown as VisionPayload)).toBeNull()
  })

  it('empty string — not null — is the contract spelling for "no reference"', () => {
    const pc = portionContextFrom(payload({
      portion_context: {
        whole_meal_visible: true,
        scale_reference_available: false,
        scale_reference_description: '',
        absolute_portion_confidence: 'low',
      },
    }))
    expect(pc!.scaleReferenceDescription).toBe('')
    expect(pc!.absolutePortionConfidence).toBe('low')
  })

  it('an unreadable confidence degrades to the honest unknown sentinel', () => {
    const pc = portionContextFrom({
      portion_context: {
        whole_meal_visible: 'yes',
        scale_reference_available: 1,
        scale_reference_description: 42,
        absolute_portion_confidence: 'astronomical',
      },
    } as unknown as VisionPayload)
    expect(pc).toEqual({
      wholeMealVisible: false,
      scaleReferenceAvailable: false,
      scaleReferenceDescription: '',
      absolutePortionConfidence: 'unknown',
    })
  })
})

describe('uncertaintyFactorsFrom drops noise and honors the cap', () => {
  it('empties on a missing or non-array block', () => {
    expect(uncertaintyFactorsFrom(payload())).toEqual([])
    expect(uncertaintyFactorsFrom({ major_uncertainties: 'everything' } as unknown as VisionPayload)).toEqual([])
  })

  it('drops entries without a readable factor or impact, never guesses one', () => {
    // The garbage entries are the POINT of this test: a model (or an older
    // schema version) that ignores the closed enum must degrade to a filtered
    // list, not throw. They are introduced through a deliberately type-loose
    // holder and cast once at the boundary — the values are ones the wire type
    // correctly forbids, so typing the fixture literally is a tsc error, not
    // a test.
    const garbage: unknown[] = [
      { factor: 'Ghee quantity', impact_on_total_calories: 'high' },
      { factor: '', impact_on_total_calories: 'high' },
      { factor: 42, impact_on_total_calories: 'low' },
      { factor: 'Rice density', impact_on_total_calories: 'astronomical' },
      { factor: 'Rice density', impact_on_total_calories: null },
      'prose, not an object',
      { factor: 'Oil absorption', impact_on_total_calories: 'medium' },
    ]
    const factors = uncertaintyFactorsFrom(payload({
      major_uncertainties: garbage as VisionPayload['major_uncertainties'],
    }))
    expect(factors).toEqual([
      { factor: 'Ghee quantity', impactOnTotalCalories: 'high' },
      { factor: 'Oil absorption', impactOnTotalCalories: 'medium' },
    ])
  })

  it('caps the list at the contract maximum', () => {
    const factors = uncertaintyFactorsFrom(payload({
      major_uncertainties: Array.from({ length: 9 }, (_, i) => ({
        factor: `Factor ${i}`,
        impact_on_total_calories: 'low',
      })),
    }) as unknown as VisionPayload)
    expect(factors).toHaveLength(MAX_UNCERTAINTY_FACTORS)
  })
})

describe('highImpactQuestionFrom and summaryFrom', () => {
  it('null an absent, null, or questionless block', () => {
    expect(highImpactQuestionFrom(payload())).toBeNull()
    expect(highImpactQuestionFrom(payload({ highest_impact_question: null }))).toBeNull()
    expect(highImpactQuestionFrom(payload({ highest_impact_question: { question: '  ', options: [] } } as unknown as VisionPayload))).toBeNull()
  })

  it('maps the wire no-question sentinel to null, and a real question passes through', () => {
    // The strict-wire spelling of "no question" — the OpenAI sanitizer strips
    // the null branch, so the prompt instructs {"question":"none","options":[]}
    // and "none" clears the wire's min(4) — must surface as the domain's null,
    // never as a card that literally says "none".
    expect(highImpactQuestionFrom(payload({
      highest_impact_question: { question: 'none', options: [] },
    }))).toBeNull()
    // A real question — even one whose options include the word "None" —
    // passes through untouched.
    expect(highImpactQuestionFrom(payload({
      highest_impact_question: { question: 'How much ghee went into the dal?', options: ['None', 'A lot'] },
    }))).toEqual({ question: 'How much ghee went into the dal?', options: ['None', 'A lot'] })
  })

  it('keeps only string options', () => {
    // Same type-loose holder as the uncertainties test above: a non-string
    // option is exactly the garbage this mapper must survive, introduced
    // through unknown because the wire type correctly forbids it.
    const hiqBlock: unknown = {
      question: 'How much oil?',
      options: ['None', 2, ' A lot ', ''],
    }
    const hiq = highImpactQuestionFrom(payload({
      highest_impact_question: hiqBlock as NonNullable<VisionPayload['highest_impact_question']>,
    }))
    expect(hiq).toEqual({ question: 'How much oil?', options: ['None', ' A lot '] })
  })

  it('summary sides are independently nullable', () => {
    expect(summaryFrom(payload())).toEqual({ knownSummary: null, unknownSummary: null })
    const s = summaryFrom(payload({ summary: { what_is_known: 'Known', what_is_not_known: 'Unknown' } }))
    expect(s).toEqual({ knownSummary: 'Known', unknownSummary: 'Unknown' })
    const half = summaryFrom(payload({ summary: { what_is_known: 'Known', what_is_not_known: 42 } } as unknown as VisionPayload))
    expect(half).toEqual({ knownSummary: 'Known', unknownSummary: null })
  })
})

describe('rowQualityFrom degrades garbage without throwing', () => {
  it('nulls both fields for a pre-1.3 item', () => {
    const q = rowQualityFrom(item())
    expect(q.qualitativeAmount).toBeNull()
    expect(q.preparation).toBeNull()
  })

  it('clamps confidence into [0, 1] and normalizes unreadable enums', () => {
    const q = rowQualityFrom({
      qualitative_amount: 'gigantic',
      preparation: { method: 42, intrinsic_fat: 'dripping', added_cooking_fat: 'drowning', confidence: 150 },
    } as unknown as Item)
    // An unnamed enum value is no claim — null, never an invented level.
    expect(q.qualitativeAmount).toBeNull()
    expect(q.preparation).toEqual({
      method: '',
      intrinsicFat: 'unknown',
      addedCookingFat: 'unknown',
      confidence: 1,
    })
    const low = rowQualityFrom({ preparation: { confidence: -3 } } as unknown as Item)
    expect(low.preparation!.confidence).toBe(0)
  })
})

describe('strongestDisclosedFatLevel', () => {
  it('orders heavy > moderate > light > unknown, and none never wins', () => {
    expect(strongestDisclosedFatLevel([
      item({ preparation: { method: '', intrinsic_fat: 'low', added_cooking_fat: 'light', confidence: 0.9 } }),
      item({ preparation: { method: '', intrinsic_fat: 'low', added_cooking_fat: 'heavy', confidence: 0.9 } }),
    ])).toBe('heavy')
    expect(strongestDisclosedFatLevel([
      item({ preparation: { method: '', intrinsic_fat: 'low', added_cooking_fat: 'none', confidence: 0.9 } }),
      item({ preparation: { method: '', intrinsic_fat: 'low', added_cooking_fat: 'unknown', confidence: 0.9 } }),
    ])).toBe('unknown')
    expect(strongestDisclosedFatLevel([item()])).toBe('none')
    expect(strongestDisclosedFatLevel([])).toBe('none')
  })
})
