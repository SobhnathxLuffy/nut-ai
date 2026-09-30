import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  SCHEMA_VERSION,
  VisionPayloadZ,
  type Item,
  type VisionPayload,
} from './vision-payload.js'

/**
 * The scene-aware contract additions (schema 1.1.0) and the prompt-v1.3.0
 * honesty blocks (schema 1.2.0).
 *
 * The design constraint every assertion here protects: ALL additions are
 * OPTIONAL in Zod, so a payload produced by the previous prompt (no scene, no
 * visibility, no gram range, no portion context, no preparation block) still
 * validates. The upgrade widens what the model MAY say; it must never
 * retroactively break what it already said.
 */

function item(over: Partial<Item> = {}): Item {
  return {
    name: 'Chapati',
    brand: null,
    canonical_food_key: 'chapati, whole wheat',
    food_form: 'flat',
    qualitative_size: 'count:1',
    weight_basis: 'as_served',
    model_gram_estimate: 60,
    identification_confidence: 0.9,
    portion_confidence: 0.7,
    uncertainty_reason: 'none',
    visible_reference_objects: [],
    container: null,
    cooking_method_cues: ['dry_surface'],
    is_beverage: false,
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    fallback_macros_at_estimate: {
      calories_kcal: 150, protein_g: 4, carbs_g: 28, fat_g: 2, fiber_g: 3, sodium_mg: 100,
    },
    ...over,
  }
}

function payload(over: Partial<VisionPayload> = {}): VisionPayload {
  return {
    schema_version: SCHEMA_VERSION,
    is_food: true,
    refusal_reason: null,
    items: [item()],
    meal_overall: {
      identification_confidence: 0.9, portion_confidence: 0.7, assumptions: [], clarifying_questions: [],
    },
    ...over,
  }
}

describe('schema version 1.2.0', () => {
  it('is bumped, and the bump is documented as stored-data-safe', () => {
    // The only stored-data migration gate is USER_SCHEMA_VERSION in
    // @nutai/db-adapter; this string is inert scan-time metadata, and the
    // pipeline repair layer re-stamps older answers before validation.
    expect(SCHEMA_VERSION).toBe('1.2.0')
  })
})

describe('pre-1.1 payloads keep validating', () => {
  it('accepts a payload with no scene, no visibility and no gram range', () => {
    const parsed = VisionPayloadZ.parse(payload())
    expect(parsed.scene).toBeUndefined()
    expect(parsed.items[0]!.visibility).toBeUndefined()
    expect(parsed.items[0]!.model_gram_range).toBeUndefined()
  })
})

describe('pre-1.3 payloads keep validating (prompt v1.3.0 honesty blocks)', () => {
  it('accepts a payload with no portion_context, qualitative_amount, preparation, uncertainties, question or summary', () => {
    const parsed = VisionPayloadZ.parse(payload())
    expect(parsed.portion_context).toBeUndefined()
    expect(parsed.items[0]!.qualitative_amount).toBeUndefined()
    expect(parsed.items[0]!.preparation).toBeUndefined()
    expect(parsed.major_uncertainties).toBeUndefined()
    expect(parsed.highest_impact_question).toBeUndefined()
    expect(parsed.summary).toBeUndefined()
  })
})

describe('the scene block', () => {
  it('names the WHOLE meal for a multi-bowl platter, never one component', () => {
    const thali = payload({
      scene: {
        meal_type: 'indian_thali',
        display_name: 'Indian mixed thali',
        confidence: 0.9,
      },
    })
    const parsed = VisionPayloadZ.parse(thali)
    expect(parsed.scene!.display_name).toBe('Indian mixed thali')
    expect(parsed.scene!.meal_type).toBe('indian_thali')
  })

  it('rejects an empty display_name — a scene that cannot be named is not a scene', () => {
    const bad = payload({
      scene: { meal_type: 'indian_thali', display_name: '', confidence: 0.9 },
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown meal_type — the enum is the contract the repair bank joins on', () => {
    const bad = payload({
      scene: { meal_type: 'family_dinner', display_name: 'Dinner', confidence: 0.9 } as never,
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })

  it('bounds scene confidence to a probability', () => {
    const bad = payload({
      scene: { meal_type: 'mixed_plate', display_name: 'Mixed plate', confidence: 1.5 },
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('per-item visibility', () => {
  it('accepts the three honest levels', () => {
    for (const visibility of ['visible', 'likely', 'inferred'] as const) {
      expect(VisionPayloadZ.safeParse(payload({ items: [item({ visibility })] })).success).toBe(true)
    }
  })

  it('rejects invented levels', () => {
    const bad = payload({ items: [item({ visibility: 'hallucinated' } as never)] })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('per-item model_gram_range', () => {
  it('accepts an honest range alongside the point estimate', () => {
    const parsed = VisionPayloadZ.parse(
      payload({ items: [item({ model_gram_range: { min_g: 350, max_g: 700 } })] }),
    )
    expect(parsed.items[0]!.model_gram_range).toEqual({ min_g: 350, max_g: 700 })
  })

  it('accepts an explicit null — "I cannot responsibly bound this" is a valid answer', () => {
    const parsed = VisionPayloadZ.parse(payload({ items: [item({ model_gram_range: null })] }))
    expect(parsed.items[0]!.model_gram_range).toBeNull()
  })

  it('rejects non-positive bounds — a range through zero is not a mass', () => {
    const bad = payload({ items: [item({ model_gram_range: { min_g: 0, max_g: 500 } })] })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('the portion_context block (v1.3.0)', () => {
  it('carries the honest no-scale-cue answer: the exact shape the live test produced', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        portion_context: {
          whole_meal_visible: true,
          scale_reference_available: false,
          scale_reference_description: '',
          absolute_portion_confidence: 'unknown',
        },
      }),
    )
    expect(parsed.portion_context!.absolute_portion_confidence).toBe('unknown')
    expect(parsed.portion_context!.scale_reference_available).toBe(false)
  })

  it('fills scale_reference_description from its default when the model omits it', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        portion_context: {
          whole_meal_visible: true,
          scale_reference_available: true,
          absolute_portion_confidence: 'medium',
        } as never,
      }),
    )
    expect(parsed.portion_context!.scale_reference_description).toBe('')
  })

  it('rejects an invented confidence level — the enum is what the UI can render', () => {
    const bad = payload({
      portion_context: {
        whole_meal_visible: true,
        scale_reference_available: false,
        scale_reference_description: '',
        absolute_portion_confidence: 'sorta',
      } as never,
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })

  it('rejects a missing boolean — the two flags are the block\'s whole point', () => {
    const bad = payload({
      portion_context: {
        scale_reference_available: false,
        absolute_portion_confidence: 'unknown',
      } as never,
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('per-item qualitative_amount (v1.3.0)', () => {
  it('accepts the five honest levels including the unknown sentinel', () => {
    for (const qualitative_amount of ['tiny', 'light', 'moderate', 'heavy', 'unknown'] as const) {
      const parsed = VisionPayloadZ.parse(payload({ items: [item({ qualitative_amount })] }))
      expect(parsed.items[0]!.qualitative_amount).toBe(qualitative_amount)
    }
  })

  it('rejects invented levels — no "sorta light" prose in a machine field', () => {
    const bad = payload({ items: [item({ qualitative_amount: 'plenty' } as never)] })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('per-item preparation (v1.3.0)', () => {
  it('separates intrinsic fat from added cooking fat, with the added-fat enum including none', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        items: [
          item({
            preparation: {
              method: 'shallow-fried on a tawa',
              intrinsic_fat: 'moderate',
              added_cooking_fat: 'moderate',
              confidence: 0.6,
            },
          }),
        ],
      }),
    )
    expect(parsed.items[0]!.preparation!.method).toBe('shallow-fried on a tawa')
    expect(parsed.items[0]!.preparation!.added_cooking_fat).toBe('moderate')
  })

  it('accepts the unknown sentinels — "cannot tell" must be expressible on every field', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        items: [
          item({ preparation: { method: '', intrinsic_fat: 'unknown', added_cooking_fat: 'unknown', confidence: 0.1 } }),
        ],
      }),
    )
    expect(parsed.items[0]!.preparation!.intrinsic_fat).toBe('unknown')
  })

  it('fills method from its default when the model omits it', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        items: [
          item({ preparation: { intrinsic_fat: 'low', added_cooking_fat: 'none', confidence: 0.8 } as never }),
        ],
      }),
    )
    expect(parsed.items[0]!.preparation!.method).toBe('')
  })

  it('rejects an out-of-bounds confidence — same probability discipline as every other confidence', () => {
    const bad = payload({
      items: [
        item({ preparation: { method: 'fried', intrinsic_fat: 'high', added_cooking_fat: 'heavy', confidence: 1.5 } }),
      ],
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })

  it('rejects invented fat levels', () => {
    const bad = payload({
      items: [
        item({
          preparation: { method: '', intrinsic_fat: 'drenched', added_cooking_fat: 'none', confidence: 0.5 } as never,
        }),
      ],
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('the major_uncertainties block (v1.3.0)', () => {
  it('accepts ranked factors with their calorie impact', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        major_uncertainties: [
          { factor: 'amount of ghee in the gravies', impact_on_total_calories: 'high' },
          { factor: 'number of rotis eaten', impact_on_total_calories: 'medium' },
        ],
      }),
    )
    expect(parsed.major_uncertainties).toHaveLength(2)
  })

  it('accepts an empty array — an unambiguous photo has no uncertainties', () => {
    const parsed = VisionPayloadZ.parse(payload({ major_uncertainties: [] }))
    expect(parsed.major_uncertainties).toEqual([])
  })

  it('rejects more than 5 — a list that long is noise, not signal', () => {
    const many = [1, 2, 3, 4, 5, 6].map((i) => ({ factor: `factor ${i}`, impact_on_total_calories: 'low' as const }))
    const bad = payload({ major_uncertainties: many })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })

  it('rejects an empty factor and an invented impact level', () => {
    const badFactor = payload({ major_uncertainties: [{ factor: '', impact_on_total_calories: 'high' }] })
    const badImpact = payload({
      major_uncertainties: [{ factor: 'oil', impact_on_total_calories: 'enormous' } as never],
    })
    expect(VisionPayloadZ.safeParse(badFactor).success).toBe(false)
    expect(VisionPayloadZ.safeParse(badImpact).success).toBe(false)
  })
})

describe('the highest_impact_question block (v1.3.0)', () => {
  it('accepts the question with or without one-tap options', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        highest_impact_question: {
          question: 'What is the approximate diameter of the thali plate?',
          options: [],
        },
      }),
    )
    expect(parsed.highest_impact_question!.options).toEqual([])
  })

  it('accepts an explicit null — "no question warranted" is a genuine state', () => {
    const parsed = VisionPayloadZ.parse(payload({ highest_impact_question: null }))
    expect(parsed.highest_impact_question).toBeNull()
  })

  it('rejects a too-short question — min 4 chars keeps "none"-style sentinels valid but no accidents', () => {
    const bad = payload({ highest_impact_question: { question: 'why', options: [] } })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })

  it('rejects more than 6 options', () => {
    const bad = payload({
      highest_impact_question: {
        question: 'How much of it was eaten?',
        options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      },
    })
    expect(VisionPayloadZ.safeParse(bad).success).toBe(false)
  })
})

describe('the summary block (v1.3.0)', () => {
  it('carries the two honest sentences', () => {
    const parsed = VisionPayloadZ.parse(
      payload({
        summary: {
          what_is_known: 'A mixed thali with at least nine components.',
          what_is_not_known: 'Absolute portions — no scale reference.',
        },
      }),
    )
    expect(parsed.summary!.what_is_known).toContain('thali')
  })

  it('fills both sentences from defaults when the model omits them', () => {
    const parsed = VisionPayloadZ.parse(payload({ summary: {} as never }))
    expect(parsed.summary!.what_is_known).toBe('')
    expect(parsed.summary!.what_is_not_known).toBe('')
  })
})

describe('the derived wire schema (provider dialects)', () => {
  // The wire schema is generated from THIS zod object (wire-schema.ts), so the
  // two can never drift — but only if the new fields actually appear. The OpenAI
  // strict dialect lists EVERY property as required, which is what makes the
  // model always emit scene/visibility even though Zod treats them as optional.
  const wire = zodToJsonSchema(VisionPayloadZ, { $refStrategy: 'none' }) as {
    properties?: Record<string, any>
    required?: string[]
  }
  const topLevel = wire.properties ?? {}
  // items: z.array(ItemZ) -> properties.items is the array node; the object
  // shape lives one level down in .items.
  const itemNode: { properties?: Record<string, unknown>; required?: string[] } =
    topLevel['items']?.['items'] ?? {}

  it('carries scene, visibility and model_gram_range to the wire', () => {
    expect(Object.keys(topLevel)).toContain('scene')
    expect(Object.keys(itemNode.properties ?? {})).toContain('visibility')
    expect(Object.keys(itemNode.properties ?? {})).toContain('model_gram_range')
  })

  it('keeps them OUT of draft-07 required — optionality is the backward-compat story', () => {
    expect(wire.required ?? []).toEqual(expect.not.arrayContaining(['scene']))
    expect(itemNode.required ?? []).toEqual(
      expect.not.arrayContaining(['visibility', 'model_gram_range']),
    )
  })

  it('carries the v1.3.0 honesty blocks to the wire at the right levels', () => {
    expect(Object.keys(topLevel)).toEqual(
      expect.arrayContaining(['portion_context', 'major_uncertainties', 'highest_impact_question', 'summary']),
    )
    expect(Object.keys(itemNode.properties ?? {})).toEqual(
      expect.arrayContaining(['qualitative_amount', 'preparation']),
    )
  })

  it('keeps the v1.3.0 blocks OUT of draft-07 required — same backward-compat story', () => {
    expect(wire.required ?? []).toEqual(
      expect.not.arrayContaining(['portion_context', 'major_uncertainties', 'highest_impact_question', 'summary']),
    )
    expect(itemNode.required ?? []).toEqual(
      expect.not.arrayContaining(['qualitative_amount', 'preparation']),
    )
  })

  it('expresses the new enums as closed sets, never nullable — the sanitizer strips null branches, so honesty rides on the unknown sentinel', () => {
    const portionNode = topLevel['portion_context'] as { properties?: Record<string, any> }
    const conf = portionNode.properties?.['absolute_portion_confidence']
    expect(conf).toEqual({ type: 'string', enum: ['high', 'medium', 'low', 'unknown'] })

    const amountNode = itemNode.properties?.['qualitative_amount'] as any
    expect(amountNode).toEqual({
      type: 'string',
      enum: ['tiny', 'light', 'moderate', 'heavy', 'unknown'],
    })

    const prepNode = itemNode.properties?.['preparation'] as { properties?: Record<string, any> }
    expect(prepNode.properties?.['added_cooking_fat']).toEqual({
      type: 'string',
      enum: ['none', 'light', 'moderate', 'heavy', 'unknown'],
    })
    expect(prepNode.properties?.['intrinsic_fat']).toEqual({
      type: 'string',
      enum: ['low', 'moderate', 'high', 'unknown'],
    })
  })

  it('carries defaults for the free-string fields, so omitted keys degrade to empty instead of failing', () => {
    const portionNode = topLevel['portion_context'] as { properties?: Record<string, any> }
    expect(portionNode.properties?.['scale_reference_description']).toMatchObject({ type: 'string', default: '' })

    const prepNode = itemNode.properties?.['preparation'] as { properties?: Record<string, any> }
    expect(prepNode.properties?.['method']).toMatchObject({ type: 'string', default: '' })

    const summaryNode = topLevel['summary'] as { properties?: Record<string, any> }
    expect(summaryNode.properties?.['what_is_known']).toMatchObject({ type: 'string', default: '' })
  })

  it('keeps highest_impact_question nullable in the Zod-side draft-07 schema (the one deliberate exception)', () => {
    const q = topLevel['highest_impact_question'] as any
    const branches = (q?.anyOf ?? []) as Array<{ type?: string }>
    expect(branches.some((b) => b.type === 'null')).toBe(true)
  })
})
