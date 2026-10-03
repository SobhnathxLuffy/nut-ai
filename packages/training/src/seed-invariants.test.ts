import { describe, expect, it } from 'vitest'
import { deterministicUuidV7, generateUuidV7, migrate } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { EXERCISE_LIBRARY, listExercises, seedExercises } from './index.js'

/**
 * BUG-seed (Wave 5B) — the reseed boot crash, browser-reproduced in Task 5-1.
 *
 * A restored backup whose exercises rows sit on the library's hardcoded ids
 * with NON-library uuids (count < library size, uuid de-dupe misses them) made
 * the next app boot's reseed INSERT collide on exercises.id —
 * SQLITE_CONSTRAINT_PRIMARYKEY (1555) — and the workout screen rendered the raw
 * error. These tests lock the contract the fix must keep:
 *   - boot never crashes on any pre-existing row set
 *   - every library exercise exists after seedExercises (by uuid)
 *   - user-restored rows are never touched
 */

/** Insert one "restored backup" exercise row at an explicit id + non-library uuid. */
async function insertRestoredRow(
  db: ReturnType<typeof openMemoryDb>,
  id: number,
  name: string,
): Promise<void> {
  await db.run(
    `INSERT INTO exercises (id, uuid, created_at, revision, name, tracking_type, aliases_json,
       primary_muscles_json, is_custom, source)
     VALUES (?, ?, 0, 1, ?, 'weight_reps', '["alias"]', '["chest"]', 0, 'restored backup')`,
    [id, generateUuidV7(0), name],
  )
}

describe('seedExercises reseed invariants (BUG-seed, Wave 5B)', () => {
  it('a restored backup parked on library ids with non-library uuids no longer crashes boot', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    // Rows on the library's hardcoded ids 1 and 2 with their OWN uuids: the
    // count check passes (2 < library size) and the uuid de-dupe does not
    // recognise them — the exact pre-fix crash shape.
    await insertRestoredRow(db, 1, 'Restored Row One')
    await insertRestoredRow(db, 2, 'Restored Row Two')

    // Before the fix: SQLITE_CONSTRAINT_PRIMARYKEY 1555 on exercises.id.
    await expect(seedExercises(db)).resolves.toBeUndefined()

    // Library invariant: every library exercise exists after boot (by uuid).
    const uuids = new Set((await db.all<{ uuid: string }>('SELECT uuid FROM exercises')).map(r => r.uuid))
    for (const e of EXERCISE_LIBRARY) {
      expect(uuids.has(deterministicUuidV7(0, `nutai.exercise.v1:${e.name}`))).toBe(true)
    }

    // The user-restored rows are untouched — same ids, same names, no rewrite.
    const restored = await db.all<{ id: number; name: string }>(
      "SELECT id, name FROM exercises WHERE source='restored backup' ORDER BY id",
    )
    expect(restored).toEqual([
      { id: 1, name: 'Restored Row One' },
      { id: 2, name: 'Restored Row Two' },
    ])

    // Exactly library + restored rows — nothing duplicated, nothing dropped.
    expect((await listExercises(db)).length).toBe(EXERCISE_LIBRARY.length + 2)
    await db.close()
  })

  it('a partial library set plus restored rows seeds only the MISSING library rows', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    // One library row already present (by uuid) at a DIFFERENT id — restored
    // backups can re-map ids; the uuid is the lossless key (P2-42).
    const present = EXERCISE_LIBRARY[0]!
    await db.run(
      `INSERT INTO exercises (id, uuid, created_at, revision, name, tracking_type, aliases_json,
         primary_muscles_json, is_custom, source)
       VALUES (5, ?, 0, 1, ?, 'weight_reps', '[]', '["chest"]', 0, 'restored backup')`,
      [deterministicUuidV7(0, `nutai.exercise.v1:${present.name}`), present.name],
    )
    await insertRestoredRow(db, 1, 'Restored Squat Stand-in')

    await expect(seedExercises(db)).resolves.toBeUndefined()

    const rows = await db.all<{ uuid: string }>('SELECT uuid FROM exercises')
    const uuids = new Set(rows.map(r => r.uuid))
    // The already-present library row was NOT re-inserted (uuid de-dupe) and
    // the missing library rows were added.
    expect(rows).toHaveLength(EXERCISE_LIBRARY.length + 1)
    for (const e of EXERCISE_LIBRARY) {
      expect(uuids.has(deterministicUuidV7(0, `nutai.exercise.v1:${e.name}`))).toBe(true)
    }
    expect(await db.get<{ name: string }>("SELECT name FROM exercises WHERE source='restored backup' AND id=1")).toEqual({
      name: 'Restored Squat Stand-in',
    })
    await db.close()
  })

  it('a fresh install keeps the deterministic library ids, and reseeding is a no-op', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    // Fresh installs keep the hardcoded id mapping (first library row -> id 1)
    // — the collision fix must not perturb the clean-boot path.
    const first = await db.get<{ id: number }>('SELECT id FROM exercises WHERE uuid=?', [
      deterministicUuidV7(0, `nutai.exercise.v1:${EXERCISE_LIBRARY[0]!.name}`),
    ])
    expect(first?.id).toBe(1)

    // Second boot: the COUNT fast path (P2-36) short-circuits — no duplicate
    // rows, no error.
    await expect(seedExercises(db)).resolves.toBeUndefined()
    expect((await listExercises(db)).length).toBe(EXERCISE_LIBRARY.length)
    await db.close()
  })
})
