import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentVersion, deterministicUuidV7, isValidUuid, migrate } from '@nutai/db-adapter'
import { openNodeDb } from '@nutai/db-adapter/node'
import type { DbAdapter } from '@nutai/db-adapter'
import {
  EXPORT_TABLES,
  SYNCABLE_TABLES,
  importBackupPayload,
  parseBackup,
  validateBackupPayload,
  type BackupPayload,
} from '../../src/data/backup-core'

/**
 * The qa-backup.json fixture invariant (Wave 5A, item O1).
 *
 * The Playwright suite leans on this file as its state-seeding harness: every
 * restore-onboarding journey replays it through the app's REAL import path,
 * BUG-007 needs a goals row so Home renders a target (not the skeleton), and
 * BUG-009 needs a seeded active workout with a lb unit preference. An
 * accidentally re-emptied or shape-drifted fixture fails e2e tests in ways
 * that look like APP bugs — this suite fails FIRST, at the fixture, with a
 * message that says exactly which table drifted.
 *
 * The strongest check is the first one: the file is pushed through the same
 * parse → validate → wipe-and-insert path the restore screen uses, against a
 * real migrated schema (in-memory node adapter). Everything the importer
 * enforces — required tables, UUID rules, foreign keys, the set-tracking
 * triggers — applies to the fixture exactly as it applies to a user's backup.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'qa-backup.json')

/** Everything the onboarding/persist.ts writer puts in a goals row (SELECT * order-independent). */
const GOALS_WRITER_COLUMNS = [
  'id', 'effective_from', 'goal_type', 'rate_lb_per_week', 'target_kcal', 'target_raw_kcal',
  'floor_applied', 'protein_g', 'fat_g', 'carbs_g', 'bmr', 'tdee', 'adaptive',
  'uuid', 'created_at', 'updated_at', 'revision', 'deleted_at', 'sync_state',
  // migration 10's column — a real SELECT * export carries it as null for
  // onboarding-written rows (only accepted check-ins write evidence).
  'adaptive_evidence_json',
] as const

type FixtureRow = Record<string, unknown>
type TableInfo = { name: string; notnull: number; dflt_value: string | null; pk: number }

let payload: BackupPayload
let db: DbAdapter

beforeAll(async () => {
  const parsed = parseBackup(readFileSync(FIXTURE, 'utf8'))
  expect(parsed.ok).toBe(true)
  payload = parsed.ok ? parsed.payload : ({} as BackupPayload)
  db = openNodeDb(':memory:')
  await migrate(db, 1727400000000)
})

describe('qa-backup.json — restores through the real import path', () => {
  it('validates and imports cleanly into a freshly migrated user schema', async () => {
    const validation = validateBackupPayload(payload, await currentVersion(db))
    expect(validation).toEqual({ valid: true })

    const outcome = await importBackupPayload(db, payload, await currentVersion(db))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // Row counts must match the file exactly — no silent drops.
    for (const table of Object.keys(payload.tables)) {
      expect(outcome.rowCounts[table]).toBe(payload.tables[table]!.length)
    }
  })

  it('carries every exportable table — no missing table, no dead key', () => {
    // Cross-file consistency with backup-core: the import iterates
    // EXPORT_TABLES only, so a key outside that list is dead weight and a
    // MISSING key would fail the restore's required-tables validation.
    expect(Object.keys(payload.tables).sort()).toEqual([...EXPORT_TABLES].sort())
    for (const table of EXPORT_TABLES) {
      expect(Array.isArray(payload.tables[table])).toBe(true)
    }
  })
})

describe('qa-backup.json — goals (the O1 enrichment)', () => {
  it('is non-empty — re-emptying the table fails here, not as a mystery e2e failure', () => {
    expect((payload.tables['goals'] as FixtureRow[]).length).toBeGreaterThanOrEqual(1)
  })

  it('matches the onboarding writer shape exactly: every column, no stray keys', async () => {
    const columns = await db.all<TableInfo>('PRAGMA table_info(goals)')
    const schemaColumns = columns.map((c) => c.name)
    // The writer's full column list is also the installed schema's list.
    expect(schemaColumns.slice().sort()).toEqual([...GOALS_WRITER_COLUMNS].sort())

    for (const row of payload.tables['goals'] as FixtureRow[]) {
      expect(Object.keys(row).sort()).toEqual([...GOALS_WRITER_COLUMNS].sort())
    }
  })

  it('every row is a plausible goal: domains, positivity, live (non-deleted) sync metadata', () => {
    for (const row of payload.tables['goals'] as FixtureRow[]) {
      expect(['lose', 'maintain', 'gain']).toContain(row['goal_type'])
      expect([0, 1]).toContain(row['floor_applied'])
      expect([0, 1]).toContain(row['adaptive'])
      // rate is the only nullable value field — a rate OR its absence is honest.
      expect(row['rate_lb_per_week'] === null || typeof row['rate_lb_per_week'] === 'number').toBe(true)
      for (const key of ['target_kcal', 'target_raw_kcal', 'protein_g', 'fat_g', 'carbs_g', 'bmr', 'tdee']) {
        expect(Number.isFinite(row[key] as number)).toBe(true)
        expect(row[key] as number).toBeGreaterThan(0)
      }
      expect(typeof row['uuid'] === 'string' && isValidUuid(row['uuid'] as string)).toBe(true)
      expect(row['sync_state']).toBe('local')
      expect(row['deleted_at']).toBeNull()
      expect(row['revision']).toBe(1)
    }
  })

  it('the newest row is the one currentGoal() would read — Home gets a real target after restore', async () => {
    // Same read as src/data/repo.ts currentGoal(): newest effective_from, then id.
    const current = await db.get<{ goal_type: string; target_kcal: number; deleted_at: number | null }>(
      'SELECT goal_type, target_kcal, deleted_at FROM goals ORDER BY effective_from DESC, id DESC LIMIT 1',
    )
    expect(current).not.toBeNull()
    expect(current!.deleted_at).toBeNull()
    expect(current!.target_kcal).toBeGreaterThan(0)
  })
})

describe('qa-backup.json — schema-exactness for every populated table', () => {
  it('rows carry only real columns and cover every NOT NULL column without a default', async () => {
    for (const table of EXPORT_TABLES) {
      const rows = payload.tables[table] as FixtureRow[]
      if (!rows || rows.length === 0) continue
      const info = await db.all<TableInfo>(`PRAGMA table_info(${table})`)
      const schemaColumns = new Set(info.map((c) => c.name))
      const required = info
        .filter((c) => c.notnull === 1 && c.dflt_value === null && c.pk === 0)
        .map((c) => c.name)
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          // A stray key is silently DROPPED by the importer (column
          // intersection) — it must fail here instead of vanishing.
          expect(schemaColumns.has(key), `${table}.${key} is not a schema column`).toBe(true)
        }
        for (const key of required) {
          expect(row[key], `${table}.${key} is NOT NULL without default but is missing`).not.toBeUndefined()
        }
      }
    }
  })

  it('syncable rows carry valid, table-unique uuids (the v2+ backup contract)', () => {
    for (const table of SYNCABLE_TABLES) {
      const rows = payload.tables[table] as FixtureRow[]
      if (!rows || rows.length === 0) continue
      const seen = new Set<string>()
      for (const row of rows) {
        expect(typeof row['uuid'], `${table} row missing uuid`).toBe('string')
        expect(isValidUuid(row['uuid'] as string), `${table} uuid "${String(row['uuid'])}" is not UUIDv7-shaped`).toBe(true)
        expect(seen.has(row['uuid'] as string), `${table} uuid "${String(row['uuid'])}" is duplicated`).toBe(false)
        seen.add(row['uuid'] as string)
      }
    }
  })
})

describe('qa-backup.json — the BUG-009 workout-seeding contract', () => {
  it('seeds exactly one ACTIVE workout whose set editor is reachable at /workout?id=1', async () => {
    const active = await db.all<{ id: number; name: string; status: string }>(
      "SELECT id, name, status FROM workouts WHERE status = 'active' AND deleted_at IS NULL",
    )
    // one_active_workout (partial unique index) — and the spec navigates to id 1.
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe(1)
    expect(active[0]!.name).toBe('QA Upper Day')
  })

  it('the workout has a weight_reps exercise with a completed set and an OPEN set to edit', async () => {
    const exercise = await db.get<{ name: string; tracking_type: string }>(
      `SELECT e.name, e.tracking_type FROM workout_exercises we
         JOIN exercises e ON e.id = we.exercise_id
        WHERE we.workout_id = 1 AND we.deleted_at IS NULL`,
    )
    expect(exercise).not.toBeNull()
    expect(exercise!.tracking_type).toBe('weight_reps')

    const sets = await db.all<{ sort_order: number; load_kg: number | null; reps: number | null; completed_at: number | null }>(
      `SELECT sort_order, load_kg, reps, completed_at FROM workout_sets
        WHERE workout_exercise_id = 1 AND deleted_at IS NULL ORDER BY sort_order`,
    )
    expect(sets.length).toBeGreaterThanOrEqual(2)
    expect(sets.some((s) => s.completed_at !== null)).toBe(true)
    // The open row the e2e test types into — it must already carry load+reps
    // so completing it passes the set-tracking trigger.
    const open = sets.filter((s) => s.completed_at === null)
    expect(open.length).toBeGreaterThanOrEqual(1)
    expect(open[0]!.load_kg).not.toBeNull()
    expect(open[0]!.reps).not.toBeNull()
  })

  it('pins the lb unit preference the set-editor labels depend on', async () => {
    const unit = await db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'weight.displayUnit'",
    )
    expect(unit?.value).toBe('lb')
  })

  it('exercise rows are LIBRARY rows — the boot reseed skips them by uuid, never id-collides', () => {
    // seedExercises() (packages/training) re-inserts the exercise library
    // with hardcoded ids 1..N whenever the exercises table is smaller than
    // the library, and it de-dupes by uuid, NOT id. A fixture exercise row
    // with a non-library uuid sitting on a library id therefore crashes the
    // NEXT app boot with SQLITE_CONSTRAINT_PRIMARYKEY (found by probing the
    // restored workout journey while building this fixture). Keeping the
    // fixture's exercise rows byte-identical to library rows (uuid =
    // deterministicUuidV7(0, 'nutai.exercise.v1:' + name), created_at 0)
    // makes the reseed a no-op for them — and is what a real backup taken
    // from a seeded install contains anyway.
    for (const row of payload.tables['exercises'] as FixtureRow[]) {
      expect(
        deterministicUuidV7(0, `nutai.exercise.v1:${row['name'] as string}`),
        `exercises.id ${String(row['id'])}: uuid must be the library uuid for "${String(row['name'])}"`,
      ).toBe(row['uuid'])
      expect(row['created_at']).toBe(0)
      expect(row['is_custom']).toBe(0)
    }
  })
})
