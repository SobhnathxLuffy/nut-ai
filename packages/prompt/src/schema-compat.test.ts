import { describe, expect, it } from 'vitest'
import { sanitizeJsonSchemaForWire, schemaContractBlock } from './schema-compat'

/**
 * Wire-schema sanitation. The live failure this pins down: aicredits.in's
 * Go gateway 400s EVERY scan with `cannot unmarshal array into Go struct
 * field Definition.properties.refusal_reason.type` — it cannot parse
 * nullable type-arrays, so with the raw zodToJsonSchema output no scan on
 * that gateway ever reached the model. The sanitizer must flatten exactly
 * those constructs while leaving everything the gateway already accepted
 * (enums, additionalProperties, required) byte-identical.
 */

describe('sanitizeJsonSchemaForWire', () => {
  it('flattens nullable type-arrays to their primary type', () => {
    const out = sanitizeJsonSchemaForWire({
      type: 'object',
      properties: {
        refusal_reason: { type: ['string', 'null'] },
        fiber_g: { type: ['number', 'null'], maximum: 100 },
      },
    })!
    expect(out['properties']).toEqual({
      refusal_reason: { type: 'string' },
      fiber_g: { type: 'number', maximum: 100 },
    })
  })

  it('unwraps anyOf null-branches, keeping the surviving branch and siblings', () => {
    const container = {
      anyOf: [
        {
          type: 'object',
          properties: { type: { type: 'string', enum: ['mug', 'other'] }, fill_fraction: { type: 'number' } },
          required: ['type', 'fill_fraction'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: 'The vessel, if any',
    }
    const out = sanitizeJsonSchemaForWire({ type: 'object', properties: { container } })!
    expect(out['properties']).toEqual({
      container: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['mug', 'other'] }, fill_fraction: { type: 'number' } },
        required: ['type', 'fill_fraction'],
        additionalProperties: false,
        description: 'The vessel, if any',
      },
    })
  })

  it('leaves unions with more than one real branch untouched', () => {
    const node = {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
    }
    const out = sanitizeJsonSchemaForWire({ type: 'object', properties: { x: node } })!
    expect((out['properties'] as any).x.anyOf).toHaveLength(3)
  })

  it('drops $schema meta and never mutates the input', () => {
    const input = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { brand: { type: ['string', 'null'] } },
    }
    const snapshot = JSON.stringify(input)
    const out = sanitizeJsonSchemaForWire(input)!
    expect(out['$schema']).toBeUndefined()
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('a real VisionPayload-shaped fragment survives with strict-mode keys intact', () => {
    const fragment = {
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'is_food', 'refusal_reason', 'items', 'meal_overall'],
      properties: {
        schema_version: { type: 'string', enum: ['1.0.0'] },
        is_food: { type: 'boolean' },
        refusal_reason: { type: ['string', 'null'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'model_gram_estimate', 'container'],
            properties: {
              name: { type: 'string' },
              model_gram_estimate: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
              container: {
                anyOf: [
                  { type: 'object', properties: { type: { type: 'string' }, fill_fraction: { type: 'number' } }, required: ['type', 'fill_fraction'], additionalProperties: false },
                  { type: 'null' },
                ],
              },
            },
          },
        },
        meal_overall: { type: 'object' },
      },
    }
    const out = sanitizeJsonSchemaForWire(fragment)!
    expect(out['required']).toEqual(fragment.required)
    const props = out['properties'] as any
    expect(props.refusal_reason).toEqual({ type: 'string' })
    const items = props.items.items
    expect((items.properties.model_gram_estimate as any).type).toBe('number')
    expect((items.properties.model_gram_estimate as any).minimum).toBe(0)
    expect((items.properties.container as any).type).toBe('object')
    expect(items.additionalProperties).toBe(false)
  })
})

describe('schemaContractBlock', () => {
  it('ships the schema text and forbids omitted keys — the free-form drift fix', () => {
    const block = schemaContractBlock({ type: 'object', properties: { schema_version: { type: 'string' } } })
    expect(block).toContain('OUTPUT CONTRACT')
    expect(block).toContain('never omit a key')
    expect(block).toContain('"schema_version"')
    expect(block).toContain('<schema>')
  })
})
