import { describe, expect, it } from 'vitest'
import { rankSearch, type SearchEntity } from './index.js'

describe('Food Search Ranking and Filters (SRH-002)', () => {
  const foodEntities: SearchEntity[] = [
    {
      id: 'usda:chicken',
      type: 'food',
      label: 'Chicken breast, skinless, boneless',
      aliases: ['Chicken breast'],
      source: 'usda',
      provenance: 'USDA FoodData Central',
      coverage: 0.85,
    },
    {
      id: 'packaged:12345',
      type: 'food',
      label: 'Brand X High Protein Chicken Breast',
      aliases: ['Brand X Chicken'],
      barcode: '8901234567890',
      source: 'off',
      provenance: 'Open Food Facts',
      coverage: 0.9,
    },
    {
      id: 'ifct:toor',
      type: 'food',
      label: 'Red gram, dal',
      aliases: ['Toor dal', 'Arhar dal', 'Tuvar dal'],
      source: 'ifct',
      provenance: 'IFCT 2017 · ICMR-NIN',
      coverage: 0.95,
    },
    {
      id: 'usda:pigeonpea',
      type: 'food',
      label: 'Pigeon peas (red gram), mature seeds, raw',
      aliases: ['Red gram raw', 'Arhar raw'],
      source: 'usda',
      provenance: 'USDA FoodData Central',
      coverage: 0.7,
    },
    {
      id: 'recipe:dal_fry',
      type: 'recipe',
      label: 'Home Dal Fry',
      aliases: ['Dal fry', 'Toor dal fry', 'Arhar dal', 'Arhar dal tadka'],
      source: 'recipe',
      provenance: 'Household Recipe',
      coverage: 0.92,
    },
    {
      id: 'usda:dal_fry',
      type: 'food',
      label: 'Restaurant Dal Fry',
      aliases: ['Dal fry'],
      source: 'usda',
      provenance: 'USDA FoodData Central',
      coverage: 0.75,
    },
    {
      id: 'custom:roti',
      type: 'food',
      label: 'My Homemade Roti',
      aliases: ['Chapati', 'Phulka'],
      source: 'user',
      provenance: 'Custom food',
      custom: true,
      favorite: true,
      frequent: 10,
      coverage: 0.8,
    },
  ]

  it('prioritizes exact barcode match over any text search matches', () => {
    const res = rankSearch(foodEntities, {
      query: '8901234567890',
      locale: 'en-IN',
      scopes: ['food'],
      limit: 10,
    })
    expect(res.results.length).toBe(1)
    expect(res.results[0]?.id).toBe('packaged:12345')
    expect(res.results[0]?.score).toBeGreaterThanOrEqual(10000)
  })

  it('ranks household recipes higher than IFCT and USDA when confidence is equal', () => {
    const res = rankSearch(foodEntities, {
      query: 'dal fry',
      locale: 'en-IN',
      scopes: ['food', 'recipe'],
      limit: 10,
    })
    const recipeIndex = res.results.findIndex((r) => r.id === 'recipe:dal_fry')
    const usdaIndex = res.results.findIndex((r) => r.id === 'usda:dal_fry')

    expect(recipeIndex).toBeGreaterThanOrEqual(0)
    expect(usdaIndex).toBeGreaterThanOrEqual(0)
    // Both matched via exact alias 'dal fry' (950), but recipe got +80 vs USDA +0
    expect(recipeIndex).toBeLessThan(usdaIndex)
    expect(res.results[recipeIndex]!.score).toBeGreaterThan(res.results[usdaIndex]!.score)
  })

  it('resolves Hinglish alias "arhar dal" to canonical toor / red gram with IFCT provenance', () => {
    const res = rankSearch(foodEntities, {
      query: 'arhar dal',
      locale: 'en-IN',
      scopes: ['food'],
      limit: 5,
    })
    const ifctResult = res.results.find((r) => r.id === 'ifct:toor')
    expect(ifctResult).toBeDefined()
    expect(ifctResult?.provenance).toBe('IFCT 2017 · ICMR-NIN')
    expect(ifctResult?.matched_tokens).toContain('arhar dal')
  })

  it('applies favorite and frequent boost to custom foods', () => {
    const res = rankSearch(foodEntities, {
      query: 'roti',
      locale: 'en-IN',
      scopes: ['food'],
      limit: 5,
    })
    const roti = res.results.find((r) => r.id === 'custom:roti')
    expect(roti).toBeDefined()
    // 500 (token) + 50 (custom) + 30 (favorite) + 10 (frequent) = 590
    expect(roti?.score).toBeGreaterThanOrEqual(590)
  })

  it('filters by micronutrient coverage', () => {
    const highCoverageOnly = rankSearch(foodEntities, {
      query: 'gram',
      locale: 'en-IN',
      scopes: ['food', 'recipe'],
      limit: 10,
      filters: { coverage: 0.9 },
    })
    expect(highCoverageOnly.results.every((r) => (r.coverage ?? 0) >= 0.9)).toBe(true)
    expect(highCoverageOnly.results.some((r) => r.id === 'usda:pigeonpea')).toBe(false)
  })

  it('filters by source', () => {
    const ifctOnly = rankSearch(foodEntities, {
      query: 'gram',
      locale: 'en-IN',
      scopes: ['food'],
      limit: 10,
      filters: { source: 'ifct' },
    })
    expect(ifctOnly.results.every((r) => r.source === 'ifct')).toBe(true)
  })

  it('preserves provenance attribution in every result', () => {
    const res = rankSearch(foodEntities, {
      query: '',
      locale: 'en-IN',
      scopes: ['food', 'recipe'],
      limit: 10,
      allowEmpty: true,
    })
    for (const r of res.results) {
      expect(r.provenance).toBeTruthy()
      expect(typeof r.provenance).toBe('string')
    }
  })
})
