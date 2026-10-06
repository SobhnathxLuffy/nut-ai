import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './node.js'
import { MIGRATIONS, USER_SCHEMA_VERSION } from './schema.js'
import { currentVersion, migrate } from './migrate.js'

/**
 * Schema v13 — favorites-only logging_shortcuts (favorites-only consolidation).
 *
 * The three shortcut kinds collapsed to one: 'favorite'. SQLite cannot alter a
 * CHECK constraint, so v13 rebuilds the table, remapping every 'usual'/'saved'
 * row to 'favorite' and deduping live rows per meal (the partial unique index
 * allows one live row per (meal_id, kind); after the remap the lowest id wins).
 * The acceptance bar is the AGENTS §10 discipline: a populated v12 database
 * upgrades with its user data intact (names, snapshots, deleted rows), a fresh
 * database lands at v13, and non-favorite kinds are rejected loudly from then
 * on.
 */
const NOW = 1_754_300_000_000

async function seedShortcut(
  db: ReturnType<typeof openMemoryDb>,
  id: number,
  mealId: number,
  kind: 'favorite' | 'usual' | 'saved',
  name: string,
  options?: { deleted?: boolean },
): Promise<void> {
  await db.run(
    `INSERT INTO logging_shortcuts (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
                                    meal_id, kind, name, snapshot_json)
     VALUES (?, ?, ?, ?, 1, ?, 'local', ?, ?, ?, ?)`,
    [
      id,
      `01992820-0000-7000-8000-0000000000${String(id).padStart(2, '0')}`,
      NOW,
      NOW,
      options?.deleted ? NOW : null,
      mealId,
      kind,
      name,
      JSON.stringify({ meal: { id: mealId }, items: [{ display_name: name }] }),
    ],
  )
}

describe('schema v13 favorites-only shortcuts', () => {
  it('migrates a populated v12 database: kinds converted, live rows deduped per meal', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW, 12)

    // Reconstruct the pre-v13 table: the v10 DDL shipped the three-kind CHECK,
    // but a partial migrate from scratch now builds the favorites-only one
    // (the same TRAINING_SQL serves both). This is exactly the shape a real
    // v12 database carried.
    await db.exec(`
      DROP TABLE logging_shortcuts;
      CREATE TABLE logging_shortcuts (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE CHECK(length(uuid)=36), created_at INTEGER NOT NULL,
       updated_at INTEGER, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), deleted_at INTEGER,
       sync_state TEXT NOT NULL DEFAULT 'local' CHECK(sync_state IN ('local','pending','synced','conflict')), meal_id INTEGER NOT NULL,
       kind TEXT NOT NULL CHECK(kind IN ('favorite','usual','saved')), name TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)));
      CREATE UNIQUE INDEX shortcut_unique ON logging_shortcuts(meal_id,kind) WHERE deleted_at IS NULL;
    `)

    // Pre-v13 a meal could hold favorite + usual + saved at once; the
    // migration must keep exactly ONE live row per meal — the lowest id.
    await seedShortcut(db, 1, 7, 'favorite', 'Breakfast fav')
    await seedShortcut(db, 2, 7, 'usual', 'Breakfast usual')
    await seedShortcut(db, 3, 7, 'saved', 'Breakfast saved')
    await seedShortcut(db, 4, 9, 'usual', 'Soup usual')
    // Deleted rows are outside the unique index — all of them survive.
    await seedShortcut(db, 5, 7, 'usual', 'Deleted usual', { deleted: true })

    const result = await migrate(db, NOW + 1)
    expect(result.applied).toEqual([13])
    expect(await currentVersion(db)).toBe(USER_SCHEMA_VERSION)

    const rows = await db.all<{
      id: number
      meal_id: number
      kind: string
      name: string
      deleted_at: number | null
      snapshot_json: string
    }>('SELECT id, meal_id, kind, name, deleted_at, snapshot_json FROM logging_shortcuts ORDER BY id')
    expect(rows).toEqual([
      { id: 1, meal_id: 7, kind: 'favorite', name: 'Breakfast fav', deleted_at: null, snapshot_json: JSON.stringify({ meal: { id: 7 }, items: [{ display_name: 'Breakfast fav' }] }) },
      { id: 4, meal_id: 9, kind: 'favorite', name: 'Soup usual', deleted_at: null, snapshot_json: JSON.stringify({ meal: { id: 9 }, items: [{ display_name: 'Soup usual' }] }) },
      { id: 5, meal_id: 7, kind: 'favorite', name: 'Deleted usual', deleted_at: NOW, snapshot_json: JSON.stringify({ meal: { id: 7 }, items: [{ display_name: 'Deleted usual' }] }) },
    ])
    // The rebuilt table keeps the partial unique index and its shape.
    const indexes = await db.all<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='logging_shortcuts'",
    )
    expect(indexes.some((i) => i.name === 'shortcut_unique' && i.sql?.includes("deleted_at IS NULL"))).toBe(true)
  })

  it('a fresh database lands at v13 with the favorites-only CHECK enforced', async () => {
    const db = openMemoryDb()
    const result = await migrate(db, NOW)
    expect(result.to).toBe(USER_SCHEMA_VERSION)
    expect(result.applied.at(-1)).toBe(13)

    await db.run(
      `INSERT INTO logging_shortcuts (uuid, created_at, meal_id, kind, name, snapshot_json)
       VALUES ('01992820-0000-7000-8000-0000000000aa', ?, 1, 'favorite', 'Oats', '{}')`,
      [NOW],
    )
    await expect(
      db.run(
        `INSERT INTO logging_shortcuts (uuid, created_at, meal_id, kind, name, snapshot_json)
         VALUES ('01992820-0000-7000-8000-0000000000bb', ?, 2, 'usual', 'X', '{}')`,
        [NOW],
      ),
    ).rejects.toThrow()
    await expect(
      db.run(
        `INSERT INTO logging_shortcuts (uuid, created_at, meal_id, kind, name, snapshot_json)
         VALUES ('01992820-0000-7000-8000-0000000000cc', ?, 3, 'saved', 'X', '{}')`,
        [NOW],
      ),
    ).rejects.toThrow()
  })

  it('keeps the chain forward-only: v1 immutable, v13 last, no downgrade path', () => {
    expect(MIGRATIONS[0]?.version).toBe(1)
    expect(MIGRATIONS.at(-1)?.version).toBe(13)
    expect(MIGRATIONS.some((m) => 'down' in m)).toBe(false)
  })

  it('cannot downgrade a v13 database by asking for an older target', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    const result = await migrate(db, NOW + 1, 12)
    expect(result.applied).toEqual([])
    expect(await currentVersion(db)).toBe(13)
  })
})
