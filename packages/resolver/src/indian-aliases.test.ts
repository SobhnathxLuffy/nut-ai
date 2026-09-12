import { describe, it, expect } from 'vitest'
import { INDIAN_ALIAS_FIXTURES, normalizeIndianAliases } from './aliases'

describe('indian-aliases', () => {
  it('Given arhar/toor/tuvar variants, then all resolve to the same canonical concept', () => {
    expect(normalizeIndianAliases('arhar dal')).toBe('red gram dal')
    expect(normalizeIndianAliases('toor dal')).toBe('red gram dal')
    expect(normalizeIndianAliases('tuvar dal')).toBe('red gram dal')
  })

  it('normalizes multi-word Indian aliases correctly', () => {
    expect(normalizeIndianAliases('chana dal')).toBe('bengal gram dal')
    expect(normalizeIndianAliases('gulab jamun')).toBe('fried milk balls in syrup')
    expect(normalizeIndianAliases('sarson ka saag')).toBe('mustard greens')
  })

  it('normalizes other common Indian aliases', () => {
    expect(normalizeIndianAliases('paneer tikka')).toBe('cottage cheese tikka')
    expect(normalizeIndianAliases('ghee')).toBe('clarified butter')
  })

  it('does not touch non-aliases', () => {
    expect(normalizeIndianAliases('chicken breast')).toBe('chicken breast')
  })
  
  it('handles collisions explicitly by taking the longest match first', () => {
    // "chana" maps to "chickpea"
    // "chana dal" maps to "split chickpea"
    expect(normalizeIndianAliases('chana dal')).toBe('bengal gram dal')
    expect(normalizeIndianAliases('chana')).toBe('chickpea')
  })

  it('normalizes Hindi-script aliases without replacing text inside another token', () => {
    expect(normalizeIndianAliases('2 कटोरी अरहर दाल और रोटी')).toContain('red gram')
    expect(normalizeIndianAliases('पालक पनीर')).toContain('spinach cottage cheese')
    expect(normalizeIndianAliases('अचारवाला')).toBe('अचारवाला')
  })

  it('fixture-checks every declared alias, not only a hand-picked sample', () => {
    const fixtures = Object.entries(INDIAN_ALIAS_FIXTURES)
    expect(fixtures.length).toBeGreaterThanOrEqual(100)
    for (const [alias, canonical] of fixtures) {
      expect(normalizeIndianAliases(alias), alias).toBe(canonical)
    }
  })
})
