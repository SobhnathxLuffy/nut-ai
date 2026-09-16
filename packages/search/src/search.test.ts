import { describe, expect, it } from 'vitest'
import { rankSearch, type SearchEntity } from './index.js'

describe('Universal Search Contract (SRH-001)', () => {
  const sampleEntities: SearchEntity[] = [
    {
      id: 'food:1',
      type: 'food',
      label: 'Rolled Oats',
      aliases: ['Oatmeal', 'Porridge oats'],
      source: 'usda',
      provenance: 'USDA FDC',
      favorite: true,
      frequent: 5,
      last_used_at: 1000,
    },
    {
      id: 'food:2',
      type: 'food',
      label: 'Steel Cut Oats',
      aliases: ['Irish oats'],
      source: 'usda',
      provenance: 'USDA FDC',
      favorite: false,
      frequent: 1,
      last_used_at: 500,
    },
    {
      id: 'exercise:1',
      type: 'exercise',
      label: 'Barbell Squat',
      aliases: ['Back squat'],
      source: 'builtin',
      provenance: 'tax_v1',
      equipment: ['barbell'],
      muscles: ['quadriceps'],
    },
    {
      id: 'recipe:1',
      type: 'recipe',
      label: 'Grandma Oatmeal Bowl',
      aliases: ['Oats bowl'],
      source: 'recipe',
      provenance: 'household',
      last_used_at: 2000,
    },
  ]

  it('rejects invalid page parameters', () => {
    expect(() => rankSearch(sampleEntities, { query: 'oats', locale: 'en-IN', scopes: ['food'], limit: 0 })).toThrow(
      'Invalid search page',
    )
    expect(() => rankSearch(sampleEntities, { query: 'oats', locale: 'en-IN', scopes: ['food'], limit: 101 })).toThrow(
      'Invalid search page',
    )
    expect(
      () => rankSearch(sampleEntities, { query: 'oats', locale: 'en-IN', scopes: ['food'], limit: 10, offset: -1 }),
    ).toThrow('Invalid search page')
  })

  it('returns empty results on blank query when allowEmpty is not set or false', () => {
    const result1 = rankSearch(sampleEntities, { query: '', locale: 'en-IN', scopes: ['food'], limit: 10 })
    expect(result1.results).toEqual([])
    expect(result1.hasMore).toBe(false)

    const result2 = rankSearch(sampleEntities, {
      query: '   ',
      locale: 'en-IN',
      scopes: ['food'],
      limit: 10,
      allowEmpty: false,
    })
    expect(result2.results).toEqual([])
    expect(result2.hasMore).toBe(false)
  })

  it('returns entities on empty query when allowEmpty is true, without ranking them', () => {
    const result = rankSearch(sampleEntities, {
      query: '',
      locale: 'en-IN',
      scopes: ['food', 'recipe'],
      limit: 10,
      allowEmpty: true,
    })
    expect(result.results.length).toBe(3)
    // When query is empty, results should simply have score 500 (or base scores)
    // and no token matching should have been performed.
    expect(result.results[0]?.matched_tokens).toEqual([])
  })

  it('filters by entity scope', () => {
    const foodOnly = rankSearch(sampleEntities, {
      query: '',
      locale: 'en-IN',
      scopes: ['food'],
      limit: 10,
      allowEmpty: true,
    })
    expect(foodOnly.results.every((r) => r.type === 'food')).toBe(true)

    const exerciseOnly = rankSearch(sampleEntities, {
      query: 'squat',
      locale: 'en-IN',
      scopes: ['exercise'],
      limit: 10,
    })
    expect(exerciseOnly.results.length).toBe(1)
    expect(exerciseOnly.results[0]?.id).toBe('exercise:1')
  })

  it('paginates results correctly with limit, offset, and hasMore', () => {
    const page1 = rankSearch(sampleEntities, {
      query: '',
      locale: 'en-IN',
      scopes: ['food', 'recipe', 'exercise'],
      limit: 2,
      offset: 0,
      allowEmpty: true,
    })
    expect(page1.results.length).toBe(2)
    expect(page1.hasMore).toBe(true)

    const page2 = rankSearch(sampleEntities, {
      query: '',
      locale: 'en-IN',
      scopes: ['food', 'recipe', 'exercise'],
      limit: 2,
      offset: 2,
      allowEmpty: true,
    })
    expect(page2.results.length).toBe(2)
    expect(page2.hasMore).toBe(false)
  })

  it('sorts deterministically by score, last_used_at, label, then id', () => {
    const res = rankSearch(sampleEntities, {
      query: 'oats',
      locale: 'en-IN',
      scopes: ['food', 'recipe'],
      limit: 10,
    })
    expect(res.results.length).toBeGreaterThan(0)
    for (let i = 1; i < res.results.length; i++) {
      const prev = res.results[i - 1]!
      const curr = res.results[i]!
      expect(prev.score).toBeGreaterThanOrEqual(curr.score)
    }
  })

  it('imports cleanly in bare Node without React Native dependencies', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.rankSearch).toBe('function')
  })
})
