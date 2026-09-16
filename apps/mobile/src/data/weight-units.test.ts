import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { kgToLb, lbToKg } from '@nutai/analytics'
import { readWeightUnit, writeWeightUnit } from './weight-units'

describe('bodyweight display preference', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await migrate(db, Date.now())
  })

  it('defaults to kg for a new India-first install', async () => {
    expect(await readWeightUnit(db)).toBe('kg')
  })

  it('preserves an existing imperial onboarding preference', async () => {
    await db.run(
      `INSERT INTO user_profile (id, units, created_at) VALUES (1, 'imperial', ?)`,
      [Date.now()],
    )
    expect(await readWeightUnit(db)).toBe('lb')
  })

  it('changes display without rewriting canonical historical kilograms', async () => {
    const now = Date.now()
    await db.run(
      `INSERT INTO weight_entries
       (local_date, weight_kg, logged_at, uuid, created_at, updated_at, revision, sync_state)
       VALUES ('2026-09-13', 72.345678, ?, '01992820-0000-7000-8000-000000000001', ?, ?, 1, 'local')`,
      [now, now, now],
    )

    await writeWeightUnit(db, 'lb')
    expect(await readWeightUnit(db)).toBe('lb')
    expect(kgToLb(72.345678)).toBeCloseTo(159.495, 3)
    expect(lbToKg(kgToLb(72.345678))).toBeCloseTo(72.345678, 12)
    const stored = await db.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(stored?.weight_kg).toBe(72.345678)
  })
})
