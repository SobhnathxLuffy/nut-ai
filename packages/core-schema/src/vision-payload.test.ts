import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { SCHEMA_VERSION, VisionPayloadZ, type Item, type VisionPayload } from './vision-payload.js'

/**
 * The scene-aware contract additions (schema 1.1.0).
 *
 * The design constraint every assertion here protects: ALL three additions are
 * OPTIONAL in Zod, so a payload produced by the previous prompt (no scene, no
 * visibility, no gram range) still validates. The upgrade widens what the model
 * MAY say; it must never retroactively break what it already said.
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

describe('schema version 1.1.0', () => {
  it('is bumped, and the bump is documented as stored-data-safe', () => {
    // The only stored-data migration gate is USER_SCHEMA_VERSION in
    // @nutai/db-adapter; this string is inert scan-time metadata, and the
    // pipeline repair layer re-stamps older answers before validation.
    expect(SCHEMA_VERSION).toBe('1.1.0')
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
})
