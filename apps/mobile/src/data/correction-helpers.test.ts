import { describe, expect, it } from 'vitest'
import { matchCorrectionRow } from './correction-describe'
import { mealSlotFromText, resolveQualitativeGrams } from './log-corrections'

describe('matchCorrectionRow — the shared fuzzy name→row resolver (F4 fix 8)', () => {
  const rows = [
    { id: 'm1i1', displayName: 'Masala Dal' },
    { id: 'm1i2', displayName: 'Steamed Rice' },
    { id: 'm1i3', displayName: 'मसाला दाल' },
  ]

  it('matches the exact id first', () => {
    expect(matchCorrectionRow('m1i2', rows)?.id).toBe('m1i2')
  })

  it('matches an exact display name', () => {
    expect(matchCorrectionRow('Steamed Rice', rows)?.id).toBe('m1i2')
  })

  it('matches case/punctuation drift', () => {
    expect(matchCorrectionRow('steamed  rice!', rows)?.id).toBe('m1i2')
  })

  it('matches NON-ASCII names — Devanagari survives normalization', () => {
    expect(matchCorrectionRow('मसाला दाल', rows)?.id).toBe('m1i3')
    expect(matchCorrectionRow('Masala  Dal', rows)?.id).toBe('m1i1')
  })

  it('the longer name wins a containment tie', () => {
    const near = [
      { id: 'a', displayName: 'Dal' },
      { id: 'b', displayName: 'Dal Tadka Fry' },
    ]
    expect(matchCorrectionRow('dal tadka fry', near)?.id).toBe('b')
  })

  it('returns null for a row that matches nothing', () => {
    expect(matchCorrectionRow('pizza', rows)).toBeNull()
  })
})

describe('resolveQualitativeGrams — qualitative sizes finally apply (F4 fix 4)', () => {
  it('relative words scale the row\u2019s CURRENT grams', () => {
    expect(resolveQualitativeGrams('half', 200)).toEqual({ ok: true, grams: 100, basis: 'half of the current amount' })
    expect(resolveQualitativeGrams('double', 90)).toEqual({ ok: true, grams: 180, basis: 'double the current amount' })
    expect(resolveQualitativeGrams('quarter', 80)).toEqual({ ok: true, grams: 20, basis: 'a quarter of the current amount' })
  })

  it('counted units use the vessel priors', () => {
    const two = resolveQualitativeGrams('2 rotis', null)
    expect(two).toEqual({ ok: true, grams: 80, basis: '2 roti ≈ 40 g each' })
    expect(resolveQualitativeGrams('a bowl', null).ok).toBe(true)
    expect(resolveQualitativeGrams('one and a half katori', null).ok).toBe(false)
  })

  it('unknown units refuse to guess — with a reason the UI reports', () => {
    const out = resolveQualitativeGrams('3 blobs', null)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('blobs')
  })

  it('empty input refuses honestly', () => {
    expect(resolveQualitativeGrams('', 100).ok).toBe(false)
  })
})

describe('mealSlotFromText — add_item meal words (F6)', () => {
  it('maps meal words to slots', () => {
    expect(mealSlotFromText('add a coffee')).toBe('breakfast')
    expect(mealSlotFromText('with dinner')).toBe('dinner')
    expect(mealSlotFromText('a mid-meal bite')).toBe('snack')
  })

  it('returns null when the request names no meal', () => {
    expect(mealSlotFromText('add 200 g of rice')).toBeNull()
  })
})
