import { describe, expect, it } from 'vitest'
import { SetValues } from '@nutai/core-schema'
import { friendlySetValueError } from './workout-errors'

/**
 * P1-5: a failed set auto-save used to render String(zodError) inside the
 * workout UI — the full issue array as JSON. These tests pin the friendly
 * field-level messages that replace it.
 */
function zodError(input: unknown): unknown {
  const result = SetValues.safeParse(input)
  expect(result.success).toBe(false)
  return result.success === false ? result.error : null
}

describe('friendlySetValueError (P1-5)', () => {
  it('explains a float reps value in plain language', () => {
    const message = friendlySetValueError(zodError({ reps: 2.5 }))
    expect(message).toBe('Reps must be a whole number (like 8, not 8.5)')
    expect(message).not.toContain('invalid_type')
    expect(message).not.toContain('[')
  })

  it('names out-of-range fields with their bound', () => {
    expect(friendlySetValueError(zodError({ rpe: 11 }))).toBe('RPE (how hard it felt, out of 10) must be 10 or less')
    expect(friendlySetValueError(zodError({ rir: -1 }))).toBe('RIR (reps you had left in the tank) must be at least 0')
  })

  it('maps several issues at once without JSON', () => {
    const message = friendlySetValueError(zodError({ reps: 1.5, rpe: 99 }))
    expect(message).toContain('Reps must be a whole number')
    expect(message).toContain('RPE (how hard it felt, out of 10) must be 10 or less')
    expect(message).not.toContain('[{')
  })

  it('falls back to a plain sentence for stringified zod errors', () => {
    const raw = JSON.stringify([{ code: 'invalid_type', expected: 'integer', received: 'float', path: ['reps'] }])
    expect(friendlySetValueError(new Error(raw))).toBe('That value could not be saved — check the set fields')
  })

  it('keeps ordinary error messages (data-layer guards stay visible)', () => {
    expect(friendlySetValueError(new Error('Enter reps before completing this set'))).toBe(
      'Enter reps before completing this set',
    )
  })

  it('never leaks JSON for unknown shapes', () => {
    expect(friendlySetValueError(undefined)).toBe('That value could not be saved — check the set fields')
    expect(friendlySetValueError('boom')).toBe('That value could not be saved — check the set fields')
  })
})
