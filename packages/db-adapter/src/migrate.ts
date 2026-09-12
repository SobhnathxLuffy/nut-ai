import { MIGRATIONS, USER_SCHEMA_VERSION } from './schema.js'
import type { DbAdapter } from './types.js'

/**
 * Forward-only migration runner.
 *
 * Shared by both implementations, which is the point: a migration that works in
 * the Node test harness and fails on device is exactly the bug this package
 * exists to make impossible.
 */

export async function currentVersion(db: DbAdapter): Promise<number> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)
  const row = await db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')
  return row?.v ?? 0
}

export interface MigrationResult {
  from: number
  to: number
  applied: number[]
}

/**
 * Bring a user database up to the current schema version.
 *
 * `now` is passed in rather than read from the clock, so migration tests are
 * deterministic and so this module stays free of ambient state.
 */
export async function migrate(
  db: DbAdapter,
  now: number,
  targetVersion: number = USER_SCHEMA_VERSION,
): Promise<MigrationResult> {
  const from = await currentVersion(db)
  const applied: number[] = []

  for (const m of MIGRATIONS) {
    if (m.version <= from) continue
    if (m.version > targetVersion) break
    // Each migration is its own transaction. A failure leaves the database at the
    // last good version rather than half-way into a new one.
    await db.transaction(async (tx) => {
      await tx.exec(m.sql)
      if (m.up) {
        await m.up(tx, now)
      }
      await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        m.version,
        now,
      ])
    })
    applied.push(m.version)
  }

  return { from, to: await currentVersion(db), applied }
}

export function isUpToDate(version: number): boolean {
  return version >= USER_SCHEMA_VERSION
}
