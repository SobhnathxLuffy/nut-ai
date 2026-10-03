import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dishIngredientBreakdown } from './dish-ingredients'
import {
  applyDishClarifications,
  clarifiedSlotLines,
  dishClarificationQuestions,
  dishOpenUnknowns,
  dishPriorKcalRange,
  dishUncertaintyModel,
  humanizeUnknownKey,
  zeroedClarificationSlots,
  type DishClarificationAnswers,
  type DishClarificationRow,
} from './dish-clarifications'

/**
 * Dish clarification wiring (AGENTS.md §0.2 / Wave 5A O5): the engine's
 * generateClarifications / applyClarifications (packages/indian-dishes) had
 * ZERO references in the app. These tests lock the app-layer adapter that
 * feeds the composer: the question gate, the answer semantics (slot food id,
 * prior-range multiplier, share redistribution), skip = no change, and the
 * prior-range band derived through the SAME dishIngredientBreakdown path.
 *
 * The fixture mirrors the SHIPPED roti row (apps/mobile/assets/nutrition.db,
 * `SELECT * FROM dish_definitions WHERE id = 'dish:in:roti'`): CURATED prior
 * kinds, verified 0.88 yield, 40 g standard portion, a fat_variable
 * added_fat_optional slot mapped to ghee (ifct:T013), and an uncertainty
 * model with high-impact unknowns.
 */

const here = dirname(fileURLToPath(import.meta.url))

function slot(
  label: string,
  range: [number, number],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    label,
    role: 'secondary',
    required: false,
    amountPrior: { kind: 'CURATED_PRIOR', range, verified: true },
    nutritionMapping: { canonicalFoodId: 'ifct:A019', mappingStatus: 'MANUAL_OVERRIDE' },
    ...extra,
  }
}

const rotiRow: DishClarificationRow & Record<string, unknown> = {
  id: 'dish:in:roti',
  canonical_name: 'Roti',
  record_status: 'CURATED',
  recipe_template_json: JSON.stringify({
    templateStatus: 'CURATED',
    numericRatiosVerified: true,
    ingredientSlots: [
      slot('grain_flour', [0.6, 0.7], { role: 'dominant', required: true }),
      slot('water', [0.3, 0.4], { role: 'process', nutritionMapping: { canonicalFoodId: 'usda:174158', mappingStatus: 'MANUAL_OVERRIDE' } }),
      slot('salt', [0.005, 0.015], { role: 'minor', nutritionMapping: { canonicalFoodId: 'usda:173468', mappingStatus: 'MANUAL_OVERRIDE' } }),
      slot('added_fat_optional', [0.01, 0.04], { role: 'fat_variable', nutritionMapping: { canonicalFoodId: 'ifct:T013', mappingStatus: 'MANUAL_OVERRIDE' } }),
    ],
  }),
  yield_model_json: JSON.stringify({ verifiedNumericYield: 0.88, status: 'verified', assumptionClass: 'CURATED_PRIOR' }),
  portion_model_json: JSON.stringify({ standardPortionGrams: 40, standardPortionStatus: 'verified', assumptionClass: 'CURATED_PRIOR' }),
  uncertainty_model_json: JSON.stringify({
    highImpactUnknowns: ['piece_weight', 'added_fat', 'flour_type'],
    allowIDontKnow: true,
    questionPolicy: 'ask_highest_expected_uncertainty_reduction_per_user_effort',
  }),
}

/** kcal per 100 g for the fixture slots (IFCT-scale values for atta / ghee). */
const ROTI_KCAL: Record<string, number> = { grain_flour: 340, water: 0, salt: 0, added_fat_optional: 900 }

describe('dishClarificationQuestions — the gate', () => {
  it('generates the fat question for a curated dish with an uncertainty model', () => {
    const questions = dishClarificationQuestions(rotiRow)
    expect(questions).toHaveLength(1)
    const q = questions[0]!
    expect(q.id).toBe('clarify_added_fat_optional')
    expect(q.slotLabel).toBe('added_fat_optional')
    expect(q.questionText).toBe('Which fat was used for cooking?')
    expect(q.options.map((o) => o.label)).toEqual(['Ghee', 'Mustard Oil', 'Sunflower Oil', 'None / Dry Roasted'])
    expect(q.options.find((o) => o.label === 'Ghee')!.canonicalFoodId).toBe('ifct:T013')
    expect(q.options.find((o) => o.label === 'None / Dry Roasted')).toMatchObject({ canonicalFoodId: null, amountMultiplier: 0 })
  })

  it('asks nothing for household rows (no uncertainty model column) — current behavior', () => {
    const householdRow = {
      recipe_template_json: JSON.stringify({
        ingredientSlots: [slot('grain_flour', [0.6, 0.7], { amountPrior: { kind: 'HOUSEHOLD_MEASURED', grams: 33, verified: true } })],
      }),
      yield_model_json: '{}',
      portion_model_json: '{}',
    }
    expect(dishClarificationQuestions(householdRow)).toEqual([])
    expect(dishUncertaintyModel(householdRow)).toBeNull()
  })

  it('asks nothing when the model has no high-impact unknowns', () => {
    expect(dishClarificationQuestions({ ...rotiRow, uncertainty_model_json: JSON.stringify({ highImpactUnknowns: [] }) })).toEqual([])
  })

  it('filters zero-option (unresolved-slot) questions — the IngredientResolver owns those', () => {
    // The engine emits a question for unresolved slots with options: [] ("to
    // be populated by dynamic search"). The composer's per-component search
    // already serves those slots; a blank card would be dead weight.
    const row: DishClarificationRow = {
      recipe_template_json: JSON.stringify({
        ingredientSlots: [
          slot('mystery_green', [0.05, 0.1], { nutritionMapping: { canonicalFoodId: null, mappingStatus: 'unresolved' } }),
        ],
      }),
      yield_model_json: '{}',
      portion_model_json: '{}',
      uncertainty_model_json: JSON.stringify({ highImpactUnknowns: ['mystery_green'] }),
    }
    expect(dishClarificationQuestions(row)).toEqual([])
  })
})

describe('applyDishClarifications — answer semantics', () => {
  it('skip (no answers) returns the SAME row — exactly the current behavior', () => {
    expect(applyDishClarifications(rotiRow, {})).toBe(rotiRow)
  })

  it('is immutable: the original row and template are untouched', () => {
    const before = rotiRow.recipe_template_json
    applyDishClarifications(rotiRow, { clarify_added_fat_optional: { canonicalFoodId: 'ifct:T006' } })
    expect(rotiRow.recipe_template_json).toBe(before)
  })

  it('a fat answer re-maps the slot and the fold follows the engine semantics', () => {
    const clarified = applyDishClarifications(rotiRow, { clarify_added_fat_optional: { canonicalFoodId: 'ifct:T006' } })
    expect(clarified).not.toBe(rotiRow)
    const slots = JSON.parse(clarified.recipe_template_json ?? '{}').ingredientSlots as Array<{ label: string; nutritionMapping: { canonicalFoodId: string | null; mappingStatus: string } }>
    const fat = slots.find((s) => s.label === 'added_fat_optional')!
    // Engine semantics: the answer wins the slot's mapping.
    expect(fat.nutritionMapping.canonicalFoodId).toBe('ifct:T006')
    expect(fat.nutritionMapping.mappingStatus).toBe('mapped')
    // The fold (composer fat selector) follows the new food id.
    const { fatFold } = dishIngredientBreakdown(clarified, true)
    expect(fatFold?.optionId).toBe('mustard-oil-14g')
  })

  it('"None / Dry Roasted" zeroes the prior, drops the fold, and redistributes the mass share', () => {
    const answers: DishClarificationAnswers = { clarify_added_fat_optional: { canonicalFoodId: null, amountMultiplier: 0 } }
    const clarified = applyDishClarifications(rotiRow, answers)
    // The shipped corpus is 100% CURATED_PRIOR, so the ENGINE's multiplier
    // branch (engineering priors only) never fires — the ADAPTER scales the
    // range for every prior kind (documented API adaptation).
    const fat = JSON.parse(clarified.recipe_template_json ?? '{}').ingredientSlots.find((s: { label: string }) => s.label === 'added_fat_optional')
    expect(fat.amountPrior.range).toEqual([0, 0])
    expect(zeroedClarificationSlots(answers)).toEqual(['added_fat_optional'])

    const before = clarifiedSlotLines(rotiRow)
    const after = clarifiedSlotLines(clarified)
    // The fat slot contributes nothing: 0 g, no fold.
    expect(after.find((l) => l.label === 'added_fat_optional')!.grams).toBe(0)
    expect(after.find((l) => l.label === 'added_fat_optional')!.foldedIntoFat).toBe(false)
    expect(dishIngredientBreakdown(clarified, true).fatFold).toBeNull()
    // Mass conservation: the fixed raw batch redistributes to the other slots.
    expect(after.find((l) => l.label === 'grain_flour')!.grams).toBeGreaterThan(before.find((l) => l.label === 'grain_flour')!.grams)
    const totalBefore = before.reduce((s, l) => s + l.grams, 0)
    const totalAfter = after.reduce((s, l) => s + l.grams, 0)
    expect(totalAfter).toBeCloseTo(totalBefore, 0)
  })

  it('the default fold stays intact for the ghee answer (same as the recipe default)', () => {
    const clarified = applyDishClarifications(rotiRow, { clarify_added_fat_optional: { canonicalFoodId: 'ifct:T013' } })
    const { fatFold } = dishIngredientBreakdown(clarified, true)
    expect(fatFold?.optionId).toBe('ghee-14g')
    expect(fatFold?.grams).toBeGreaterThan(0)
    expect(fatFold?.grams).toBeLessThan(2)
  })

  it('survives an unparseable template unchanged', () => {
    const broken: DishClarificationRow = { recipe_template_json: '{oops', yield_model_json: '{}', portion_model_json: '{}', uncertainty_model_json: rotiRow.uncertainty_model_json as string }
    expect(applyDishClarifications(broken, { clarify_added_fat_optional: { canonicalFoodId: 'ifct:T006' } })).toBe(broken)
  })
})

describe('dishOpenUnknowns — the honest uncertainty surface', () => {
  it('lists the model unknowns before any answer', () => {
    expect(dishOpenUnknowns(rotiRow, {})).toEqual(['piece_weight', 'added_fat', 'flour_type'])
  })

  it('an answered fat question resolves the fat-identity unknown only', () => {
    const open = dishOpenUnknowns(rotiRow, { clarify_added_fat_optional: { canonicalFoodId: 'ifct:T013' } })
    expect(open).toEqual(['piece_weight', 'flour_type'])
  })

  it('amount/absorption unknowns stay open — the question does not answer them', () => {
    const row = {
      ...rotiRow,
      uncertainty_model_json: JSON.stringify({ highImpactUnknowns: ['frying_oil_absorption', 'added_fat', 'oil_ghee_amount'] }),
    }
    const open = dishOpenUnknowns(row, { clarify_added_fat_optional: { canonicalFoodId: 'ifct:T012' } })
    expect(open).toEqual(['frying_oil_absorption', 'oil_ghee_amount'])
  })

  it('humanizes the keys for display', () => {
    expect(humanizeUnknownKey('piece_weight')).toBe('Piece weight')
    expect(humanizeUnknownKey('flour_type')).toBe('Flour type')
  })
})

describe('dishPriorKcalRange — the estimate range from the model\'s own numbers', () => {
  it('propagates the reviewed fraction ranges through the SAME derivation path', () => {
    const band = dishPriorKcalRange({ row: rotiRow, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 40 })
    expect(band).not.toBeNull()
    expect(band!.low).toBeGreaterThan(105)
    expect(band!.low).toBeLessThan(106)
    expect(band!.high).toBeGreaterThan(108)
    expect(band!.high).toBeLessThan(109)
    expect(band!.low).toBeLessThan(band!.high)

    // The mid estimate (what the composer shows) sits inside the band.
    const lines = clarifiedSlotLines(rotiRow)
    const midKcal =
      lines.reduce((s, l) => s + (ROTI_KCAL[l.label] ?? 0) * l.grams / 100, 0) *
      (40 / (lines.reduce((s, l) => s + l.grams, 0) * 0.88))
    expect(midKcal).toBeGreaterThan(band!.low)
    expect(midKcal).toBeLessThan(band!.high)
  })

  it('removing the fat lowers the whole band', () => {
    const gheeBand = dishPriorKcalRange({ row: rotiRow, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 40 })
    const noneRow = applyDishClarifications(rotiRow, { clarify_added_fat_optional: { canonicalFoodId: null, amountMultiplier: 0 } })
    const noneBand = dishPriorKcalRange({ row: noneRow, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 40 })
    expect(noneBand).not.toBeNull()
    expect(noneBand!.high).toBeLessThan(gheeBand!.low)
  })

  it('returns null when a slot\'s kcal is unknown — the band never invents numbers', () => {
    expect(dishPriorKcalRange({ row: rotiRow, kcalPer100gBySlot: { ...ROTI_KCAL, grain_flour: null }, portionGrams: 40 })).toBeNull()
  })

  it('returns null for point priors — a ±0 band is false precision', () => {
    const pointRow = {
      ...rotiRow,
      recipe_template_json: JSON.stringify({
        ingredientSlots: [
          slot('grain_flour', [0.65, 0.65]),
          slot('water', [0.33, 0.33]),
          slot('added_fat_optional', [0.02, 0.02], { role: 'fat_variable' }),
        ],
      }),
    }
    expect(dishPriorKcalRange({ row: pointRow, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 40 })).toBeNull()
  })

  it('returns null without a verified yield or portion (the generic-yield path has no prior band)', () => {
    expect(dishPriorKcalRange({ row: { ...rotiRow, yield_model_json: '{}' }, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 40 })).toBeNull()
    expect(dishPriorKcalRange({ row: { ...rotiRow, portion_model_json: '{}' }, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 40 })).toBeNull()
    expect(dishPriorKcalRange({ row: rotiRow, kcalPer100gBySlot: ROTI_KCAL, portionGrams: 0 })).toBeNull()
  })
})

describe('dish-composer wiring (source sweep — expo screens cannot run under node)', () => {
  const composer = readFileSync(join(here, '..', '..', 'app', 'dish-composer.tsx'), 'utf8')

  it('generates questions from the dish record and renders them above the slot list', () => {
    expect(composer).toContain('dishClarificationQuestions')
    expect(composer).toContain('Clarify this estimate')
    expect(composer).toMatch(/<Disclosure[\s\S]*?label="Clarify this estimate"/)
    // The disclosure section renders BEFORE the component rows (above the slot list).
    const sectionIndex = composer.indexOf('Clarify this estimate')
    const slotListIndex = composer.indexOf('components.map((c)')
    expect(sectionIndex).toBeGreaterThan(-1)
    expect(sectionIndex).toBeLessThan(slotListIndex)
  })

  it('answers ride ChipRow chips from the model\'s options, with a visible Skip', () => {
    expect(composer).toMatch(/items=\{question\.options\}/)
    expect(composer).toContain('Skip — keep the recipe default')
    expect(composer).toMatch(/accessibilityLabel=\{`Skip: \$\{question\.questionText\}`\}/)
  })

  it('answers re-derive through the adapter into the SAME derivation path', () => {
    expect(composer).toContain('applyDishClarifications')
    expect(composer).toContain('zeroedClarificationSlots')
    // The clarification feeds the input of the shared builder — no parallel arithmetic.
    expect(composer).toMatch(/buildComponentsFromRow\(db, ifctDb, userDb, clarifiedRow/)
  })

  it('surfaces the prior range and the open unknowns next to the estimate', () => {
    expect(composer).toContain('dishPriorKcalRange')
    expect(composer).toContain('dishOpenUnknowns')
    expect(composer).toMatch(/variant="uncertain"/)
  })

  it('keeps answers in component state and NEVER persists them to the dish record', () => {
    expect(composer).toContain('useState<DishClarificationAnswers>({})')
    expect(composer).not.toContain('saveHouseholdDefault')
    expect(composer).not.toContain('household_defaults')
    // The household save path still builds the template from the user's confirmed components.
    expect(composer).toMatch(/ingredientSlots: components\.map/)
  })
})
