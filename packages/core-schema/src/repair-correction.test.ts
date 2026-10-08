import { describe, expect, it } from 'vitest'
import { repairCorrectionIntent } from './correction'

describe('repairCorrectionIntent — the degraded-answer repair pass (F5 fix 7)', () => {
  it('passes a well-formed intent through unchanged', () => {
    const raw = {
      operations: [{ type: 'update_quantity', id: 'm1i2', grams: 200, qualitative_size: null }],
      clarification_needed: null,
    }
    expect(repairCorrectionIntent(raw)).toEqual(raw)
  })

  it('accepts a bare operations array (envelope missing entirely)', () => {
    const out = repairCorrectionIntent([{ type: 'remove_item', id: 'm1i3' }])
    expect(out).not.toBeNull()
    expect(out!.operations).toEqual([{ type: 'remove_item', id: 'm1i3' }])
    expect(out!.clarification_needed).toBeNull()
  })

  it('unwraps one-level-deep envelopes ({intent:{...}}, {response:{...}})', () => {
    const inner = {
      operations: [{ type: 'update_quantity', id: 'm1i2', grams: 50, qualitative_size: null }],
      clarification_needed: null,
    }
    for (const envelope of [{ intent: inner }, { response: inner }, { result: inner }, { correction: inner }]) {
      expect(repairCorrectionIntent(envelope)).toEqual(inner)
    }
  })

  it('repairs numeric grams delivered as strings ("200", "200 g")', () => {
    const out = repairCorrectionIntent({
      operations: [
        { type: 'update_quantity', id: 'm1i2', grams: '200', qualitative_size: null },
        { type: 'update_quantity', id: 'm1i3', grams: '200 g', qualitative_size: null },
        { type: 'update_quantity', id: 'm1i4', grams: '  ', qualitative_size: null },
      ],
      clarification_needed: null,
    })
    expect(out).not.toBeNull()
    expect(out!.operations[0]).toEqual({ type: 'update_quantity', id: 'm1i2', grams: 200, qualitative_size: null })
    expect(out!.operations[1]).toEqual({ type: 'update_quantity', id: 'm1i3', grams: 200, qualitative_size: null })
    // whitespace-only string grams → null (the qualitative path can still apply)
    expect(out!.operations[2]).toEqual({ type: 'update_quantity', id: 'm1i4', grams: null, qualitative_size: null })
  })

  it('drops unknown operation types instead of inventing semantics', () => {
    const out = repairCorrectionIntent({
      operations: [
        { type: 'delete_everything' },
        { type: 'remove_item', id: 'm1i3' },
      ],
      clarification_needed: null,
    })
    expect(out!.operations).toEqual([{ type: 'remove_item', id: 'm1i3' }])
  })

  it('returns null for garbage — the caller keeps its honest failure path', () => {
    expect(repairCorrectionIntent(null)).toBeNull()
    expect(repairCorrectionIntent('nope')).toBeNull()
    expect(repairCorrectionIntent({})).toBeNull()
    expect(repairCorrectionIntent({ operations: 'not-an-array' })).toBeNull()
  })
})
