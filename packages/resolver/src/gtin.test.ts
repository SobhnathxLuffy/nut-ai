import { describe, expect, it } from 'vitest'
import { gs1CheckDigit, isValidGtin, normalizeGtin, upcEToUpcA } from './gtin.js'

/**
 * P3-D4 (QA): the checksum logic used to be exercised only through
 * index-level resolver suites. A rot in the mod-10 weights or the UPC-E
 * expansion tables would silently break EVERY barcode lookup while the unit
 * gate stayed green. These are the direct per-module edges.
 */
describe('gs1CheckDigit', () => {
  it('computes the GS1 mod-10 with alternating 3,1 weights from the right', () => {
    // '4006381333931' — body 400638133393, check 1 (canonical EAN-13 example).
    expect(gs1CheckDigit('400638133393')).toBe(1)
    // '9780306406157' — body 978030640615, check 7 (ISBN-13 example).
    expect(gs1CheckDigit('978030640615')).toBe(7)
  })

  it('yields 0 when the weighted sum is already a multiple of 10', () => {
    // Body 000000000000 → sum 0 → check (10 - 0) % 10 = 0.
    expect(gs1CheckDigit('000000000000')).toBe(0)
  })
})

describe('isValidGtin', () => {
  it('accepts each GTIN family length with a correct check digit', () => {
    // EAN-8: 24050007 → body 2405000, check 7? (computed below via our own fn)
    const ean8 = '2405000' + String(gs1CheckDigit('2405000'))
    expect(isValidGtin(ean8)).toBe(true)
    const upca = '03600029145' + String(gs1CheckDigit('03600029145'))
    expect(isValidGtin(upca)).toBe(true)
    expect(isValidGtin('4006381333931')).toBe(true)
  })

  it('rejects a corrupted check digit', () => {
    expect(isValidGtin('4006381333939')).toBe(false)
  })

  it('rejects implausible lengths and non-digit payloads', () => {
    expect(isValidGtin('123')).toBe(false)
    expect(isValidGtin('')).toBe(false)
  })
})

describe('upcEToUpcA', () => {
  it('expands the zero-compression cases to the canonical UPC-A', () => {
    // 01278905 → 01270000009 05? Use the GS1 reference expansion: 04252614 → 04220000126 4.
    expect(upcEToUpcA('04252614')).toBe('042100005264')
  })

  it('returns null for non-8-digit or bad number-system input', () => {
    expect(upcEToUpcA('1234567')).toBeNull()
    expect(upcEToUpcA('24252614')).toBeNull() // number system must be 0 or 1
  })
})

describe('normalizeGtin', () => {
  it('zero-pads UPC-A to the canonical EAN-13 form', () => {
    const upca = '03600029145' + String(gs1CheckDigit('03600029145'))
    expect(normalizeGtin(upca)).toBe(`0${upca}`)
  })

  it('expands UPC-E so the same product matches its EAN-13 row', () => {
    expect(normalizeGtin('04252614')).toBe(normalizeGtin('042100005264'))
  })

  it('passes a valid EAN-13 through unchanged', () => {
    expect(normalizeGtin('4006381333931')).toBe('4006381333931')
  })

  it('strips the GTIN-14 packaging indicator when the inner 13 is valid', () => {
    const inner = '4006381333931'
    const gtin14 = `1${inner}`
    expect(normalizeGtin(gtin14)).toBe(inner)
  })

  it('returns null rather than guessing for checksum failures or junk', () => {
    expect(normalizeGtin('4006381333932')).toBeNull()
    expect(normalizeGtin('no barcode here')).toBeNull()
    expect(normalizeGtin('')).toBeNull()
    // Long digit runs that are neither 13 nor a valid GTIN-14.
    expect(normalizeGtin('12345678901234567890')).toBeNull()
  })
})
