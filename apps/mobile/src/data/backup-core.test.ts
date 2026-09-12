import { beforeEach, describe, expect, it } from 'vitest'
import {
  generateUuidV7,
  backfillV2,
  isValidUuid,
  migrate,
  USER_SCHEMA_VERSION,
  type DbAdapter,
} from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  BACKUP_FORMAT_VERSION,
  buildBackupPayload,
  describeBackup,
  EXPORT_TABLES,
  importBackupPayload,
  parseBackup,
  serializeBackup,
  WIPE_ONLY_TABLES,
} from './backup-core'
import backupV1Fixture from './fixtures/backup-v1.json'
import backupV2Fixture from './fixtures/backup-v2.json'

/**
 * Backup round-trips against the REAL user schema — the same migrate() the app
 * runs. If restore can lose or corrupt data, it fails here, not on a phone.
 */

let db: DbAdapter

const NOW = 1_754_100_000_000

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON;')
  await migrate(db, NOW)
})

async function seed(d: DbAdapter): Promise<void> {
  await d.run(
    `INSERT INTO user_profile (id, sex, birth_year, height_cm, units, created_at) VALUES (1,'male',2003,180,'imperial',?)`,
    [NOW],
  )
  await d.run(
    `INSERT INTO goals (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
                        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,1)`,
    [NOW, 'gain', 0.5, 3400, 3400, 180, 100, 450, 1900, 3150],
  )
  await d.run(`INSERT INTO settings (key, value) VALUES ('provider','anthropic')`)
  const meal = await d.run(
    `INSERT INTO meals (id, logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                        analysis_status, engine_id, created_at)
     VALUES (77, ?, '2026-08-01', 'lunch', 'file:///tmp/cache/photo.jpg', 1.0, 'complete', 'test', ?)`,
    [NOW, NOW],
  )
  expect(Number(meal.lastInsertRowId)).toBe(77)
  await d.run(
    `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway,
                            portion_source, snap_energy_kcal, is_estimate, macros_user_edited,
                            sort_order, logged_at)
     VALUES (77, 'corpus', 'Chicken', 170, 'discrete_count', 'vision_model', 165, 0, 0, 0, ?)`,
    [NOW],
  )
  await d.run(`INSERT INTO weight_entries (local_date, weight_kg, logged_at) VALUES ('2026-08-01', 79.4, ?)`, [NOW])
  await backfillV2(d, NOW)
  // Derived cache row — must be wiped on import and never exported.
  await d.run(`INSERT INTO day_summaries (local_date, kcal) VALUES ('2026-08-01', 500)`).catch(() => {})
}

async function exportOf(d: DbAdapter) {
  return buildBackupPayload(d, { schemaVersion: USER_SCHEMA_VERSION, appVersion: '0.1.0', now: NOW })
}

describe('backup round trip', () => {
  it('restores byte-equal rows with foreign keys intact', async () => {
    await seed(db)
    const payload = await exportOf(db)
    const raw = serializeBackup(payload)

    // Fresh device.
    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)

    const parsed = parseBackup(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = await importBackupPayload(dst, parsed.payload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    const item = await dst.get<{ meal_id: number; display_name: string }>(
      'SELECT meal_id, display_name FROM log_items',
    )
    expect(item!.meal_id).toBe(77)
    const meal = await dst.get<{ id: number }>('SELECT id FROM meals')
    expect(meal!.id).toBe(77)
    const w = await dst.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(w!.weight_kg).toBeCloseTo(79.4, 6)
  })

  it('REPLACES pre-existing data — restore is not a merge', async () => {
    await seed(db)
    const payload = await exportOf(db)

    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)
    await dst.run(`INSERT INTO weight_entries (local_date, weight_kg, logged_at) VALUES ('2026-07-15', 99, ?)`, [NOW])

    await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    const rows = await dst.all('SELECT * FROM weight_entries')
    expect(rows).toHaveLength(1)
  })

  it('nulls photo_uri — camera temp paths are not durable anywhere', async () => {
    await seed(db)
    const payload = await exportOf(db)
    expect(payload.tables['meals']![0]!['photo_uri']).toBeNull()

    const dst = openMemoryDb()
    await migrate(dst, NOW)
    await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    const meal = await dst.get<{ photo_uri: string | null }>('SELECT photo_uri FROM meals')
    expect(meal!.photo_uri).toBeNull()
  })

  it('refuses a downgrade instead of corrupting silently', async () => {
    await seed(db)
    const payload = await exportOf(db)
    payload.schema_version = USER_SCHEMA_VERSION + 5
    const outcome = await importBackupPayload(db, payload, USER_SCHEMA_VERSION)
    expect(outcome).toEqual({ ok: false, reason: 'downgrade' })
  })

  it('refuses an unsupported future backup format version', async () => {
    await seed(db)
    const payload = await exportOf(db)
    payload.format_version = BACKUP_FORMAT_VERSION + 1
    const outcome = await importBackupPayload(db, payload, USER_SCHEMA_VERSION)
    expect(outcome).toEqual({ ok: false, reason: 'downgrade' })
  })

  it('tolerates schema drift in both directions via column intersection', async () => {
    await seed(db)
    const payload = await exportOf(db)
    // Simulate an OLD export: a NULLABLE column the current schema has is
    // absent. (Columns added by later migrations must be nullable or carry a
    // DEFAULT — that discipline is what makes old backups restorable at all.)
    for (const row of payload.tables['meals']!) delete row['meal_slot']
    // Simulate a FUTURE export: a column the current schema lacks.
    for (const row of payload.tables['weight_entries']!) row['mystery_future_col'] = 42

    const dst = openMemoryDb()
    await migrate(dst, NOW)
    const outcome = await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)
    const w = await dst.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(w!.weight_kg).toBeCloseTo(79.4, 6)
  })

  it('never exports derived caches, wipes them on import, never touches schema_migrations', async () => {
    await seed(db)
    const payload = await exportOf(db)
    for (const t of WIPE_ONLY_TABLES) expect(payload.tables[t]).toBeUndefined()
    expect(payload.tables['schema_migrations']).toBeUndefined()

    await importBackupPayload(db, payload, USER_SCHEMA_VERSION)
    const cache = await db.get<{ c: number }>('SELECT COUNT(*) c FROM day_summaries')
    expect(cache!.c).toBe(0)
    const mig = await db.get<{ c: number }>('SELECT COUNT(*) c FROM schema_migrations')
    expect(mig!.c).toBeGreaterThan(0)
  })

  it('rejects garbage files with named reasons', () => {
    expect(parseBackup('not json at all')).toEqual({ ok: false, reason: 'bad-json' })
    expect(parseBackup('{"some":"other file"}')).toEqual({ ok: false, reason: 'wrong-format' })
  })

  it('the wipe set exactly covers what a factory reset wipes', () => {
    // resetEverything() derives from these same lists; this pins the union.
    expect(EXPORT_TABLES.length + WIPE_ONLY_TABLES.length).toBe(31)
  })

  it('describes a backup in human terms for the restore preview', async () => {
    await seed(db)
    const payload = await exportOf(db)
    const desc = describeBackup(payload)
    expect(desc).toContain('1 meals')
    expect(desc).toContain('1 weigh-ins')
  })

  it('exports format v2 manifest with entity counts and UUID metadata', async () => {
    const mealUuid = generateUuidV7(NOW)
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, engine_id, created_at, uuid, sync_state)
       VALUES (1, ?, '2026-08-01', 'dinner', 1.0, 'complete', 'test', ?, ?, 'synced')`,
      [NOW, NOW, mealUuid],
    )

    const payload = await exportOf(db)
    expect(payload.format_version).toBe(2)
    expect(payload.manifest).toBeDefined()
    expect(payload.manifest!.format_version).toBe(2)
    expect(payload.manifest!.entity_counts.meals).toBe(1)
    expect(payload.manifest!.has_uuids).toBe(true)
    expect(payload.manifest!.tables.meals.has_uuid).toBe(true)
    expect(payload.manifest!.tables.meals.count).toBe(1)
  })

  it('round-trips v2 sync metadata and UUIDs byte-for-byte', async () => {
    const mealUuid = generateUuidV7(NOW)
    const itemUuid = generateUuidV7(NOW + 1)
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, engine_id, created_at, updated_at, revision, uuid, sync_state)
       VALUES (10, ?, '2026-08-01', 'snack', 1.0, 'complete', 'test', ?, ?, 3, ?, 'synced')`,
      [NOW, NOW, NOW + 500, mealUuid],
    )
    await db.run(
      `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source, logged_at, created_at, updated_at, revision, uuid, sync_state)
       VALUES (20, 10, 'corpus', 'Almonds', 30, 'discrete_count', 'manual', ?, ?, ?, 2, ?, 'pending')`,
      [NOW, NOW, NOW + 200, itemUuid],
    )

    const payload = await exportOf(db)
    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)

    const outcome = await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    const restoredMeal = await dst.get<{
      id: number
      uuid: string
      revision: number
      sync_state: string
      updated_at: number
    }>('SELECT id, uuid, revision, sync_state, updated_at FROM meals WHERE id = 10')
    expect(restoredMeal).toEqual({
      id: 10,
      uuid: mealUuid,
      revision: 3,
      sync_state: 'synced',
      updated_at: NOW + 500,
    })

    const restoredItem = await dst.get<{
      id: number
      uuid: string
      revision: number
      sync_state: string
      meal_id: number
    }>('SELECT id, uuid, revision, sync_state, meal_id FROM log_items WHERE id = 20')
    expect(restoredItem).toEqual({
      id: 20,
      uuid: itemUuid,
      revision: 2,
      sync_state: 'pending',
      meal_id: 10,
    })
  })

  it('strictly excludes secrets from export and strips secrets during import', async () => {
    // Insert benign and secret settings
    await db.run(`INSERT INTO settings (key, value) VALUES ('diet.style', 'balanced')`)
    await db.run(`INSERT INTO settings (key, value) VALUES ('anthropic_api_key', 'sk-ant-secret123')`)
    await db.run(`INSERT INTO settings (key, value) VALUES ('user_token', 'jwt-token-456')`)
    await db.run(`INSERT INTO settings (key, value) VALUES ('auth_credential', 'supersecret')`)

    const payload = await exportOf(db)
    const exportedKeys = (payload.tables['settings'] ?? []).map((s) => s.key)
    expect(exportedKeys).toContain('diet.style')
    expect(exportedKeys).not.toContain('anthropic_api_key')
    expect(exportedKeys).not.toContain('user_token')
    expect(exportedKeys).not.toContain('auth_credential')

    const serialized = serializeBackup(payload)
    expect(serialized).not.toContain('sk-ant-secret123')
    expect(serialized).not.toContain('jwt-token-456')
    expect(serialized).not.toContain('supersecret')

    // If an external/foreign backup payload contains secret settings, import strips them
    const maliciousPayload = JSON.parse(serialized)
    maliciousPayload.tables.settings.push({ key: 'injected_api_key', value: 'dangerous_val' })
    maliciousPayload.manifest.entity_counts.settings++
    maliciousPayload.manifest.tables.settings.count++

    const dst = openMemoryDb()
    await migrate(dst, NOW)
    const outcome = await importBackupPayload(dst, maliciousPayload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    const dstSettings = await dst.all<{ key: string }>('SELECT key FROM settings')
    const dstKeys = dstSettings.map((s) => s.key)
    expect(dstKeys).not.toContain('injected_api_key')
  })

  it('rejects corrupt backups without committing partial state', async () => {
    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)

    // Pre-populate dst with original data
    await dst.run(
      `INSERT INTO weight_entries (local_date, weight_kg, logged_at) VALUES ('2026-08-01', 82.0, ?)`,
      [NOW],
    )
    await dst.run(
      `INSERT INTO meals (id, logged_at, local_date, created_at) VALUES (1, ?, '2026-08-01', ?)`,
      [NOW, NOW],
    )

    // Corrupt Case 1: Foreign key violation (log_item points to nonexistent meal 999)
    const corruptFkPayload = await exportOf(dst)
    corruptFkPayload.tables['log_items'] = [
      {
        id: 1,
        meal_id: 999, // Missing meal!
        matched_food_source: 'corpus',
        display_name: 'Ghost Item',
        grams: 100,
        gram_pathway: 'manual',
        portion_source: 'manual',
        logged_at: NOW,
      },
    ]

    const fkOutcome = await importBackupPayload(dst, corruptFkPayload, USER_SCHEMA_VERSION)
    expect(fkOutcome).toEqual({ ok: false, reason: 'corrupt' })

    // Verify initial data was NOT wiped or modified (transaction rolled back)
    const weightsAfterFk = await dst.all<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(weightsAfterFk).toHaveLength(1)
    expect(weightsAfterFk[0]!.weight_kg).toBe(82.0)
    const mealsAfterFk = await dst.all<{ id: number }>('SELECT id FROM meals')
    expect(mealsAfterFk).toHaveLength(1)

    // Corrupt Case 2: Invalid UUID format
    const corruptUuidPayload = await exportOf(dst)
    corruptUuidPayload.tables['meals']![0]!['uuid'] = 'not-a-real-uuid'
    const uuidOutcome = await importBackupPayload(dst, corruptUuidPayload, USER_SCHEMA_VERSION)
    expect(uuidOutcome).toEqual({ ok: false, reason: 'corrupt' })

    // Verify initial data is still intact
    const mealsAfterUuid = await dst.all<{ id: number }>('SELECT id FROM meals')
    expect(mealsAfterUuid).toHaveLength(1)

    // Corrupt Case 3: Malformed table structure (meals is an object not array)
    const corruptShapePayload = await exportOf(dst)
    // @ts-expect-error test malformed shape
    corruptShapePayload.tables['meals'] = { invalid: true }
    const shapeOutcome = await importBackupPayload(dst, corruptShapePayload, USER_SCHEMA_VERSION)
    expect(shapeOutcome).toEqual({ ok: false, reason: 'corrupt' })
  })

  it('rejects a truncated backup before wiping existing data', async () => {
    await seed(db)
    const payload = await exportOf(db)
    delete payload.tables['goals']

    const before = await db.all('SELECT id FROM meals')
    const outcome = await importBackupPayload(db, payload, USER_SCHEMA_VERSION)
    expect(outcome).toEqual({ ok: false, reason: 'corrupt' })
    expect(await db.all('SELECT id FROM meals')).toEqual(before)
  })

  it('scrubs transient photo paths nested in operation snapshots', async () => {
    const opUuid = generateUuidV7(NOW)
    await db.run(
      `INSERT INTO operations
         (uuid, entity_type, entity_id, op_type, prev_json, actor, created_at)
       VALUES (?, 'meals', 1, 'delete', ?, 'user', ?)`,
      [opUuid, JSON.stringify({ meal: { id: 1, photo_uri: 'file:///tmp/private.jpg' }, items: [] }), NOW],
    )
    const payload = await exportOf(db)
    const snapshot = JSON.parse(String(payload.tables['operations']![0]!['prev_json']))
    expect(snapshot.meal.photo_uri).toBeNull()
    expect(serializeBackup(payload)).not.toContain('file:///tmp/private.jpg')
  })

  it('imports v1 backup fixture with backward compatibility, backfilling valid UUIDv7s', async () => {
    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)

    // @ts-expect-error fixture is v1
    const outcome = await importBackupPayload(dst, backupV1Fixture, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    // Meal and items from v1 fixture had no UUIDs — they must now have valid UUIDv7s
    const meal = await dst.get<{ id: number; uuid: string; sync_state: string }>('SELECT id, uuid, sync_state FROM meals WHERE id = 77')
    expect(meal).toBeDefined()
    expect(meal!.id).toBe(77)
    expect(typeof meal!.uuid).toBe('string')
    expect(isValidUuid(meal!.uuid)).toBe(true)
    expect(meal!.sync_state).toBe('local')

    const item = await dst.get<{ id: number; uuid: string; sync_state: string }>('SELECT id, uuid, sync_state FROM log_items WHERE id = 1')
    expect(item).toBeDefined()
    expect(isValidUuid(item!.uuid)).toBe(true)
    expect(item!.sync_state).toBe('local')

    const weight = await dst.get<{ uuid: string }>('SELECT uuid FROM weight_entries WHERE local_date = ?', ['2026-08-01'])
    expect(weight).toBeDefined()
    expect(isValidUuid(weight!.uuid)).toBe(true)

    const container = await dst.get<{ uuid: string }>('SELECT uuid FROM user_containers WHERE id = 1')
    expect(container).toBeDefined()
    expect(isValidUuid(container!.uuid)).toBe(true)
  })

  it('imports v2 backup fixture preserving all original UUIDs and metadata', async () => {
    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)

    // @ts-expect-error fixture is typed as JSON
    const outcome = await importBackupPayload(dst, backupV2Fixture, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    const meal = await dst.get<{ id: number; uuid: string }>('SELECT id, uuid FROM meals WHERE id = 77')
    expect(meal!.uuid).toBe('01993437-0000-7000-8000-000000000005')

    const item = await dst.get<{ id: number; uuid: string }>('SELECT id, uuid FROM log_items WHERE id = 1')
    expect(item!.uuid).toBe('01993437-0000-7000-8000-000000000006')
  })

  it('round-trips operations in v2 backup', async () => {
    const opUuid = generateUuidV7(NOW)
    await db.run(
      `INSERT INTO operations (id, uuid, entity_type, entity_id, op_type, prev_json, new_json, actor, idempotency_key, created_at, undone_at)
       VALUES (1, ?, 'meals', 77, 'delete', '{"meal":{"id":77}}', NULL, 'user', 'idem-123', ?, NULL)`,
      [opUuid, NOW],
    )

    const payload = await exportOf(db)
    expect(payload.tables['operations']).toBeDefined()
    expect(payload.tables['operations']).toHaveLength(1)
    expect(payload.tables['operations']![0]!['uuid']).toBe(opUuid)
    expect(payload.tables['operations']![0]!['actor']).toBe('user')
    expect(payload.tables['operations']![0]!['idempotency_key']).toBe('idem-123')

    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)
    const outcome = await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    const op = await dst.get<{ id: number; uuid: string; actor: string; idempotency_key: string }>(
      'SELECT id, uuid, actor, idempotency_key FROM operations WHERE id = 1',
    )
    expect(op).toBeDefined()
    expect(op!.uuid).toBe(opUuid)
    expect(op!.actor).toBe('user')
    expect(op!.idempotency_key).toBe('idem-123')
  })
})
