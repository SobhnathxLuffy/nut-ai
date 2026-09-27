import { describe, expect, it } from 'vitest'
import { getThisWeek, getLastWeek, isValidLocalDate } from './date-utils'

describe('isValidLocalDate (P1-6)', () => {
  it('accepts real calendar dates', () => {
    expect(isValidLocalDate('2026-02-27')).toBe(true)
    expect(isValidLocalDate('2024-02-29')).toBe(true) // leap day
    expect(isValidLocalDate('2023-12-31')).toBe(true)
  })

  it('rejects impossible dates that match the shape', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false)
    expect(isValidLocalDate('2026-13-01')).toBe(false)
    expect(isValidLocalDate('2026-00-10')).toBe(false)
    expect(isValidLocalDate('2026-04-31')).toBe(false)
  })

  it('rejects non-dates and wrong shapes', () => {
    expect(isValidLocalDate('')).toBe(false)
    expect(isValidLocalDate('not-a-date')).toBe(false)
    expect(isValidLocalDate('2026/02/27')).toBe(false)
    expect(isValidLocalDate('27-02-2026')).toBe(false)
  })
})

describe('date-utils', () => {
  it('Monday', () => {
    // 2026-09-14 is a Monday
    const monday = new Date('2026-09-14T12:00:00Z').getTime()
    expect(getThisWeek(monday).length).toBe(7)
    expect(getThisWeek(monday)[0]).toBe('2026-09-14') // Monday
    expect(getThisWeek(monday)[6]).toBe('2026-09-20') // Sunday
  })
  
  it('Sunday', () => {
    // 2026-09-20 is a Sunday
    const sunday = new Date('2026-09-20T12:00:00Z').getTime()
    expect(getThisWeek(sunday).length).toBe(7)
    expect(getThisWeek(sunday)[0]).toBe('2026-09-14') // Monday
    expect(getThisWeek(sunday)[6]).toBe('2026-09-20') // Sunday
  })

  it('month boundary', () => {
    // 2026-09-01 is a Tuesday
    const tues = new Date('2026-09-01T12:00:00Z').getTime()
    const thisWeek = getThisWeek(tues)
    expect(thisWeek[0]).toBe('2026-08-31') // Monday
    expect(thisWeek[1]).toBe('2026-09-01')
  })

  it('year boundary', () => {
    // 2026-01-01 is a Thursday
    const thurs = new Date('2026-01-01T12:00:00Z').getTime()
    const thisWeek = getThisWeek(thurs)
    expect(thisWeek[0]).toBe('2025-12-29') // Monday
    expect(thisWeek[6]).toBe('2026-01-04')
  })
  
  it('leap day', () => {
    // 2024-02-29 is a Thursday
    const thurs = new Date('2024-02-29T12:00:00Z').getTime()
    const thisWeek = getThisWeek(thurs)
    expect(thisWeek[0]).toBe('2024-02-26')
    expect(thisWeek[3]).toBe('2024-02-29')
    expect(thisWeek[4]).toBe('2024-03-01')
  })
  
  it('last week', () => {
    const monday = new Date('2026-09-14T12:00:00Z').getTime()
    const lastWeek = getLastWeek(monday)
    expect(lastWeek.length).toBe(7)
    expect(lastWeek[0]).toBe('2026-09-07')
    expect(lastWeek[6]).toBe('2026-09-13')
  })
})
