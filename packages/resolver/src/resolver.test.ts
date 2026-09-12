import { beforeEach, describe, expect, it } from 'vitest'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  AUTO_ACCEPT,
  decideOutcome,
  gs1CheckDigit,
  isValidGtin,
  matchLadder,
  normalizeBm25,
  normalizeGtin,
  prepMatch,
  resolveByBarcode,
  resolveByText,
  scoreCandidates,
  toMatchExpression,
  upcEToUpcA,
  type Candidate,
  type ScoringContext,
} from './index.js'

// ---------------------------------------------------------------------------
// GTIN normalization
// ---------------------------------------------------------------------------

describe('GTIN normalization', () => {
  it('resolves a UPC-A and its EAN-13 equivalent to the same canonical form', () => {
    // A UPC-A is an EAN-13 with a leading zero.
    const upcA = '012345678905'
    const ean13 = '0012345678905'
    expect(normalizeGtin(upcA)).toBe(normalizeGtin(ean13))
    expect(normalizeGtin(upcA)).toHaveLength(13)
  })

  it('computes GS1 mod-10 check digits', () => {
    expect(gs1CheckDigit('01234567890')).toBe(5)
    expect(isValidGtin('012345678905')).toBe(true)
    expect(isValidGtin('012345678901')).toBe(false)
  })

  it('expands UPC-E to UPC-A', () => {
    const upce = '01234565'
    const expanded = upcEToUpcA(upce)
    expect(expanded).not.toBeNull()
    expect(expanded).toHaveLength(12)
  })

  it('rejects nonsense rather than guessing', () => {
    expect(normalizeGtin('hello')).toBeNull()
    expect(normalizeGtin('')).toBeNull()
    expect(normalizeGtin('123')).toBeNull()
  })

  it('strips a GTIN-14 packaging indicator when the inner 13 validates', () => {
    const inner = normalizeGtin('012345678905')!
    expect(normalizeGtin(`1${inner}`)).toBe(inner)
  })
})

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

describe('FTS query construction', () => {
  it('quotes every token so operators cannot leak in from food names', () => {
    expect(toMatchExpression('chicken OR breast')).toBe('"chicken" "or" "breast"')
    expect(toMatchExpression('chicken - breast')).toBe('"chicken" "breast"')
  })

  it('splits on commas, matching USDA naming', () => {
    expect(toMatchExpression('chicken breast, grilled')).toBe('"chicken" "breast" "grilled"')
  })

  it('returns null for an empty query rather than a matcher that errors', () => {
    expect(toMatchExpression('   ')).toBeNull()
    expect(toMatchExpression('***')).toBeNull()
  })

  it('builds a ladder that drops trailing modifiers before the head noun', () => {
    const ladder = matchLadder('chicken breast, grilled')
    expect(ladder[0]).toBe('"chicken" "breast" "grilled"')
    expect(ladder[1]).toBe('"chicken" "breast"')
    expect(ladder[2]).toBe('"chicken"')
    expect(ladder.at(-1)).toContain('OR')
  })
})

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    foodId: 'f1',
    name: 'Chicken breast, grilled',
    brand: null,
    category: 'poultry',
    prepFacet: 'grilled',
    basisConfidence: 'high',
    servingSizeG: 85,
    energyKcal: 165,
    popularityRank: 10,
    completenessScore: 0.9,
    rawBm25: -5,
    ...over,
  }
}

const ctx: ScoringContext = {
  canonicalFoodKey: 'chicken breast, grilled',
  observedBrand: null,
  prepFacet: 'grilled',
  modelCategory: 'poultry',
  estimatedGrams: 170,
}

describe('scoring', () => {
  it('treats an untagged prep facet as unknown, not as a conflict', () => {
    expect(prepMatch(cand({ prepFacet: null }), ctx)).toBe(0.5)
    expect(prepMatch(cand({ prepFacet: 'grilled' }), ctx)).toBe(1)
    expect(prepMatch(cand({ prepFacet: 'raw' }), ctx)).toBe(0)
  })

  it('does not hand a lone candidate a free perfect relevance score', () => {
    const norm = normalizeBm25([cand()])
    expect(norm.get('f1')).toBe(0.5)
  })

  it('ranks an exact brand match above a generic row', () => {
    const scored = scoreCandidates(
      [
        cand({ foodId: 'generic', brand: null, rawBm25: -5 }),
        cand({ foodId: 'branded', brand: 'Perdue', rawBm25: -5 }),
      ],
      { ...ctx, observedBrand: 'Perdue' },
    )
    expect(scored[0]?.foodId).toBe('branded')
  })

  it('penalizes a row whose typical portion is nowhere near the estimate', () => {
    const scored = scoreCandidates(
      [
        cand({ foodId: 'cube', servingSizeG: 4, typicalGramsMin: 2, typicalGramsMax: 6 }),
        cand({ foodId: 'breast', servingSizeG: 85, typicalGramsMin: 60, typicalGramsMax: 250 }),
      ],
      ctx,
    )
    expect(scored[0]?.foodId).toBe('breast')
  })

  it('penalizes an incomplete row for untrustworthy unit math', () => {
    const good = scoreCandidates([cand({ foodId: 'a' })], ctx)[0]!
    const bad = scoreCandidates(
      [cand({ foodId: 'b', basisConfidence: 'low', completenessScore: 0.2 })],
      ctx,
    )[0]!
    expect(bad.score).toBeLessThan(good.score)
  })
})

describe('the two-part auto-accept rule', () => {
  const strong = { ...cand({ foodId: 'top' }), score: 0.8, breakdown: {} }
  const near = { ...cand({ foodId: 'near' }), score: 0.75, breakdown: {} }
  const weak = { ...cand({ foodId: 'weak' }), score: 0.4, breakdown: {} }

  it('auto-accepts a strong, clearly-separated top match', () => {
    const out = decideOutcome([strong, weak])
    expect(out.kind).toBe('auto_accept')
  })

  it('refuses to auto-accept a great score beside a near-duplicate', () => {
    // Two branded SKUs of the same product at different pack sizes. Both clear
    // the absolute floor; the user should glance at it.
    const out = decideOutcome([strong, near])
    expect(out.kind).toBe('disambiguate')
  })

  it('refuses to auto-accept a mediocre top score just because nothing else came close', () => {
    // A genuinely novel dish with five equally-bad candidates.
    const out = decideOutcome([{ ...weak, score: 0.45 }, { ...cand({ foodId: 'x' }), score: 0.1, breakdown: {} }])
    expect(out.kind).toBe('disambiguate')
  })

  it('reports a miss on an empty candidate set', () => {
    expect(decideOutcome([]).kind).toBe('miss')
  })

  it('caps the disambiguation sheet at five options', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...cand({ foodId: `f${i}` }), score: 0.5 - i * 0.001, breakdown: {},
    }))
    const out = decideOutcome(many)
    expect(out.kind).toBe('disambiguate')
    if (out.kind === 'disambiguate') expect(out.candidates).toHaveLength(5)
  })

  it('uses the documented thresholds', () => {
    expect(AUTO_ACCEPT.minScore).toBe(0.6)
    expect(AUTO_ACCEPT.minGap).toBe(0.12)
  })
})

// ---------------------------------------------------------------------------
// Against a real SQLite database
// ---------------------------------------------------------------------------

describe('resolution against a real corpus', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(NUTRITION_FTS_SCHEMA)

    const foods: Array<[number, string, string, string | null, number, string | null, number]> = [
      [1, 'fdc_sr_legacy', 'Chicken, broilers or fryers, breast, meat only, cooked, grilled', 'grilled', 165, null, 10],
      [2, 'fdc_sr_legacy', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'roasted', 172, null, 20],
      [3, 'fdc_sr_legacy', 'Rice, white, long-grain, regular, cooked', 'boiled', 130, null, 5],
      [4, 'fdc_branded', 'Granola Bar, Chewy', null, 400, '0012345678905', 100],
    ]
    for (const [id, source, name, prep, kcal, barcode, rank] of foods) {
      await db.run(
        `INSERT INTO foods (id, source, name, prep_facet, energy_kcal, barcode, popularity_rank,
                            license, basis_confidence, completeness_score)
         VALUES (?,?,?,?,?,?,?,'CC0','high',0.9)`,
        [id, source, name, prep, kcal, barcode, rank],
      )
      await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)', [
        id, name, '', '',
      ])
    }
  })

  it('finds a food regardless of word order', async () => {
    const r = await resolveByText(db, {
      canonicalFoodKey: 'chicken breast grilled',
      observedBrand: null, prepFacet: 'grilled', modelCategory: null, estimatedGrams: 170,
    })
    expect(r.zeroHit).toBe(false)
    const ids = r.outcome.kind === 'auto_accept'
      ? [r.outcome.match.foodId]
      : r.outcome.kind === 'disambiguate' ? r.outcome.candidates.map((c) => c.foodId) : []
    expect(ids.map(String)).toContain('usda:1')
  })

  it('prefers the grilled row over the roasted one when the model saw grill marks', async () => {
    const r = await resolveByText(db, {
      canonicalFoodKey: 'chicken breast',
      observedBrand: null, prepFacet: 'grilled', modelCategory: null, estimatedGrams: 170,
    })
    const first = r.outcome.kind === 'auto_accept'
      ? r.outcome.match
      : r.outcome.kind === 'disambiguate' ? r.outcome.candidates[0] : null
    expect(String(first?.foodId)).toBe('usda:1')
  })

  it('broadens down the ladder rather than giving up on one absent token', async () => {
    const r = await resolveByText(db, {
      canonicalFoodKey: 'chicken breast, sousvide',
      observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: 170,
    })
    expect(r.zeroHit).toBe(false)
    expect(r.ladderStep).toBeGreaterThan(0)
  })

  it('reports an honest zero-hit for a food that is genuinely absent', async () => {
    const r = await resolveByText(db, {
      canonicalFoodKey: 'zzzzqqqx',
      observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: 100,
    })
    expect(r.zeroHit).toBe(true)
    expect(r.outcome.kind).toBe('miss')
  })

  it('resolves a barcode deterministically, in either GTIN form', async () => {
    const byEan = await resolveByBarcode(db, '0012345678905')
    const byUpc = await resolveByBarcode(db, '012345678905')
    expect(byEan?.name).toBe('Granola Bar, Chewy')
    expect(byUpc?.foodId).toBe(byEan?.foodId)
  })

  it('returns null for an unknown barcode instead of a wrong row', async () => {
    expect(await resolveByBarcode(db, '9999999999995')).toBeNull()
  })

  it('never throws on a hostile query string', async () => {
    for (const q of ['"', '(((', 'a OR OR b', '*', 'NEAR/']) {
      const r = await resolveByText(db, {
        canonicalFoodKey: q, observedBrand: null, prepFacet: null, modelCategory: null, estimatedGrams: 100,
      })
      expect(r).toBeDefined()
    }
  })
})
