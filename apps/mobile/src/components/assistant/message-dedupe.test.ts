import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appendDeduped, createMessageIdFactory, type MessageLike } from './message-dedupe'

/**
 * O7 — the assistant transcript's id scheme + append guard.
 *
 * Behavior section: dedupe, order, referential stability, and the monotonic
 * id factory (frozen clock, backwards clock, format).
 *
 * Source-inspection section: locks that EVERY append site in app/assistant.tsx
 * routes through appendDeduped and mints ids from the factory — a new
 * hand-rolled `[...prev, { id: Date.now() ... }]` is exactly how the
 * same-millisecond id collision regrew in the first place.
 */

interface Msg extends MessageLike {
  role: 'user' | 'assistant'
  text: string
}

const m = (id: string, text = id, role: Msg['role'] = 'user'): Msg => ({ id, role, text })

describe('appendDeduped', () => {
  it('appends a new id at the end, preserving order', () => {
    const prev = [m('1', 'a'), m('2', 'b')]
    const out = appendDeduped(prev, m('3', 'c'))
    expect(out).toEqual([m('1', 'a'), m('2', 'b'), m('3', 'c')])
  })

  it('skips the append when the id already exists — the first copy wins', () => {
    const prev = [m('1', 'original'), m('2', 'b')]
    // Same id, DIFFERENT content: the duplicate append is dropped, not merged.
    const out = appendDeduped(prev, m('1', 'late duplicate'))
    expect(out).toEqual([m('1', 'original'), m('2', 'b')])
  })

  it('returns the ORIGINAL array reference on a skip (no re-render, no new identity)', () => {
    const prev = [m('1'), m('2')]
    expect(appendDeduped(prev, m('1', 'dup'))).toBe(prev)
  })

  it('accepts an empty transcript', () => {
    expect(appendDeduped([], m('1'))).toEqual([m('1')])
  })

  it('is deterministic: same inputs, same output, across repeated calls', () => {
    const prev = [m('1'), m('2')]
    const a = appendDeduped(prev, m('3'))
    const b = appendDeduped(prev, m('3'))
    expect(a).toEqual(b)
    const dup1 = appendDeduped(prev, m('2'))
    const dup2 = appendDeduped(prev, m('2'))
    expect(dup1).toBe(dup2)
    // Pure inputs: the caller's array is never mutated.
    expect(prev).toEqual([m('1'), m('2')])
  })

  it('only the id participates in the dedupe decision — same id, different role, still a skip', () => {
    const prev = [m('1', 'a', 'user')]
    expect(appendDeduped(prev, m('1', 'a', 'assistant'))).toBe(prev)
  })
})

describe('createMessageIdFactory', () => {
  it('mints distinct ids when the clock is frozen (the old Date.now() collision)', () => {
    const next = createMessageIdFactory(() => 1_000)
    expect(next()).toBe('1000')
    expect(next()).toBe('1001')
    expect(next()).toBe('1002')
  })

  it('keeps increasing when the clock jumps backwards', () => {
    let t = 5_000
    const next = createMessageIdFactory(() => t)
    expect(next()).toBe('5000')
    t = 100 // system clock jumped back — ids must never reuse an old value.
    expect(next()).toBe('5001')
    t = 6_000
    expect(next()).toBe('6000')
  })

  it('follows the real clock when it advances normally', () => {
    const times = [10, 11, 12, 13]
    let i = 0
    const next = createMessageIdFactory(() => times[i++] ?? 99)
    expect([next(), next(), next(), next()]).toEqual(['10', '11', '12', '13'])
  })

  it('keeps the historical id FORMAT: a plain decimal string (sortable, nothing parses it)', () => {
    const next = createMessageIdFactory(() => 1_234)
    expect(next()).toMatch(/^\d+$/)
  })

  it('1000 rapid calls from a frozen clock mint 1000 unique ids', () => {
    const next = createMessageIdFactory(() => 7)
    const ids = new Set(Array.from({ length: 1000 }, () => next()))
    expect(ids.size).toBe(1000)
  })
})

describe('O7 source lock: every append site in the assistant screen routes through the helper', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../app/assistant.tsx'),
    'utf8',
  )

  it('no hand-rolled spread append survives ([...prev is banned in the screen)', () => {
    expect(src).not.toContain('[...prev')
  })

  it('all four append sites (user message, no-provider error, streaming placeholder, catch fallback) call appendDeduped', () => {
    const uses = src.match(/appendDeduped\(/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(4)
  })

  it('no Date.now()-minted message ids remain (the collision-prone scheme is gone)', () => {
    expect(src).not.toMatch(/id:\s*Date\.now\(\)/)
    expect(src).not.toContain('(Date.now() + 1).toString()')
  })

  it('ids come from the shared factory, and the history-restore lane keeps its h_${i} scheme', () => {
    expect(src).toContain('createMessageIdFactory')
    expect(src).toContain('`h_${i}`')
  })
})
