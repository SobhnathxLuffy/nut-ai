import { describe, expect, it } from 'vitest'
import { baseUrlWarning, normalizeBaseUrl, withBaseUrl } from './base-url'

/**
 * P2-11 — bad pastes produce wrong diagnoses.
 *
 * 'aicredits.in/v1' (no scheme) used to become a relative-URL fetch failure
 * reported as 'offline'; 'https://aicredits.in' (missing /v1) 404ed as 'that
 * model is not available'; http:// was accepted silently for a key-bearing
 * request. Normalization repairs all three, and the warning function flags the
 * one ambiguity that cannot be repaired safely — a non-localhost host without
 * a /v1 suffix — for the settings screen.
 */

describe('normalizeBaseUrl', () => {
  it('keeps a correct paste untouched', () => {
    expect(normalizeBaseUrl('https://aicredits.in/v1')).toBe('https://aicredits.in/v1')
  })

  it('adds the https:// scheme to a bare host paste', () => {
    expect(normalizeBaseUrl('aicredits.in/v1')).toBe('https://aicredits.in/v1')
    expect(normalizeBaseUrl('  aicredits.in/v1  ')).toBe('https://aicredits.in/v1')
  })

  it('upgrades http:// to https:// for every non-localhost host', () => {
    expect(normalizeBaseUrl('http://aicredits.in/v1')).toBe('https://aicredits.in/v1')
  })

  it('keeps http:// on loopback gateways — that is what they are for', () => {
    expect(normalizeBaseUrl('http://localhost:8080/v1')).toBe('http://localhost:8080/v1')
    expect(normalizeBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1')
  })

  it('reduces full-endpoint pastes to the base', () => {
    expect(normalizeBaseUrl('https://aicredits.in/v1/chat/completions')).toBe('https://aicredits.in/v1')
    expect(normalizeBaseUrl('https://aicredits.in/v1/')).toBe('https://aicredits.in/v1')
  })

  it('empty stays empty', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('withBaseUrl after repair', () => {
  it('rewrites the official prefix onto a scheme-less paste', () => {
    expect(
      withBaseUrl('https://api.openai.com/v1/chat/completions', 'aicredits.in/v1'),
    ).toBe('https://aicredits.in/v1/chat/completions')
  })
})

describe('baseUrlWarning — the /v1 hint at paste time', () => {
  it('flags a non-localhost host missing /v1', () => {
    expect(baseUrlWarning('https://aicredits.in')).toContain('/v1')
    expect(baseUrlWarning('aicredits.in')).toContain('/v1')
  })

  it('says nothing when /v1 is present', () => {
    expect(baseUrlWarning('https://aicredits.in/v1')).toBeNull()
  })

  it('says nothing for localhost gateways', () => {
    expect(baseUrlWarning('http://localhost:8080')).toBeNull()
    expect(baseUrlWarning('http://127.0.0.1:11434')).toBeNull()
  })

  it('says nothing for an empty draft', () => {
    expect(baseUrlWarning('')).toBeNull()
  })
})
