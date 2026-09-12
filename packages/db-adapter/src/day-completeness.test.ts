import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDayStatus,
  listDayStatuses,
  migrate,
  normalizeDayCompletion,
  setDayStatus,
  USER_SCHEMA_VERSION,
  type DbAdapter,
} from './index.js'
import { openMemoryDb, openNodeDb } from './node.js'

import {
  buildBackupPayload,
  importBackupPayload,
  serializeBackup,
  parseBackup,
} from '../../../apps/mobile/src/data/backup-core.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

const NOW = 1_754_100_000_000

describe('Day Completeness Storage Foundation (FND-004)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON;')
    await migrate(db, NOW)
  })

  describe('schema and migrations', () => {
    it('migrates to schema v3 with day_status table', async () => {
      const ver = await db.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_migrations',
      )
      expect(ver?.version).toBeGreaterThanOrEqual(3)
      expect(USER_SCHEMA_VERSION).toBeGreaterThanOrEqual(3)

      const columns = await db.all<{ name: string; type: string; notnull: number }>(
        'PRAGMA table_info(day_status)',
      )
      const colMap = new Map(columns.map((c) => [c.name, c]))
      expect(colMap.has('local_date')).toBe(true)
      expect(colMap.has('completion')).toBe(true)
      expect(colMap.has('confirmed_at')).toBe(true)
      expect(colMap.has('updated_at')).toBe(true)
      expect(colMap.has('actor')).toBe(true)
      expect(colMap.has('provenance')).toBe(true)
    })

    it('upgrades an existing v2 database to v3 preserving existing data', async () => {
      const legacyDb = openMemoryDb()
      await legacyDb.exec('PRAGMA foreign_keys = ON;')
      // Apply only migrations 1 and 2
      const { MIGRATIONS } = await import('./schema.js')
      await legacyDb.exec(MIGRATIONS[0]!.sql)
      await legacyDb.run('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)', [NOW])
      await legacyDb.exec(MIGRATIONS[1]!.sql)
      await MIGRATIONS[1]!.up!(legacyDb, NOW)
      await legacyDb.run('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)', [NOW])

      // Seed a meal
      await legacyDb.run(
        'INSERT INTO meals (id, logged_at, local_date, created_at, uuid) VALUES (1, ?, ?, ?, ?)',
        [NOW, '2026-08-01', NOW, '01993437-0000-7000-8000-000000000001'],
      )

      // Now run migrate() to v3
      await migrate(legacyDb, NOW, 3)
      const ver = await legacyDb.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_migrations',
      )
      expect(ver?.version).toBe(3)

      // Check day_status works and legacy meal is preserved
      const meal = await legacyDb.get<{ id: number; uuid: string }>('SELECT id, uuid FROM meals WHERE id = 1')
      expect(meal?.id).toBe(1)

      await setDayStatus(legacyDb, { localDate: '2026-08-01', completion: 'complete' })
      const status = await getDayStatus(legacyDb, '2026-08-01')
      expect(status?.completion).toBe('complete')
    })
  })

  describe('enum validation and reconciliation', () => {
    it('normalizes uppercase and mixed-case status values to canonical lowercase', () => {
      expect(normalizeDayCompletion('COMPLETE')).toBe('complete')
      expect(normalizeDayCompletion('Partial')).toBe('partial')
      expect(normalizeDayCompletion('UNKNOWN')).toBe('unknown')
      expect(normalizeDayCompletion('fasting')).toBe('fasting')
      expect(normalizeDayCompletion('  FASTING  ')).toBe('fasting')
    })

    it('rejects unknown or invalid status values with an informative error', () => {
      expect(() => normalizeDayCompletion('finished')).toThrow(/Invalid day completion status/)
      expect(() => normalizeDayCompletion('skipped')).toThrow(/Invalid day completion status/)
      expect(() => normalizeDayCompletion('')).toThrow(/Invalid day completion status/)
    })

    it('rejects invalid date formats', async () => {
      await expect(
        setDayStatus(db, { localDate: '2026/08/01', completion: 'complete' }),
      ).rejects.toThrow(/Invalid local_date format/)
      await expect(getDayStatus(db, '01-08-2026')).rejects.toThrow(/Invalid local_date format/)
      await expect(getDayStatus(db, '2026-02-31')).rejects.toThrow(/Invalid local_date value/)
    })

    it('enforces completion and actor values at the database boundary', async () => {
      await expect(db.run(
        `INSERT INTO day_status (local_date, completion, updated_at, actor)
         VALUES ('2026-08-01', 'finished', ?, 'user')`,
        [NOW],
      )).rejects.toThrow()
      await expect(db.run(
        `INSERT INTO day_status (local_date, completion, updated_at, actor)
         VALUES ('2026-08-01', 'complete', ?, 'remote')`,
        [NOW],
      )).rejects.toThrow()
    })
  })

  describe('read and write operations', () => {
    it('stores and retrieves day status with default actor and confirmed_at', async () => {
      const written = await setDayStatus(db, {
        localDate: '2026-08-01',
        completion: 'COMPLETE',
        now: NOW,
      })

      expect(written).toEqual({
        local_date: '2026-08-01',
        completion: 'complete',
        confirmed_at: NOW,
        updated_at: NOW,
        actor: 'user',
        provenance: null,
      })

      const read = await getDayStatus(db, '2026-08-01')
      expect(read).toEqual(written)
    })

    it('stores custom actor, confirmed_at, and provenance', async () => {
      await setDayStatus(db, {
        localDate: '2026-08-02',
        completion: 'fasting',
        confirmedAt: NOW + 1000,
        actor: 'system',
        provenance: 'eod_auto_check',
        now: NOW,
      })

      const read = await getDayStatus(db, '2026-08-02')
      expect(read).toEqual({
        local_date: '2026-08-02',
        completion: 'fasting',
        confirmed_at: NOW + 1000,
        updated_at: NOW,
        actor: 'system',
        provenance: 'eod_auto_check',
      })
    })

    it('upserts status on conflict', async () => {
      await setDayStatus(db, {
        localDate: '2026-08-03',
        completion: 'partial',
        now: NOW,
      })

      const updated = await setDayStatus(db, {
        localDate: '2026-08-03',
        completion: 'complete',
        confirmedAt: NOW + 2000,
        actor: 'user',
        provenance: 'user_toggle',
        now: NOW + 2000,
      })

      expect(updated.completion).toBe('complete')
      expect(updated.updated_at).toBe(NOW + 2000)

      const read = await getDayStatus(db, '2026-08-03')
      expect(read?.completion).toBe('complete')
      expect(read?.provenance).toBe('user_toggle')
    })

    it('returns null for non-existent day status', async () => {
      const read = await getDayStatus(db, '2026-12-31')
      expect(read).toBeNull()
    })

    it('lists day statuses with optional date range filters', async () => {
      await setDayStatus(db, { localDate: '2026-08-01', completion: 'complete' })
      await setDayStatus(db, { localDate: '2026-08-02', completion: 'fasting' })
      await setDayStatus(db, { localDate: '2026-08-03', completion: 'partial' })
      await setDayStatus(db, { localDate: '2026-08-04', completion: 'unknown' })

      const all = await listDayStatuses(db)
      expect(all).toHaveLength(4)
      expect(all.map((s) => s.local_date)).toEqual([
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
      ])

      const filtered = await listDayStatuses(db, {
        startDate: '2026-08-02',
        endDate: '2026-08-03',
      })
      expect(filtered).toHaveLength(2)
      expect(filtered.map((s) => s.local_date)).toEqual(['2026-08-02', '2026-08-03'])
      expect(filtered.map((s) => s.completion)).toEqual(['fasting', 'partial'])
    })
  })

  describe('durability across process restart', () => {
    it('persists day status across database reopen', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutai-day-status-test-'))
      const dbFile = path.join(tmpDir, 'user.db')

      try {
        const fileDb1 = openNodeDb(dbFile)
        await migrate(fileDb1, NOW)
        await setDayStatus(fileDb1, {
          localDate: '2026-08-01',
          completion: 'complete',
          actor: 'user',
          provenance: 'manual_click',
          now: NOW,
        })
        await fileDb1.close()

        // Reopen database (simulate restart)
        const fileDb2 = openNodeDb(dbFile)
        await migrate(fileDb2, NOW)
        const retrieved = await getDayStatus(fileDb2, '2026-08-01')
        expect(retrieved).toEqual({
          local_date: '2026-08-01',
          completion: 'complete',
          confirmed_at: NOW,
          updated_at: NOW,
          actor: 'user',
          provenance: 'manual_click',
        })
        await fileDb2.close()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('backup round-trip integration', () => {
    it('exports and restores day_status table reliably', async () => {
      await setDayStatus(db, {
        localDate: '2026-08-01',
        completion: 'complete',
        confirmedAt: NOW,
        actor: 'user',
        provenance: 'user_toggle',
        now: NOW,
      })
      await setDayStatus(db, {
        localDate: '2026-08-02',
        completion: 'fasting',
        confirmedAt: null,
        actor: 'system',
        provenance: 'streak_analyzer',
        now: NOW + 100,
      })

      const payload = await buildBackupPayload(db, {
        schemaVersion: USER_SCHEMA_VERSION,
        appVersion: '0.3.0',
        now: NOW,
      })

      expect(payload.tables['day_status']).toHaveLength(2)
      const serialized = serializeBackup(payload)
      const parsed = parseBackup(serialized)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const dst = openMemoryDb()
      await dst.exec('PRAGMA foreign_keys = ON;')
      await migrate(dst, NOW)

      const outcome = await importBackupPayload(dst, parsed.payload, USER_SCHEMA_VERSION)
      expect(outcome.ok).toBe(true)

      const restored1 = await getDayStatus(dst, '2026-08-01')
      expect(restored1).toEqual({
        local_date: '2026-08-01',
        completion: 'complete',
        confirmed_at: NOW,
        updated_at: NOW,
        actor: 'user',
        provenance: 'user_toggle',
      })

      const restored2 = await getDayStatus(dst, '2026-08-02')
      expect(restored2).toEqual({
        local_date: '2026-08-02',
        completion: 'fasting',
        confirmed_at: null,
        updated_at: NOW + 100,
        actor: 'system',
        provenance: 'streak_analyzer',
      })
    })
  })
})
