import { describe, expect, it } from 'vitest'
import { isValidGtin } from '@nutai/resolver'
import { BRANDED_FOODS, ean13, gs1CheckDigit } from './branded-foods.mjs'

/**
 * Task 11-c gate for the curated branded (barcode) tier.
 *
 * The dataset is self-authored and representative (see the provenance note in
 * branded-foods.mjs) — these tests pin the invariants that matter for lookup
 * correctness and honest labeling, not label transcription:
 *
 *   1. EVERY barcode passes the PRODUCTION GS1 check-digit algorithm
 *      (packages/resolver/src/gtin.ts via the @nutai/resolver alias) — the
 *      exact code normalizeGtin applies to a scan at runtime. A representative
 *      base with a computed check digit is valid by construction; a hand-typed
 *      "documented" code that drifted would fail loudly here.
 *   2. Barcodes are unique — the schema's UNIQUE index would reject a dup row
 *      at build time; catching it here keeps the failure readable.
 *   3. Macros are complete, non-negative, and internally consistent
 *      (kcal ≈ 4P+4C+9F within ±10%, rows under 5 kcal exempt — salt, water,
 *      and zero-sugar drinks cannot satisfy a 4/4/9 energy balance).
 *   4. Every product serves a real portion (serving_size_g > 0 + text).
 *   5. The tier stays ≥ 100 products so it meaningfully covers the
 *      common + uncommon brand space it claims to cover.
 */

describe('branded-foods curated dataset', () => {
  it('uses the documented canonical GS1 vectors for its own check-digit helper', () => {
    // 4006381333931 and 9780306406157 are the canonical EAN-13 / ISBN-13 examples.
    expect(gs1CheckDigit('400638133393')).toBe(1)
    expect(gs1CheckDigit('978030640615')).toBe(7)
    expect(ean13('400638133393')).toBe('4006381333931')
  })

  it('keeps every barcode GS1 check-digit valid under the PRODUCTION algorithm', () => {
    expect(BRANDED_FOODS.length).toBeGreaterThan(0)
    for (const p of BRANDED_FOODS) {
      expect(p.barcode, `${p.name}: ${p.barcode}`).toMatch(/^\d{13}$/)
      expect(isValidGtin(p.barcode), `${p.name}: ${p.barcode}`).toBe(true)
    }
  })

  it('never reuses a barcode or a product identity', () => {
    const barcodes = BRANDED_FOODS.map((p) => p.barcode)
    expect(new Set(barcodes).size).toBe(barcodes.length)

    const identities = BRANDED_FOODS.map((p) => `${p.brand}::${p.name}`)
    expect(new Set(identities).size).toBe(identities.length)
  })

  it('serves every product a real household portion', () => {
    for (const p of BRANDED_FOODS) {
      expect(Number.isFinite(p.servingSizeG), `${p.name}: servingSizeG`).toBe(true)
      expect(p.servingSizeG, `${p.name}: servingSizeG > 0`).toBeGreaterThan(0)
      expect(p.servingDesc, `${p.name}: servingDesc`).toBeTruthy()
      expect(p.servingDesc.length, `${p.name}: servingDesc text`).toBeGreaterThan(3)
    }
  })

  it('carries complete, non-negative per-100g macros for every product', () => {
    const KEYS = ['energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'sodium_mg']
    for (const p of BRANDED_FOODS) {
      for (const k of KEYS) {
        const v = p.per100g[k]
        expect(v, `${p.name}.${k} present`).toBeDefined()
        expect(Number.isFinite(v), `${p.name}.${k} finite`).toBe(true)
        expect(v, `${p.name}.${k} non-negative`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps energy internally consistent with the macros (kcal ≈ 4P+4C+9F ±10%)', () => {
    for (const p of BRANDED_FOODS) {
      const n = p.per100g
      if (n.energy_kcal < 5) continue // salt, water, zero-sugar drinks: no 4/4/9 balance possible
      const predicted = 4 * (n.protein_g + n.carb_g) + 9 * n.fat_g
      const drift = Math.abs(predicted - n.energy_kcal) / n.energy_kcal
      expect(drift, `${p.name}: predicted ${predicted.toFixed(0)} kcal vs labeled ${n.energy_kcal}`).toBeLessThanOrEqual(0.10)
    }
  })

  it('ships at least 100 products across both common and uncommon brands', () => {
    expect(BRANDED_FOODS.length).toBeGreaterThanOrEqual(100)
    const brands = new Set(BRANDED_FOODS.map((p) => p.brand))
    expect(brands.size).toBeGreaterThanOrEqual(35)
  })

  it('builds every representative barcode on a real GS1 prefix', () => {
    // Non-documented codes must be constructed (not hand-typed): the check
    // digit helper guarantees validity, and the base must sit in a real GS1
    // space — 890 = GS1 India for every Indian-market SKU; the two
    // international representative SKUs use Ferrero's (IT) and Heinz's (NL)
    // real home-market prefixes. "Documented" codes are the widely-published
    // full EANs and are only allowed as explicitly marked literals.
    const intl = /^(8000500|8710900)/
    const documented = BRANDED_FOODS.filter((p) => p.documented)
    // Exactly the four full EANs that survived the production algorithm above
    // (Coke 330 ml, Red Bull 250 ml, Nutella 400 g, Barilla n.5).
    expect(documented.length).toBeGreaterThanOrEqual(4)
    for (const p of BRANDED_FOODS.filter((x) => !x.documented)) {
      expect(p.barcode.startsWith('890') || intl.test(p.barcode), `${p.name}: ${p.barcode}`).toBe(true)
    }
  })
})
