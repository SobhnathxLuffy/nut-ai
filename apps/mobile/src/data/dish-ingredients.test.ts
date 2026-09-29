import { describe, expect, it } from 'vitest'
import {
  dishIngredientBreakdown,
  fatOptionIdForSlot,
  humanizeSlotLabel,
  slotServingGrams,
  type SlotLike,
} from './dish-ingredients'

function slot(label: string, range: [number, number], extra: Partial<SlotLike> = {}): SlotLike {
  return {
    label,
    role: 'secondary',
    required: false,
    amountPrior: { kind: 'CURATED_PRIOR', range, verified: true } as never,
    nutritionMapping: { canonicalFoodId: 'ifct:A019', mappingStatus: 'MANUAL_OVERRIDE' },
    ...extra,
  }
}

describe('humanizeSlotLabel', () => {
  it('maps every shipped slot label to a human phrase', () => {
    expect(humanizeSlotLabel('added_fat_optional')).toBe('Cooking fat (optional)')
    expect(humanizeSlotLabel('tadka_fat_optional')).toBe('Tadka fat (optional)')
    expect(humanizeSlotLabel('grain_flour')).toBe('Grain flour')
    expect(humanizeSlotLabel('pulse_or_legume')).toBe('Dal (pulse)')
  })

  it('prettifies unknown labels instead of leaking snake_case', () => {
    expect(humanizeSlotLabel('some_new_slot')).toBe('Some new slot')
  })
})

describe('slotServingGrams', () => {
  it('reproduces the engine arithmetic for a roti flour slot', () => {
    // Roti: flour mid 0.65, mids sum 1.035, portion 40g, yield 0.88.
    const share = 0.65 / 1.035
    const grams = slotServingGrams({ share, standardPortionGrams: 40, verifiedNumericYield: 0.88 })
    expect(grams).toBeCloseTo(28.5, 0)
  })

  it('returns zero when portion or yield are not positive', () => {
    expect(slotServingGrams({ share: 0.5, standardPortionGrams: 0, verifiedNumericYield: 1 })).toBe(0)
    expect(slotServingGrams({ share: 0.5, standardPortionGrams: 150, verifiedNumericYield: 0 })).toBe(0)
  })
})

describe('fatOptionIdForSlot', () => {
  it('maps ghee, mustard and sunflower oils to selector options', () => {
    expect(fatOptionIdForSlot(slot('added_fat_optional', [0.01, 0.04], { nutritionMapping: { canonicalFoodId: 'ifct:T013', mappingStatus: 'MANUAL_OVERRIDE' } }))).toBe('ghee-14g')
    expect(fatOptionIdForSlot(slot('added_fat', [0.05, 0.1], { nutritionMapping: { canonicalFoodId: 'ifct:T006', mappingStatus: 'MANUAL_OVERRIDE' } }))).toBe('mustard-oil-14g')
    expect(fatOptionIdForSlot(slot('added_fat', [0.05, 0.1], { nutritionMapping: { canonicalFoodId: 'ifct:T012', mappingStatus: 'MANUAL_OVERRIDE' } }))).toBe('sunflower-oil-14g')
  })

  it('maps groundnut oil and butter so every recipe fat can fold', () => {
    // Samosa / Chole Bhature frying oil and Butter Naan / Dal Makhani butter
    // used to be unrepresentable — the selector then added a second silent
    // 14 g on top of them.
    expect(fatOptionIdForSlot(slot('added_fat_or_frying_oil', [0.1, 0.16], { nutritionMapping: { canonicalFoodId: 'ifct:T005', mappingStatus: 'MANUAL_OVERRIDE' } }))).toBe('groundnut-oil-14g')
    expect(fatOptionIdForSlot(slot('added_fat_optional', [0.04, 0.08], { nutritionMapping: { canonicalFoodId: 'usda:173430', mappingStatus: 'MANUAL_OVERRIDE' } }))).toBe('butter-14g')
    expect(fatOptionIdForSlot(slot('butter_or_ghee', [0.06, 0.12], { nutritionMapping: { canonicalFoodId: 'usda:173410', mappingStatus: 'MANUAL_OVERRIDE' } }))).toBe('butter-14g')
  })

  it('keeps cream and cashew rows out of the selector', () => {
    expect(fatOptionIdForSlot(slot('cream_optional', [0.03, 0.06], { nutritionMapping: { canonicalFoodId: 'usda:170859', mappingStatus: 'AUTO_MAPPED' } }))).toBeNull()
  })
})

describe('dishIngredientBreakdown', () => {
  const rotiRow = {
    recipe_template_json: JSON.stringify({
      ingredientSlots: [
        slot('grain_flour', [0.6, 0.7], { role: 'dominant', required: true }),
        slot('water', [0.3, 0.4], { role: 'process', nutritionMapping: { canonicalFoodId: 'usda:174158', mappingStatus: 'MANUAL_OVERRIDE' } }),
        slot('salt', [0.005, 0.015], { role: 'minor', nutritionMapping: { canonicalFoodId: 'usda:173468', mappingStatus: 'MANUAL_OVERRIDE' } }),
        slot('added_fat_optional', [0.01, 0.04], { role: 'fat_variable', nutritionMapping: { canonicalFoodId: 'ifct:T013', mappingStatus: 'MANUAL_OVERRIDE' } }),
      ],
    }),
    yield_model_json: JSON.stringify({ verifiedNumericYield: 0.88, status: 'verified' }),
    portion_model_json: JSON.stringify({ standardPortionGrams: 40, standardPortionStatus: 'verified' }),
  }

  it('derives realistic per-serving grams — never a flat 50 g', () => {
    const { lines, standardPortionGrams, verifiedNumericYield } = dishIngredientBreakdown(rotiRow)
    expect(standardPortionGrams).toBe(40)
    expect(verifiedNumericYield).toBe(0.88)
    const flour = lines.find((l) => l.label === 'grain_flour')!
    const salt = lines.find((l) => l.label === 'salt')!
    const ghee = lines.find((l) => l.label === 'added_fat_optional')!
    expect(flour.grams).toBeGreaterThan(25)
    expect(flour.grams).toBeLessThan(32)
    expect(salt.grams).toBeLessThan(1)
    expect(ghee.grams).toBeLessThan(2)
  })

  it('uses human labels, never snake_case codes', () => {
    const { lines } = dishIngredientBreakdown(rotiRow)
    expect(lines.find((l) => l.label === 'added_fat_optional')!.display).toBe('Cooking fat (optional)')
    expect(lines.every((l) => !l.display.includes('_'))).toBe(true)
  })

  it('folds the selector-representable fat slot when asked', () => {
    const { lines, fatFold } = dishIngredientBreakdown(rotiRow, true)
    expect(fatFold?.optionId).toBe('ghee-14g')
    expect(fatFold?.grams).toBeLessThan(2)
    expect(lines.find((l) => l.label === 'added_fat_optional')!.foldedIntoFat).toBe(true)
  })

  it('keeps the fat row when folding is off (food-review breakdown view)', () => {
    const { fatFold, lines } = dishIngredientBreakdown(rotiRow, false)
    expect(fatFold).toBeNull()
    expect(lines.find((l) => l.label === 'added_fat_optional')!.foldedIntoFat).toBe(false)
  })

  it('humanizes the restored filling labels', () => {
    expect(humanizeSlotLabel('paneer_filling')).toBe('Paneer (stuffing)')
    expect(humanizeSlotLabel('cauliflower_filling')).toBe('Cauliflower (stuffing)')
    expect(humanizeSlotLabel('radish_filling')).toBe('Radish (stuffing)')
    expect(humanizeSlotLabel('methi_leaves')).toBe('Fenugreek leaves (methi)')
    expect(humanizeSlotLabel('sattu_filling')).toBe('Roasted gram flour (sattu stuffing)')
  })

  it('prefers household-measured grams over fraction derivation', () => {
    const householdRow = {
      recipe_template_json: JSON.stringify({
        ingredientSlots: [slot('grain_flour', [0.6, 0.7], { amountPrior: { kind: 'HOUSEHOLD_MEASURED', grams: 33, verified: true } as never })],
      }),
      yield_model_json: '{}',
      portion_model_json: '{}',
    }
    const { lines } = dishIngredientBreakdown(householdRow)
    expect(lines[0]!.grams).toBe(33)
  })

  it('never crashes on unparseable or empty rows', () => {
    const empty = dishIngredientBreakdown({ recipe_template_json: null, yield_model_json: null, portion_model_json: null })
    expect(empty.lines).toEqual([])
    expect(empty.standardPortionGrams).toBeNull()
    const corrupt = dishIngredientBreakdown({ recipe_template_json: '{oops', yield_model_json: '{oops', portion_model_json: '{oops' })
    expect(corrupt.lines).toEqual([])
  })

  it('sums derived slot grams to the raw batch (portion / yield — mass conservation)', () => {
    const { lines, standardPortionGrams, verifiedNumericYield } = dishIngredientBreakdown(rotiRow)
    const total = lines.reduce((sum, line) => sum + line.grams, 0)
    expect(total).toBeCloseTo(standardPortionGrams! / verifiedNumericYield!, 0)
  })
})
