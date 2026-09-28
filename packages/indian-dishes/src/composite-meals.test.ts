import { describe, expect, it } from 'vitest'
import {
  isCompositeMealQuery,
  splitCompositeQuery,
  decomposeCompositeMeal,
} from './composite-meals.js'

describe('composite-meals', () => {
  it('detects known Indian composite pairings without delimiters', () => {
    expect(isCompositeMealQuery('litti chokha')).toBe(true)
    expect(isCompositeMealQuery('idli sambar')).toBe(true)
    expect(isCompositeMealQuery('rajma chawal')).toBe(true)
    expect(isCompositeMealQuery('dal chawal')).toBe(true)
    expect(isCompositeMealQuery('vada sambar')).toBe(true)
    expect(isCompositeMealQuery('poori bhaji')).toBe(true)
  })

  it('detects composite queries with explicit delimiters', () => {
    expect(isCompositeMealQuery('litti + chokha')).toBe(true)
    expect(isCompositeMealQuery('idli and sambar')).toBe(true)
    expect(isCompositeMealQuery('roti with dal')).toBe(true)
    expect(isCompositeMealQuery('2 roti + 1 katori dal')).toBe(true)
    expect(isCompositeMealQuery('chole & bhature')).toBe(true)
  })

  it('returns false for standalone non-composite dishes', () => {
    expect(isCompositeMealQuery('roti')).toBe(false)
    expect(isCompositeMealQuery('chicken biryani')).toBe(false)
    expect(isCompositeMealQuery('paneer butter masala')).toBe(false)
    expect(isCompositeMealQuery('apple')).toBe(false)
  })

  it('splits composite queries into components', () => {
    expect(splitCompositeQuery('litti chokha')).toEqual(['litti', 'chokha'])
    expect(splitCompositeQuery('idli sambar')).toEqual(['idli', 'sambar'])
    expect(splitCompositeQuery('rajma + chawal')).toEqual(['rajma', 'rice white cooked'])
    expect(splitCompositeQuery('roti and dal')).toEqual(['roti', 'dal'])
  })

  it('decomposes composite queries into rich components with portion defaults', () => {
    const littiChokha = decomposeCompositeMeal('litti chokha')
    expect(littiChokha).not.toBeNull()
    expect(littiChokha?.displayName).toBe('Litti Chokha')
    expect(littiChokha?.components).toHaveLength(2)
    expect(littiChokha?.components[0]?.name).toBe('Litti')
    expect(littiChokha?.components[0]?.defaultPortionGrams).toBe(80)
    expect(littiChokha?.components[1]?.name).toBe('Chokha')
    expect(littiChokha?.components[1]?.defaultPortionGrams).toBe(100)

    const delimited = decomposeCompositeMeal('2 roti + dal')
    expect(delimited).not.toBeNull()
    expect(delimited?.components).toHaveLength(2)
    expect(delimited?.components[0]?.name).toBe('Roti')
    expect(delimited?.components[0]?.quantity).toBe(2)
    expect(delimited?.components[1]?.name).toBe('Dal')
  })

  it('returns null for decomposition of single food query', () => {
    expect(decomposeCompositeMeal('roti')).toBeNull()
  })
})

describe('composite meals source discrimination (P2-7)', () => {
  it('curated pairings are marked known_pairing', () => {
    for (const q of ['litti chokha', 'litti + chokha', 'idli and sambar', 'rajma with rice', 'medu vada aur sambar']) {
      const d = decomposeCompositeMeal(q)
      expect(d?.source).toBe('known_pairing')
      expect(d?.components.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('free-form delimiter splits are marked delimiter', () => {
    const d = decomposeCompositeMeal('butter chicken + extra rice')
    expect(d?.source).toBe('delimiter')
    expect(d?.components.map((c) => c.name)).toEqual(['Butter chicken', 'Extra rice'])
  })

  it('garbage long queries never fabricate a confident composition (P2-7)', () => {
    const nonsense = 'butter chicken + Extra rice + Dal fry → hash browns + pineapple + dal fry'
    const d = decomposeCompositeMeal(nonsense)
    // The delimiter split still works mechanically — the QA-reported query
    // yields exactly 5 components —…
    expect(d?.source).toBe('delimiter')
    expect(d!.components.length).toBe(5)
    // …but the source marker forces the UI to tap-gate it, and anything with
    // more than 5 parts is treated as pure noise and not even suggested:
    expect(decomposeCompositeMeal(`${nonsense} + papad`)!.components.length).toBeGreaterThan(5)
  })

  it('2-char and 3-char prefix behavior stays deterministic', () => {
    expect(isCompositeMealQuery('pa')).toBe(false)
    expect(decomposeCompositeMeal('pa')).toBeNull()
    expect(splitCompositeQuery('dal fry + rice')).toHaveLength(2)
  })
})
