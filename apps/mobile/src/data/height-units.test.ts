import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { cmToFtIn, formatHeightCm, ftInToCm, readHeightUnit, writeHeightUnit } from './height-units'

/**
 * Mirror of weight-units.test.ts: the height DISPLAY preference is a
 * display-only concern — canonical height stays centimetres (user_profile.
 * height_cm) and switching the display unit must never rewrite it. The owner
 * mandate (2026-10) decouples height units from weight units.
 */
describe('height display preference', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await migrate(db, Date.now())
  })

  it('defaults to cm for a new install', async () => {
    expect(await readHeightUnit(db)).toBe('cm')
  })

  it('preserves an existing imperial onboarding preference (legacy rows)', async () => {
    await db.run(
      `INSERT INTO user_profile (id, units, created_at) VALUES (1, 'imperial', ?)`,
      [Date.now()],
    )
    expect(await readHeightUnit(db)).toBe('ftin')
  })

  it('an explicit setting wins over the legacy units derivation — either direction', async () => {
    await db.run(
      `INSERT INTO user_profile (id, units, height_cm, created_at) VALUES (1, 'imperial', 180.5, ?)`,
      [Date.now()],
    )
    await writeHeightUnit(db, 'cm')
    expect(await readHeightUnit(db)).toBe('cm')

    await db.run(`UPDATE user_profile SET units = 'metric' WHERE id = 1`)
    await writeHeightUnit(db, 'ftin')
    expect(await readHeightUnit(db)).toBe('ftin')
  })

  it('rejects an unsupported unit', async () => {
    await expect(writeHeightUnit(db, 'm' as never)).rejects.toThrow('Unsupported height unit')
  })

  it('changing display never rewrites canonical height_cm', async () => {
    await db.run(
      `INSERT INTO user_profile (id, units, height_cm, created_at) VALUES (1, 'metric', 180.5, ?)`,
      [Date.now()],
    )
    await writeHeightUnit(db, 'ftin')
    expect(await readHeightUnit(db)).toBe('ftin')
    const stored = await db.get<{ height_cm: number }>('SELECT height_cm FROM user_profile WHERE id = 1')
    expect(stored?.height_cm).toBe(180.5)
  })
})

describe('height conversions — cm is canonical, ft+in is display', () => {
  it('converts known values exactly', () => {
    expect(ftInToCm(5, 6)).toBeCloseTo(167.64, 10)
    expect(ftInToCm(6, 0)).toBeCloseTo(182.88, 10)
    expect(cmToFtIn(167.64)).toEqual({ ft: 5, inch: 6 })
    // 168 cm rounds to 66 total inches -> 5 ft 6 in (the picker's own math).
    expect(cmToFtIn(168)).toEqual({ ft: 5, inch: 6 })
  })

  it('round-trips through the picker range within half-an-inch display resolution', () => {
    // ft+in is a WHOLE-INCH display: re-emitting the rounded wheels may land
    // anywhere within half an inch of the canonical value — never further.
    for (let cm = 100; cm <= 250; cm += 1) {
      const { ft, inch } = cmToFtIn(cm)
      expect(Math.abs(ftInToCm(ft, inch) - cm)).toBeLessThanOrEqual(1.27)
    }
  })

  it('formats both units for display', () => {
    expect(formatHeightCm(168, 'cm')).toBe('168 cm')
    expect(formatHeightCm(168, 'ftin')).toBe('5 ft 6 in')
    expect(formatHeightCm(180.5, 'cm')).toBe('181 cm')
  })
})
