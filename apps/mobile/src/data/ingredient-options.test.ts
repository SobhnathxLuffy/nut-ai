import { describe, expect, it, vi, beforeEach } from 'vitest'

const searches: Array<{ sourceId: string; expression: string }> = []

vi.mock('@nutai/nutrition-sources', () => {
  function makeSource(id: string, rows: Array<{ foodId: string; name: string; energyKcal: number | null; matchOn: string[] }>) {
    return class {
      constructor(_db: unknown) {}
      async search(expression: string) {
        searches.push({ sourceId: id, expression })
        // Return rows when the expression mentions any of the row's keyword
        // variants — simulates an FTS corpus responding to alias queries.
        return rows.filter((r) => r.matchOn.some((k) => expression.toLowerCase().includes(k)))
      }
    }
  }
  return {
    UserFoodSource: makeSource('userfood', []),
    IFCTSource: makeSource('ifct', [
      { foodId: 'ifct:FEN1', name: 'Fenugreek leaves', energyKcal: 10, matchOn: ['fenugreek'] },
      { foodId: 'ifct:BG1', name: 'Bengal gram, dal', energyKcal: 372, matchOn: ['bengal', 'chana', 'besan', 'chickpea'] },
    ]),
    USDASource: makeSource('usda', [
      { foodId: 'usda:YOG1', name: 'Yogurt, plain whole milk', energyKcal: 61, matchOn: ['yogurt'] },
      { foodId: 'usda:EGG1', name: 'Eggplant, raw', energyKcal: 25, matchOn: ['eggplant'] },
      { foodId: 'usda:CHP1', name: 'Chickpea flour (besan)', energyKcal: 387, matchOn: ['chickpea', 'besan'] },
    ]),
  }
})

import { expandIngredientTerm, searchIngredientOptions } from './ingredient-options'
import type { DbAdapter } from '@nutai/db-adapter'

const fakeDb = {} as DbAdapter

describe('expandIngredientTerm', () => {
  it('returns the original term for plain words (plus harmless reverse aliases)', () => {
    // Bidirectional synonyms add the Hindi spelling too — extra recall, never
    // a loss: the original term is always variant #1.
    const out = expandIngredientTerm('onion')
    expect(out[0]).toBe('onion')
    expect(out).toContain('pyaz')
  })

  it('returns empty for punctuation-only queries', () => {
    expect(expandIngredientTerm('  !!! ')).toEqual([])
  })

  it('expands Indian names to their English canonical (methi → fenugreek)', () => {
    const out = expandIngredientTerm('methi')
    expect(out).toContain('methi')
    expect(out).toContain('fenugreek')
  })

  it('expands corpus-naming English synonyms bidirectionally (curd ↔ yogurt)', () => {
    expect(expandIngredientTerm('curd')).toContain('yogurt')
    expect(expandIngredientTerm('yogurt')).toContain('curd')
  })

  it('expands brinjal to eggplant and back', () => {
    expect(expandIngredientTerm('brinjal')).toContain('eggplant')
    expect(expandIngredientTerm('eggplant')).toContain('brinjal')
  })

  it('expands multi-word phrases (gram flour → besan + chickpea flour)', () => {
    const out = expandIngredientTerm('gram flour')
    expect(out).toContain('besan')
    expect(out).toContain('chickpea flour')
  })

  it('is bounded to a small number of variants', () => {
    expect(expandIngredientTerm('curd').length).toBeLessThanOrEqual(5)
  })
})

describe('searchIngredientOptions', () => {
  beforeEach(() => {
    searches.length = 0
  })

  it('queries all three corpora for every expanded variant', async () => {
    const options = await searchIngredientOptions(fakeDb, fakeDb, undefined, 'methi')
    const ifctExpressions = searches.filter((s) => s.sourceId === 'ifct').map((s) => s.expression)
    const usdaExpressions = searches.filter((s) => s.sourceId === 'usda').map((s) => s.expression)
    // Both the raw Hindi token and its canonical form must reach each corpus.
    expect(ifctExpressions.some((e) => e.includes('methi'))).toBe(true)
    expect(ifctExpressions.some((e) => e.includes('fenugreek'))).toBe(true)
    expect(usdaExpressions.length).toBe(ifctExpressions.length)
    expect(options.some((o) => o.source === 'ifct' && o.foodId === 'ifct:FEN1')).toBe(true)
    expect(options.every((o) => o.source !== 'userfood')).toBe(true)
  })

  it('finds USDA yogurt rows when the user types curd', async () => {
    const options = await searchIngredientOptions(fakeDb, fakeDb, undefined, 'curd')
    expect(options.some((o) => o.source === 'usda' && o.foodId === 'usda:YOG1')).toBe(true)
  })

  it('finds chickpea/gram-flour rows for besan across corpora', async () => {
    const options = await searchIngredientOptions(fakeDb, fakeDb, undefined, 'besan')
    expect(options.some((o) => o.source === 'usda' && o.foodId === 'usda:CHP1')).toBe(true)
    expect(options.some((o) => o.source === 'ifct' && o.foodId === 'ifct:BG1')).toBe(true)
  })

  it('keeps per-source cohort caps and dedupes across corpora', async () => {
    const options = await searchIngredientOptions(fakeDb, fakeDb, undefined, 'eggplant')
    const usdaRows = options.filter((o) => o.source === 'usda')
    expect(usdaRows.length).toBeLessThanOrEqual(6)
    const ids = options.map((o) => o.foodId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns [] for empty queries', async () => {
    expect(await searchIngredientOptions(fakeDb, fakeDb, undefined, '  ')).toEqual([])
  })
})
