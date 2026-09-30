import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, VisionPayloadZ } from '@nutai/core-schema'
import {
  normalizeQualitativeSize,
  payloadValidationIssues,
  repairVisionPayload,
  validateWithRepair,
} from './repair.js'

/**
 * The repair layer is the net under structured-output mode. These tests pin
 * BOTH sides of its contract: drifted answers are deterministically normalized
 * (never invented), and payloads that were already valid come out untouched.
 * Every repaired fixture here reproduces drift ACTUALLY OBSERVED from reseller
 * gateways (aicredits.in with gpt-4o / gpt-4o-mini / gemma-3-12b) — most
 * importantly "two slices on a plate" for qualitative_size, which the wire
 * schema invites and the client regex rejected, killing every such scan.
 */

const item = (over: Record<string, unknown> = {}) => ({
  name: 'Margherita pizza',
  brand: null,
  canonical_food_key: 'pizza',
  food_form: 'discrete',
  qualitative_size: 'count:2',
  weight_basis: 'cooked',
  model_gram_estimate: 200,
  identification_confidence: 0.9,
  portion_confidence: 0.7,
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
    calories_kcal: 260, protein_g: 8, fat_g: 9, carbs_g: 35, fiber_g: 3, sodium_mg: 320,
  },
  ...over,
})

const payload = (over: Record<string, unknown> = {}) => ({
  schema_version: SCHEMA_VERSION,
  is_food: true,
  refusal_reason: null,
  items: [item()],
  meal_overall: { identification_confidence: 0.9, portion_confidence: 0.7, assumptions: [], clarifying_questions: [] },
  ...over,
})

const expectValid = (raw: unknown) => expect(VisionPayloadZ.safeParse(raw).success).toBe(true)

describe('normalizeQualitativeSize', () => {
  it('keeps every already-legal value', () => {
    expect(normalizeQualitativeSize('small')).toBe('small')
    expect(normalizeQualitativeSize('medium')).toBe('medium')
    expect(normalizeQualitativeSize('large')).toBe('large')
    expect(normalizeQualitativeSize('count:3')).toBe('count:3')
    expect(normalizeQualitativeSize('count:2.5')).toBe('count:2.5')
  })

  it('maps descriptive size text — the drift that killed every reseller scan', () => {
    expect(normalizeQualitativeSize('two slices on a plate')).toBe('count:2')
    expect(normalizeQualitativeSize('3 pieces of chicken')).toBe('count:3')
    expect(normalizeQualitativeSize('a small pile of rice')).toBe('small')
    expect(normalizeQualitativeSize('a fairly large serving')).toBe('large')
    expect(normalizeQualitativeSize('a regular dinner bowl')).toBe('medium')
  })

  it('reads spelled-out and bare counts in context', () => {
    expect(normalizeQualitativeSize('two eggs')).toBe('count:2')
    expect(normalizeQualitativeSize('one cup')).toBe('count:1')
    expect(normalizeQualitativeSize('2')).toBe('count:2')
  })

  it('parses count: prefixes with stray spacing or an equals sign', () => {
    expect(normalizeQualitativeSize('count: 4')).toBe('count:4')
    expect(normalizeQualitativeSize('count = 6')).toBe('count:6')
  })

  it('lands unknown prose on medium rather than failing the scan', () => {
    expect(normalizeQualitativeSize('served in a deep dish')).toBe('medium')
  })

  it('returns undefined for non-strings so validation can fail honestly', () => {
    expect(normalizeQualitativeSize(2)).toBeUndefined()
    expect(normalizeQualitativeSize(null)).toBeUndefined()
  })
})

describe('repairVisionPayload', () => {
  it('leaves a fully valid payload untouched (deep equality)', () => {
    const good = payload()
    expect(repairVisionPayload(good)).toEqual(good)
  })

  it('repairs the live reseller drift: descriptive size + percent confidences + string numbers', () => {
    const drifted = payload({
      schema_version: undefined,
      items: [
        item({
          qualitative_size: 'two slices on a plate',
          identification_confidence: '0.9',
          portion_confidence: 70,
          model_gram_estimate: '200',
          fallback_macros_at_estimate: {
            calories_kcal: '260', protein_g: '8', fat_g: '9', carbs_g: '35', fiber_g: '', sodium_mg: '320',
          },
        }),
      ],
      meal_overall: { identification_confidence: '0.9', portion_confidence: '0.7', assumptions: 'not-an-array', clarifying_questions: [] },
    })
    const repaired = repairVisionPayload(drifted)
    expectValid(repaired)
    const parsed = VisionPayloadZ.parse(repaired)
    expect(parsed.schema_version).toBe(SCHEMA_VERSION)
    expect(parsed.items[0]!.qualitative_size).toBe('count:2')
    expect(parsed.items[0]!.identification_confidence).toBeCloseTo(0.9)
    expect(parsed.items[0]!.portion_confidence).toBeCloseTo(0.7)
    expect(parsed.items[0]!.model_gram_estimate).toBe(200)
    expect(parsed.items[0]!.fallback_macros_at_estimate.calories_kcal).toBe(260)
    expect(parsed.items[0]!.fallback_macros_at_estimate.fiber_g).toBeNull()
    expect(parsed.meal_overall.assumptions).toEqual([])
  })

  it('normalizes invented enum values to safe members', () => {
    const drifted = payload({
      items: [item({
        uncertainty_reason: 'i-am-not-sure',
        weight_basis: 'cooked-on-a-grill',
        food_form: 'kind-of-solid',
        cooking_method_cues: ['grill_marks', 'teleported', 42],
        beverage_category: 'juice-box',
        container: 'plate',
      })],
    })
    const parsed = VisionPayloadZ.parse(repairVisionPayload(drifted))
    const it0 = parsed.items[0]!
    expect(it0.uncertainty_reason).toBe('none')
    expect(it0.weight_basis).toBe('as_served')
    expect(it0.food_form).toBe('discrete')
    expect(it0.cooking_method_cues).toEqual(['grill_marks'])
    expect(it0.beverage_category).toBeNull()
    expect(it0.container).toBeNull()
  })

  it('a beverage with an invalid food_form lands on liquid, not discrete', () => {
    const drifted = payload({ items: [item({ is_beverage: true, food_form: 'sort-of-drink' })] })
    expect(VisionPayloadZ.parse(repairVisionPayload(drifted)).items[0]!.food_form).toBe('liquid')
  })

  it('drops malformed reference objects but keeps well-formed ones', () => {
    const drifted = payload({
      items: [item({
        visible_reference_objects: [
          { type: 'dinner_plate', bbox: [0.1, 0.1, 0.8, 0.8], confidence: '0.8' },
          { type: 'ufo', bbox: [0, 0, 1, 1], confidence: 0.9 },
          { type: 'fork', bbox: [0, 0, 1], confidence: 0.9 },
          'not an object',
        ],
      })],
    })
    const repaired = repairVisionPayload(drifted)
    // The kept entry needs its string confidence repaired too.
    const items = (repaired as { items: Array<{ visible_reference_objects: Array<Record<string, unknown>> }> }).items
    expect(items[0]!.visible_reference_objects).toHaveLength(1)
    items[0]!.visible_reference_objects[0]!['confidence'] = 0.8
    expectValid(repaired)
  })

  it('keeps a legal container and repairs a numeric fill_fraction', () => {
    const drifted = payload({ items: [item({ container: { type: 'cereal_bowl', fill_fraction: '0.6' } })] })
    const parsed = VisionPayloadZ.parse(repairVisionPayload(drifted))
    expect(parsed.items[0]!.container).toEqual({ type: 'cereal_bowl', fill_fraction: 0.6 })
  })

  it('caps clarifying questions at two and filters non-strings from arrays', () => {
    const drifted = payload({
      items: [item({ clarifying_questions: ['Is this naan or roti?', 'Added butter?', 7] })],
    })
    expectValid(repairVisionPayload(drifted))
  })

  it('does NOT invent data it has no safe mapping for', () => {
    // Missing required fields stay missing — repair never fabricates a meal.
    const hopeless = { schema_version: SCHEMA_VERSION, is_food: true, refusal_reason: null }
    expect(validateWithRepair(hopeless)).toBeNull()
    expect(payloadValidationIssues(hopeless).length).toBeGreaterThan(0)
  })

  it('passes non-object garbage through untouched so it fails validation', () => {
    expect(validateWithRepair('I cannot see an image')).toBeNull()
    expect(validateWithRepair(42)).toBeNull()
  })

  it('validateWithRepair returns a valid payload usable by the pipeline', () => {
    const drifted = payload({ items: [item({ qualitative_size: 'medium-sized portion' })] })
    const validated = validateWithRepair(drifted)
    expect(validated).not.toBeNull()
    expect(validated!.items[0]!.qualitative_size).toBe('medium')
  })
})

describe('payloadValidationIssues (diagnostics)', () => {
  it('reports nothing for a valid payload and field paths for a broken one', () => {
    expect(payloadValidationIssues(payload())).toEqual([])
    const broken = payload()
    delete (broken as Record<string, unknown>)['meal_overall']
    const issues = payloadValidationIssues(broken)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.startsWith('meal_overall'))).toBe(true)
  })
})
