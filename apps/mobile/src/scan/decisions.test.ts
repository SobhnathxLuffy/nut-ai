import { describe, expect, it } from 'vitest'
import {
  BARCODE_NOT_FOUND_FAILURE,
  BARCODE_NO_KEY_FAILURE,
  describePreprocessFailure,
  gateScanProvider,
  isUnambiguousLookup,
  mergeScanMeta,
  planBarcodeScan,
  selectRefinementTargets,
  webOptionToIngredientRow,
} from './decisions'

/**
 * P2-37 (QA Wave 4) — contract tests for the extracted per-scan decision
 * logic. The orchestrator's mode routing, corpus gating and fallback ordering
 * used to be welded to store writes and network calls, so the QA audit's
 * "highest-risk glue code" had zero direct tests — the reseller base-URL miss
 * was exactly the class of bug a contract test would have caught. These pin
 * the decisions as pure input→output contracts.
 */

describe('contract: provider gate (photo scan entry)', () => {
  it('no provider named → no-key failure, points at Profile, never retriable', () => {
    for (const setting of [null, undefined, '', 'none']) {
      const gate = gateScanProvider(setting, null)
      expect(gate).toEqual({
        ok: false,
        failureKind: 'no-key',
        message:
          'Photo scans need an API key. Add one in Profile — barcode, search and manual logging work without one.',
        canRetry: false,
      })
    }
  })

  it('provider named but credential missing/empty → key-invalid, asks to RE-ENTER (a different diagnosis from no-key)', () => {
    expect(gateScanProvider('openai', null)).toMatchObject({ ok: false, failureKind: 'key-invalid' })
    expect(gateScanProvider('openai', { value: '' })).toMatchObject({ ok: false, failureKind: 'key-invalid' })
  })

  it('provider + credential → pass-through with the named provider', () => {
    expect(gateScanProvider('openai', { value: 'sk-x' })).toMatchObject({ ok: true, provider: 'openai' })
    expect(gateScanProvider('anthropic', { value: 'sk-a' })).toMatchObject({ ok: true, provider: 'anthropic' })
  })
})

describe('contract: scan meta merge (fix re-analysis)', () => {
  it('tokens add across the original call and the fix call', () => {
    const merged = mergeScanMeta(
      { inputTokens: 4500, outputTokens: 700, costUsd: 0.0007 },
      { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 5000, outputTokens: 500, costUsd: 0.0006, promptVersion: 'p1' },
    )
    expect(merged.inputTokens).toBe(9500)
    expect(merged.outputTokens).toBe(1200)
    expect(merged.costUsd).toBeCloseTo(0.0013)
  })

  it('P2-9: one unknown-cost call makes the total cost unknown — null propagates, never 0', () => {
    // prior call ran on a custom model with unknown cost; the fix call is a
    // known-cost catalogue model — the documented P2-9 principle says the
    // MEAL total is unknown, not "the known part".
    const merged = mergeScanMeta(
      { inputTokens: 100, outputTokens: 50, costUsd: null },
      { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 60, costUsd: 0.0002, promptVersion: 'p' },
    )
    expect(merged.costUsd).toBeNull()
    expect(merged.inputTokens).toBe(300)

    const merged2 = mergeScanMeta(null, {
      provider: 'openai',
      model: 'custom',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: null,
      promptVersion: 'p',
    })
    expect(merged2.costUsd).toBeNull()
    expect(merged2.inputTokens).toBe(1)
  })
})

describe('contract: refinement target selection', () => {
  const items = (resolutions: string[]) => resolutions.map((resolution, i) => ({ resolution, row: { id: `row-${i}` } }))

  it('corpus misses are targets, in row order', () => {
    expect(selectRefinementTargets(items(['hit', 'miss', 'hit', 'miss']), null)).toEqual([1, 3])
  })

  it('a BRANDED item is a target even when it matched (a logo deserves published numbers)', () => {
    expect(
      selectRefinementTargets(items(['hit', 'hit']), [{ brand: null }, { brand: "McDonald's" }]),
    ).toEqual([1])
  })

  it('capped at 2 lookups per scan — cost is bounded', () => {
    expect(selectRefinementTargets(items(['miss', 'miss', 'miss', 'miss']), null)).toEqual([0, 1])
  })

  it('no payload → only misses; empty items → no targets', () => {
    expect(selectRefinementTargets([], [{ brand: 'x' }])).toEqual([])
  })
})

describe('contract: unambiguous lookup auto-apply', () => {
  it('exactly one option, no question, found → auto-apply', () => {
    expect(isUnambiguousLookup({ found: true, options: [{}] })).toBe(true)
  })
  it('multiple options, or a question, or not-found → do NOT auto-apply', () => {
    expect(isUnambiguousLookup({ found: true, options: [{}, {}] })).toBe(false)
    expect(isUnambiguousLookup({ found: true, options: [{}], question: 'Which one?' })).toBe(false)
    expect(isUnambiguousLookup({ found: false, options: [{}] })).toBe(false)
  })
})

describe('contract: barcode 3-step routing', () => {
  it('corpus hit with energy → zero-cost path, no model call, source carried through', () => {
    expect(
      planBarcodeScan({ name: 'Cola', foodId: 'usda:1', servingSizeG: 330, energyKcal: 42, source: 'off' }, true),
    ).toEqual({ step: 'corpus-ready', source: 'off' })
    // with or without a key — the corpus path never needs one
    expect(
      planBarcodeScan({ name: 'Cola', foodId: 'usda:1', servingSizeG: 330, energyKcal: 42, source: 'local' }, false),
    ).toEqual({ step: 'corpus-ready', source: 'local' })
  })

  it('corpus miss + no credential → honest pointer at Food label mode (which works without a key)', () => {
    expect(planBarcodeScan(null, false)).toEqual({ step: 'need-label-mode' })
    expect(planBarcodeScan({ name: 'x', foodId: null, servingSizeG: null, energyKcal: null, source: 'off' }, false)).toEqual({
      step: 'need-label-mode',
    })
    expect(BARCODE_NO_KEY_FAILURE.message).toMatch(/Food label mode/)
    expect(BARCODE_NO_KEY_FAILURE.canRetry).toBe(false)
  })

  it('corpus miss + credential → one AI lookup attempt', () => {
    expect(planBarcodeScan(null, true)).toEqual({ step: 'try-web-lookup' })
  })

  it('lookup miss → not-found phase points at label mode, never retries into a second billed call', () => {
    expect(BARCODE_NOT_FOUND_FAILURE.message).toMatch(/Food label mode/)
    expect(BARCODE_NOT_FOUND_FAILURE.canRetry).toBe(false)
  })
})

describe('contract: web option → packaged-exact row', () => {
  it('per-serving numbers scale to the per-100g snapshot by the printed serving weight', () => {
    const row = webOptionToIngredientRow(
      {
        label: 'Cola 330ml',
        serving_g: 330,
        calories_kcal: 139,
        protein_g: 0,
        fat_g: 0,
        carbs_g: 35,
        fiber_g: null,
        sodium_mg: 10,
      },
      'https://example.com/nutrition',
      1_754_300_000_000,
    )
    expect(row.gramPathway).toBe('packaged_exact')
    expect(row.origin).toBe('web_lookup')
    expect(row.grams).toBe(330)
    // 139 kcal per 330 g → 42.12 kcal per 100 g
    expect(row.nutrientSnapshot.kcal).toBeCloseTo(139 * (100 / 330), 5)
    expect(row.nutrientSnapshot.carbs_g).toBeCloseTo(35 * (100 / 330), 5)
    expect(row.nutrientSnapshot.fiber_g).toBeNull()
    expect(row.nutrientSnapshot.sodium_mg).toBeCloseTo(10 * (100 / 330), 5)
    expect(row.sourceUrl).toBe('https://example.com/nutrition')
    expect(row.isEstimate).toBe(false)
  })

  it('missing printed serving falls back to 100 g — per-serving equals per-100g', () => {
    const row = webOptionToIngredientRow(
      { label: 'x', serving_g: null, calories_kcal: 50, protein_g: 1, fat_g: 2, carbs_g: 5, fiber_g: 0, sodium_mg: null },
      null,
      1,
    )
    expect(row.grams).toBe(100)
    expect(row.nutrientSnapshot.kcal).toBeCloseTo(50)
  })
})


// ---------------------------------------------------------------------------
// P1-4: preprocess failures are DIAGNOSED, not blanket-mislabelled.
// The blanket catch is the exact mechanism that mislabelled the thali
// RangeError as "could not read the photo". These pin the branch table.
// ---------------------------------------------------------------------------

describe('contract: preprocess failure diagnosis (P1-4)', () => {
  it('RangeError / string-length / allocation failures are size diagnoses, not decode failures', () => {
    const range = new RangeError('Invalid string length')
    expect(describePreprocessFailure(range)).toMatchObject({
      message: expect.stringContaining('too large'),
      canRetry: false,
    })
    expect(describePreprocessFailure(new Error('Array buffer allocation failed'))).toMatchObject({
      message: expect.stringContaining('too large'),
      canRetry: false,
    })
    // A bare RangeError-shaped object (cross-realm throws lose instanceof).
    expect(describePreprocessFailure({ name: 'RangeError', message: 'x' })).toMatchObject({
      message: expect.stringContaining('too large'),
    })
  })

  it('decode-shaped errors keep the honest unreadable-photo copy, no retry', () => {
    const decodeErr = Object.assign(new Error('could not be decoded'), { name: 'InvalidCharacterError' })
    expect(describePreprocessFailure(decodeErr)).toEqual({
      message: 'Could not read the photo. Try taking it again.',
      canRetry: false,
    })
    expect(describePreprocessFailure(new Error('malformed image data'))).toMatchObject({
      message: 'Could not read the photo. Try taking it again.',
      canRetry: false,
    })
  })

  it('anything else is treated as transient — retry is offered', () => {
    expect(describePreprocessFailure(new Error('native boom'))).toEqual({
      message: expect.stringContaining('Try again'),
      canRetry: true,
    })
    // Non-Error throws (strings from native bridges) must not crash the diagnosis.
    expect(describePreprocessFailure('mystery')).toMatchObject({ canRetry: true })
  })
})
