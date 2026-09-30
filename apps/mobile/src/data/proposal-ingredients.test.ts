import { describe, expect, it } from 'vitest'
import { expandProposalIngredients } from './proposal-ingredients'

/**
 * "log 2 rotis" must expand into 2 rows of per-unit grams — never one row of
 * the combined weight. The model is prompted to send unit_count + per-unit
 * grams; these tests pin the defensive handling of everything else it might
 * send (totals, missing counts, absurd counts, junk).
 */
describe('expandProposalIngredients', () => {
  it('unit_count 2 with per-unit grams -> 2 rows of 40 g', () => {
    const [r] = expandProposalIngredients([{ name: 'Roti', grams: 40, unit_count: 2 }])
    expect(r.rows).toBe(2)
    expect(r.perUnitGrams).toBe(40)
    expect(r.display).toBe('Roti — 2 × 40 g')
  })

  it('a per-unit value above the plausibility ceiling is read as a TOTAL and divided', () => {
    // Legacy/loose model behaviour: "2 rotis" arriving as grams 240 total.
    const [r] = expandProposalIngredients([{ name: 'Roti', grams: 240, unit_count: 2 }])
    expect(r.rows).toBe(2)
    expect(r.perUnitGrams).toBe(120)
    expect(r.display).toBe('Roti — 2 × 120 g')
  })

  it('no count -> one row with the total grams', () => {
    const [r] = expandProposalIngredients([{ name: 'Dal', grams: 150 }])
    expect(r.rows).toBe(1)
    expect(r.perUnitGrams).toBe(150)
    expect(r.display).toBe('Dal — 150 g')
  })

  it('multi-food proposals expand independently in one call', () => {
    const out = expandProposalIngredients([
      { name: 'Roti', grams: 40, unit_count: 2 },
      { name: 'Dal', grams: 150 },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]!.rows).toBe(2)
    expect(out[1]!.rows).toBe(1)
  })

  it('count 0, negative or junk collapses to one row; missing grams default to 100', () => {
    for (const unit_count of [0, -3, 'two', null]) {
      const [r] = expandProposalIngredients([{ name: 'Idli', grams: 45, unit_count }])
      expect(r.rows).toBe(1)
      expect(r.perUnitGrams).toBe(45)
    }
    const [fallback] = expandProposalIngredients([{ name: 'Mystery' }])
    expect(fallback!.perUnitGrams).toBe(100)
  })

  it('counts above 8 collapse back to ONE total-weight row (no review-screen floods)', () => {
    const [r] = expandProposalIngredients([{ name: 'Biscuit', grams: 25, unit_count: 12 }])
    expect(r.rows).toBe(1)
    expect(r.perUnitGrams).toBe(300)
    expect(r.display).toBe('Biscuit — 12 × 25 g')
  })

  it('non-array input yields an empty expansion instead of throwing', () => {
    expect(expandProposalIngredients(null)).toEqual([])
    expect(expandProposalIngredients('roti')).toEqual([])
  })
})
