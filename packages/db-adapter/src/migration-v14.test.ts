import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './node.js'
import { USER_SCHEMA_VERSION } from './schema.js'
import { migrate } from './migrate.js'

/**
 * Schema v14 — workouts.progression_note (T-IMPL-B multi-axis progression).
 *
 * Purely additive nullable column. The acceptance bar (AGENTS §10): a
 * populated v13 database upgrades with its workout rows intact and gains the
 * column as NULL, a fresh database lands at v14 directly, and the column
 * round-trips a write.
 */
describe('schema v14 workouts.progression_note', () => {
  it('migrates a populated v13 database: workout rows kept, column added as NULL', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000, 13)
    // A workout written at v13 carries no progression note.
    await db.run(
      `INSERT INTO workouts (uuid, created_at, revision, sync_state, name, local_date, started_at, finished_at, status, notes, location)
       VALUES ('01992820-0000-7000-8000-000000000001', 1000, 1, 'local', 'Push Day', '2026-09-12', 1000, 2000, 'completed', '', '')`,
    )
    await migrate(db, 2000)
    const row = await db.get<{ name: string; progression_note: string | null }>(
      'SELECT name, progression_note FROM workouts WHERE id = 1',
    )
    expect(row?.name).toBe('Push Day')
    expect(row?.progression_note).toBeNull()
    // The column is writable and round-trips.
    await db.run('UPDATE workouts SET progression_note = ? WHERE id = 1', ['Squat: 22.5 kg — you hit 12 reps on all sets last time.'])
    expect(
      (await db.get<{ progression_note: string }>('SELECT progression_note FROM workouts WHERE id = 1'))?.progression_note,
    ).toContain('22.5 kg')
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([])
    await db.close()
  })

  it('lands a fresh database at the current version with the column present', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    expect(USER_SCHEMA_VERSION).toBeGreaterThanOrEqual(14)
    const cols = await db.all<{ name: string }>('PRAGMA table_info(workouts)')
    expect(cols.map((c) => c.name)).toContain('progression_note')
    await db.close()
  })
})
