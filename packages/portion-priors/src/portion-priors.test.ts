import { describe, expect, it } from 'vitest'
import {
  listPortionPriors,
  lookupPrior,
  normalizePortionKey,
  priorToHint,
  type PortionUnit,
} from './index.js'

const UNITS: readonly PortionUnit[] = ['piece', 'katori', 'bowl', 'cup', 'ladle', 'serving']

describe('portion-priors dataset sanity', () => {
  const priors = listPortionPriors()

  it('seeds the required minimum set of Indian household portions', () => {
    // Task 2-c minimum: roti, paratha (plain+stuffed), naan, dosa, idli, vada,
    // dal, rice, sabzi, paneer curry, curd/raita, gulab jamun, samosa, papad,
    // upma, poha, khichdi, biryani, chutney, pickle (+chana masala).
    const keys = new Set(priors.map((p) => p.key))
    for (const required of [
      'roti',
      'paratha',
      'stuffed-paratha',
      'naan',
      'dosa',
      'idli',
      'vada',
      'dal',
      'rice-cooked',
      'sabzi',
      'paneer-curry',
      'chana-masala',
      'curd-raita',
      'gulab-jamun',
      'samosa',
      'papad',
      'upma',
      'poha',
      'khichdi',
      'biryani',
      'chutney',
      'pickle',
    ]) {
      expect(keys.has(required), `missing seed: ${required}`).toBe(true)
    }
  })

  it('every entry carries honest ranges, a unit, notes and a source', () => {
    for (const prior of priors) {
      const { min, typical, max } = prior.unitGrams
      expect(min, `${prior.key} min`).toBeGreaterThan(0)
      expect(min < typical, `${prior.key}: min < typical`).toBe(true)
      expect(typical < max, `${prior.key}: typical < max`).toBe(true)
      expect(UNITS, `${prior.key} unit`).toContain(prior.unit)
      expect(prior.displayName.length, `${prior.key} displayName`).toBeGreaterThan(0)
      expect(prior.notes.length, `${prior.key} notes`).toBeGreaterThan(10)
      expect(prior.source.length, `${prior.key} source`).toBeGreaterThan(5)
      expect(prior.source, `${prior.key} source must cite literature`).toMatch(/IFCT|NIN|Dish KB/)
      // perPiece is reserved for vessel-unit entries; a 'piece' entry carrying
      // one would be redundant duplication, not information.
      if (prior.unit === 'piece') expect(prior.perPiece, `${prior.key} perPiece`).toBeUndefined()
      if (prior.perPiece) {
        expect(prior.perPiece.min).toBeGreaterThan(0)
        expect(prior.perPiece.min < prior.perPiece.typical).toBe(true)
        expect(prior.perPiece.typical < prior.perPiece.max).toBe(true)
      }
    }
  })

  it('keys are unique and matcher-safe', () => {
    const keys = priors.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(normalizePortionKey(key.replace(/-/g, ' ')).length).toBeGreaterThan(2)
  })
})

describe('lookupPrior', () => {
  it('finds every seeded entry by its key', () => {
    for (const prior of listPortionPriors()) {
      expect(lookupPrior(prior.key.replace(/-/g, ' ')), prior.key)?.toBe(prior)
    }
  })

  it('matches compound dish keys via substring (the chana-masala case)', () => {
    expect(lookupPrior('chana masala')?.key).toBe('chana-masala')
    expect(lookupPrior('Chana Masala')?.key).toBe('chana-masala')
    expect(lookupPrior('chana masala with rice')?.key).toBe('chana-masala')
    expect(lookupPrior('kadai paneer')?.key).toBe('paneer-curry')
  })

  it('matches through plurals and stems', () => {
    expect(lookupPrior('2 rotis')?.key).toBe('roti')
    expect(lookupPrior('idlies')?.key).toBe('idli')
    expect(lookupPrior('samose')?.key ?? lookupPrior('samosas')?.key).toBe('samosa')
    expect(lookupPrior('papads')?.key).toBe('papad')
    expect(lookupPrior('chutneys')?.key).toBe('chutney')
  })

  it('longest phrase wins: stuffed paratha over plain, masala dosa over plain', () => {
    expect(lookupPrior('paratha')?.unitGrams.typical).toBe(75)
    expect(lookupPrior('aloo paratha')?.key).toBe('stuffed-paratha')
    expect(lookupPrior('gobi paratha')?.unitGrams.typical).toBe(100)
    expect(lookupPrior('masala dosa')?.unitGrams.typical).toBe(170)
    expect(lookupPrior('dosa')?.unitGrams.typical).toBe(120)
  })

  it('matches resolved display names the corpus actually returns', () => {
    expect(lookupPrior('Rice, white, long-grain, regular, cooked')?.key).toBe('rice-cooked')
    expect(lookupPrior('Pigeon pea (red gram), dal, cooked')?.key).toBe('dal')
    expect(lookupPrior('Dal Fry')?.key).toBe('dal')
    expect(lookupPrior('Curd, whole milk, plain')?.key).toBe('curd-raita')
  })

  it('refuses matches that the exclusion terms disqualify', () => {
    expect(lookupPrior('rice flour')).toBeNull()
    expect(lookupPrior('Rice, brown, long-grain, raw')).toBeNull()
    expect(lookupPrior('puffed rice')).toBeNull()
    expect(lookupPrior('Rice paper')).toBeNull()
    expect(lookupPrior('chicken breast')).toBeNull()
    expect(lookupPrior('')).toBeNull()
  })

  it('priorToHint projects exactly the cross-package hint contract', () => {
    const prior = lookupPrior('dal')!
    const hint = priorToHint(prior)
    expect(Object.keys(hint).sort()).toEqual(['max', 'min', 'source', 'typical', 'unit'])
    expect(hint).toEqual({
      unit: 'katori',
      typical: 150,
      min: 120,
      max: 180,
      source: prior.source,
    })
  })
})
