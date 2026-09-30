import { describe, expect, it } from 'vitest'
import { householdUnitForStrategies, portionHintsForDish } from './dish-portions.js'

/**
 * Task 2-c — Dish KB portion model -> PortionHint wire shape.
 *
 * The values cross-checked here come from the real 362-dish manifest
 * (docs/data/indian-dishes.mapped.json), so the unit inference stays honest
 * against the actual strategy vocabulary the curation pass emits.
 */

describe('portionHintsForDish', () => {
  it('converts the curated standard portion into a range-carrying hint', () => {
    const hints = portionHintsForDish({
      canonicalName: 'Plain Dosa',
      portionModel: {
        strategies: ['count', 'diameter', 'cooked_weight_g'],
        standardPortionGrams: 80,
        standardPortionStatus: 'verified',
        assumptionClass: 'CURATED_PRIOR',
      },
    })
    expect(hints).toHaveLength(1)
    expect(hints[0]).toMatchObject({ unit: 'piece', typical: 80, min: 60, max: 100 })
    // The source string must disclose BOTH the origin and the widening.
    expect(hints[0]?.source).toContain('Dish KB')
    expect(hints[0]?.source).toContain('Plain Dosa')
    expect(hints[0]?.source).toContain('±25%')
  })

  it('labels katori dishes katori and plate dishes serving (manifest-verified cases)', () => {
    expect(
      portionHintsForDish({
        canonicalName: 'Toor Dal',
        portionModel: { strategies: ['measured_g', 'katori_volume', 'ladle'], standardPortionGrams: 150 },
      })[0]?.unit,
    ).toBe('katori')

    expect(
      portionHintsForDish({
        canonicalName: 'Biryani',
        portionModel: { strategies: ['measured_g', 'plate_volume', 'katori_volume'], standardPortionGrams: 300 },
      })[0]?.unit,
    ).toBe('serving')

    expect(
      portionHintsForDish({
        canonicalName: 'Khichdi',
        portionModel: { strategies: ['measured_g', 'katori_volume', 'plate_volume'], standardPortionGrams: 250 },
      })[0]?.unit,
    ).toBe('katori')
  })

  it('prefers piece over bowl when both strategies exist (gulab jamun syrup bowl)', () => {
    expect(
      portionHintsForDish({
        canonicalName: 'Gulab Jamun',
        portionModel: { strategies: ['count', 'piece_weight_g', 'bowl_volume'], standardPortionGrams: 50 },
      })[0]?.unit,
    ).toBe('piece')
  })

  it('returns NO hint when the curated portion is absent or unusable', () => {
    expect(portionHintsForDish({ canonicalName: 'Draft Dish', portionModel: null })).toEqual([])
    expect(portionHintsForDish({ canonicalName: 'Draft Dish', portionModel: { standardPortionGrams: null } })).toEqual([])
    expect(portionHintsForDish({ canonicalName: 'Draft Dish', portionModel: { standardPortionGrams: 0 } })).toEqual([])
    expect(portionHintsForDish({ canonicalName: 'Draft Dish', portionModel: { standardPortionGrams: -40 } })).toEqual([])
  })

  it('always keeps min < typical < max after rounding', () => {
    for (const std of [5, 10, 40, 80, 150, 300, 1000]) {
      const hint = portionHintsForDish({
        canonicalName: `Dish ${std}`,
        portionModel: { strategies: ['measured_g'], standardPortionGrams: std },
      })[0]
      expect(hint).toBeDefined()
      expect(hint!.min).toBeLessThan(hint!.typical)
      expect(hint!.typical).toBeLessThan(hint!.max)
    }
  })
})

describe('householdUnitForStrategies', () => {
  it('falls back to serving when nothing better is known', () => {
    expect(householdUnitForStrategies([], 100)).toBe('serving')
    expect(householdUnitForStrategies(null, 100)).toBe('serving')
    expect(householdUnitForStrategies(['wrapper_size', 'measured_g'], 100)).toBe('serving')
  })

  it('maps vessel and glass strategies to the PortionUnit vocabulary', () => {
    expect(householdUnitForStrategies(['bowl_volume'], 350)).toBe('bowl')
    expect(householdUnitForStrategies(['glass_volume'], 250)).toBe('cup')
    expect(householdUnitForStrategies(['ladle'], 120)).toBe('ladle')
    expect(householdUnitForStrategies(['serving_spoon'], 120)).toBe('ladle')
  })
})
