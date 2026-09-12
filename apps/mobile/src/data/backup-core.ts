import type { DbAdapter, SqlValue } from '@nutai/db-adapter'
import {
  deterministicUuidV7,
  isValidOperationPayload,
  isValidUuid,
  normalizeOperationEntityType,
} from '@nutai/db-adapter'

/**
 * Backup and restore — the pure core.
 *
 * ZERO React Native imports, deliberately: this module runs under bare Node in
 * the test suite against the REAL user schema, which is the only way "restore
 * works" can be a tested claim instead of a hope. The expo-facing file I/O
 * lives in backup.ts.
 *
 * The rules that are not negotiable:
 *
 *   CREDENTIALS NEVER TRAVEL. API keys live in the Keychain, out-of-band from
 *   user.db, and a plaintext JSON export is exactly where a key must not be.
 *   After a restore the user re-enters their key — the restore screen says so.
 *
 *   IMPORT REPLACES, ATOMICALLY. One transaction: delete everything, insert
 *   everything, preserving integer primary keys so meal→item foreign keys
 *   survive byte-for-byte. Half a restore is worse than no restore.
 *
 *   SCHEMA DRIFT IS EXPECTED, NOT FATAL. Inserts use the intersection of the
 *   export's columns and the installed schema's columns (PRAGMA table_info),
 *   so an old backup restores into a newer app, and a column the new app
 *   dropped is ignored rather than crashing the import. The one thing refused
 *   is a DOWNGRADE — a backup from a newer schema than the installed app.
 */

export const BACKUP_FORMAT = 'nutai.backup'
export const BACKUP_FORMAT_VERSION = 2

/**
 * Exported tables, in FOREIGN-KEY-SAFE INSERT ORDER (parents before children:
 * meals before log_items). Deletion happens in the reverse of this order.
 */
export const EXPORT_TABLES = [
  'user_profile',
  'goals',
  'day_status',
  'settings',
  'consents',
  'user_foods',
  'recipes',
  'recipe_versions',
  'recipe_components',
  'user_containers',
  'saved_meals',
  'personal_gram_priors',
  'food_attribute_memory',
  'weight_entries',
  'water_entries',
  'exercise_entries',
  'meals',
  'log_items',
  'scan_cost_ledger',
  'exercises', 'equipment_inventory', 'routines', 'programs', 'workouts', 'workout_exercises', 'workout_sets', 'logging_shortcuts',
  'operations',
] as const

/**
 * Wiped on import (and by a factory reset) but never exported: derived caches
 * and device-local data that would be dead weight or a guaranteed miss on
 * another device.
 */
export const WIPE_ONLY_TABLES = ['day_summaries', 'scan_cache', 'accuracy_baselines'] as const

/**
 * Tables that carry sync metadata (UUIDv7, created_at, updated_at, revision, sync_state).
 */
export const SYNCABLE_TABLES = [
  'meals',
  'log_items',
  'weight_entries',
  'exercise_entries',
  'user_foods',
  'recipes',
  'recipe_versions',
  'recipe_components',
  'saved_meals',
  'user_containers',
  'goals',
  'exercises', 'equipment_inventory', 'routines', 'programs', 'workouts', 'workout_exercises', 'workout_sets', 'logging_shortcuts',
] as const

export type BackupRow = Record<string, SqlValue>

export interface BackupTableMeta {
  count: number
  has_uuid: boolean
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  format_version: number
  schema_version: number
  exported_at: number
  app_version: string
  entity_counts: Record<string, number>
  has_uuids: boolean
  tables: Record<string, BackupTableMeta>
}

export interface BackupPayload {
  format: typeof BACKUP_FORMAT
  format_version: number
  schema_version: number
  exported_at: number
  app_version: string
  manifest?: BackupManifest
  tables: Record<string, BackupRow[]>
}

const SECRET_SETTING_PATTERN = /(key|secret|token|password|auth|credential)/i

export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_PATTERN.test(key)
}

function scrubOperationJson(value: SqlValue): SqlValue {
  if (typeof value !== 'string') return value
  try {
    const payload = JSON.parse(value) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return value
    const record = payload as Record<string, unknown>
    if (Array.isArray(record['changes'])) {
      for (const change of record['changes'] as Record<string, unknown>[]) {
        for (const key of ['prev','next']) {
          if (change[key]) change[key] = JSON.parse(String(scrubOperationJson(JSON.stringify(change[key])))) as unknown
        }
      }
    }
    const meal = record['meal']
    if (meal && typeof meal === 'object' && !Array.isArray(meal)) {
      record['meal'] = { ...(meal as Record<string, unknown>), photo_uri: null }
    } else if ('photo_uri' in record) {
      record['photo_uri'] = null
    }
    return JSON.stringify(record)
  } catch {
    return value
  }
}

function sanitizeExportRow(table: string, row: BackupRow): BackupRow {
  if (table === 'meals') return { ...row, photo_uri: null }
  if (table === 'operations') {
    return {
      ...row,
      prev_json: scrubOperationJson(row['prev_json'] ?? null),
      new_json: scrubOperationJson(row['new_json'] ?? null),
    }
  }
  return row
}

export async function buildBackupPayload(
  db: DbAdapter,
  meta: { schemaVersion: number; appVersion: string; now: number },
): Promise<BackupPayload> {
  const tables: Record<string, BackupRow[]> = {}
  const entityCounts: Record<string, number> = {}
  const tableMeta: Record<string, BackupTableMeta> = {}

  for (const t of EXPORT_TABLES) {
    let rows: BackupRow[]
    if (t === 'settings') {
      const allRows = await db.all<BackupRow>(`SELECT * FROM settings ORDER BY rowid ASC`)
      rows = allRows.filter((r) => typeof r['key'] !== 'string' || !isSecretSettingKey(r['key']))
    } else {
      rows = (await db.all<BackupRow>(`SELECT * FROM ${t} ORDER BY rowid ASC`)).map((row) =>
        sanitizeExportRow(t, row),
      )
    }
    tables[t] = rows
    entityCounts[t] = rows.length
    const hasUuid = (SYNCABLE_TABLES as readonly string[]).includes(t)
      ? rows.every((r) => typeof r['uuid'] === 'string' && isValidUuid(r['uuid']))
      : rows.some((r) => typeof r['uuid'] === 'string' && isValidUuid(r['uuid']))
    tableMeta[t] = { count: rows.length, has_uuid: hasUuid }
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: meta.schemaVersion,
    exported_at: meta.now,
    app_version: meta.appVersion,
    entity_counts: entityCounts,
    has_uuids: SYNCABLE_TABLES.every((table) => tableMeta[table]?.has_uuid === true),
    tables: tableMeta,
  }

  return {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: meta.schemaVersion,
    exported_at: meta.now,
    app_version: meta.appVersion,
    manifest,
    tables,
  }
}

/** lastInsertRowId can be bigint on some adapters; JSON.stringify throws on it. */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))
}

export type ParseFailure = 'bad-json' | 'wrong-format'

export function parseBackup(raw: string):
  | { ok: true; payload: BackupPayload }
  | { ok: false; reason: ParseFailure } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
  const p = json as Partial<BackupPayload> | null
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    p.format !== BACKUP_FORMAT ||
    typeof p.schema_version !== 'number' ||
    typeof p.tables !== 'object' ||
    p.tables === null ||
    Array.isArray(p.tables)
  ) {
    return { ok: false, reason: 'wrong-format' }
  }
  return { ok: true, payload: p as BackupPayload }
}

export interface ValidationOutcome {
  valid: boolean
  reason?: 'downgrade' | 'corrupt'
  error?: string
}

export function validateBackupPayload(
  payload: BackupPayload,
  installedSchemaVersion: number,
): ValidationOutcome {
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.format !== BACKUP_FORMAT ||
    typeof payload.schema_version !== 'number' ||
    typeof payload.exported_at !== 'number' ||
    typeof payload.tables !== 'object' ||
    payload.tables === null ||
    Array.isArray(payload.tables)
  ) {
    return { valid: false, reason: 'corrupt', error: 'Invalid backup structure' }
  }

  if (payload.schema_version > installedSchemaVersion) {
    return { valid: false, reason: 'downgrade', error: 'Backup schema version is newer than installed' }
  }

  if (typeof payload.format_version === 'number' && payload.format_version > BACKUP_FORMAT_VERSION) {
    return { valid: false, reason: 'downgrade', error: 'Backup format version is newer than supported' }
  }

  const requiredTables = [
    'user_profile', 'goals', 'settings', 'consents', 'user_foods',
    'user_containers', 'saved_meals', 'personal_gram_priors', 'food_attribute_memory',
    'weight_entries', 'water_entries', 'exercise_entries', 'meals', 'log_items', 'scan_cost_ledger',
  ]
  if (payload.schema_version >= 3) requiredTables.push('day_status')
  if (payload.schema_version >= 4) requiredTables.push('operations')
  if (payload.schema_version >= 7) requiredTables.push('recipes', 'recipe_versions', 'recipe_components')
  if (payload.schema_version >= 10) requiredTables.push('exercises','equipment_inventory','routines','programs','workouts','workout_exercises','workout_sets','logging_shortcuts')
  for (const table of requiredTables) {
    if (!Object.prototype.hasOwnProperty.call(payload.tables, table)) {
      return { valid: false, reason: 'corrupt', error: `Required table ${table} is missing` }
    }
  }

  if ((payload.format_version ?? 1) >= 2) {
    if (!payload.manifest || payload.manifest.schema_version !== payload.schema_version) {
      return { valid: false, reason: 'corrupt', error: 'Backup manifest is missing or inconsistent' }
    }
    for (const table of requiredTables) {
      const rows = payload.tables[table]
      const count = payload.manifest.entity_counts[table]
      if (!Array.isArray(rows) || count !== rows.length || payload.manifest.tables[table]?.count !== rows.length) {
        return { valid: false, reason: 'corrupt', error: `Manifest count mismatch for ${table}` }
      }
    }
  }

  // Validate meals and log items if present
  const mealIds = new Set<number>()
  if (payload.tables['meals'] != null) {
    if (!Array.isArray(payload.tables['meals'])) {
      return { valid: false, reason: 'corrupt', error: 'meals table is not an array' }
    }
    for (const m of payload.tables['meals']) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) {
        return { valid: false, reason: 'corrupt', error: 'Malformed meal row' }
      }
      if (typeof m['id'] === 'number') {
        mealIds.add(m['id'])
      }
      const mUuid = m['uuid']
      if (mUuid != null && (typeof mUuid !== 'string' || !isValidUuid(mUuid))) {
        return { valid: false, reason: 'corrupt', error: 'Invalid meal UUID' }
      }
    }
  }

  if (payload.tables['log_items'] != null) {
    if (!Array.isArray(payload.tables['log_items'])) {
      return { valid: false, reason: 'corrupt', error: 'log_items table is not an array' }
    }
    for (const item of payload.tables['log_items']) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { valid: false, reason: 'corrupt', error: 'Malformed log item row' }
      }
      const itemUuid = item['uuid']
      if (itemUuid != null && (typeof itemUuid !== 'string' || !isValidUuid(itemUuid))) {
        return { valid: false, reason: 'corrupt', error: 'Invalid log item UUID' }
      }
      if (typeof item['grams'] === 'number' && item['grams'] < 0) {
        return { valid: false, reason: 'corrupt', error: 'Negative grams in log item' }
      }
      const mealId = item['meal_id']
      if (payload.tables['meals'] && typeof mealId === 'number' && !mealIds.has(mealId)) {
        return { valid: false, reason: 'corrupt', error: `log_item references unknown meal_id: ${mealId}` }
      }
    }
  }

  for (const t of EXPORT_TABLES) {
    const rows = payload.tables[t]
    if (rows == null) continue
    if (!Array.isArray(rows)) {
      return { valid: false, reason: 'corrupt', error: `Table ${t} is not an array` }
    }
    for (const r of rows) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        return { valid: false, reason: 'corrupt', error: `Invalid row in table ${t}` }
      }
      const rUuid = r['uuid']
      if (rUuid != null && (typeof rUuid !== 'string' || !isValidUuid(rUuid))) {
        return { valid: false, reason: 'corrupt', error: `Invalid UUID in table ${t}` }
      }
      if (
        payload.schema_version >= 2 &&
        (SYNCABLE_TABLES as readonly string[]).includes(t) &&
        (typeof rUuid !== 'string' || !isValidUuid(rUuid))
      ) {
        return { valid: false, reason: 'corrupt', error: `Missing UUID in syncable table ${t}` }
      }
      if (t === 'day_status') {
        if (!['complete', 'partial', 'unknown', 'fasting'].includes(String(r['completion']))) {
          return { valid: false, reason: 'corrupt', error: 'Invalid day status completion' }
        }
        if (!['user', 'system', 'auto'].includes(String(r['actor']))) {
          return { valid: false, reason: 'corrupt', error: 'Invalid day status actor' }
        }
      }
      if (t === 'operations') {
        if (typeof r['entity_type'] !== 'string' || !normalizeOperationEntityType(r['entity_type'])) {
          return { valid: false, reason: 'corrupt', error: 'Invalid operation entity type' }
        }
        if (!['insert', 'update', 'delete'].includes(String(r['op_type']))) {
          return { valid: false, reason: 'corrupt', error: 'Invalid operation type' }
        }
        if (!['user', 'system', 'sync', 'auto'].includes(String(r['actor']))) {
          return { valid: false, reason: 'corrupt', error: 'Invalid operation actor' }
        }
        for (const field of ['prev_json', 'new_json'] as const) {
          const json = r[field]
          if (json !== null && json !== undefined && (
            typeof json !== 'string' || !isValidOperationPayload(String(r['entity_type']), json)
          )) {
            return { valid: false, reason: 'corrupt', error: `Invalid operation ${field}` }
          }
        }
      }
    }
  }

  return { valid: true }
}

export type ImportOutcome =
  | { ok: true; rowCounts: Record<string, number> }
  | { ok: false; reason: 'downgrade' | 'corrupt' }

/**
 * Wipe-then-insert inside one transaction.
 *
 * Table names come ONLY from the static lists above — never from the file —
 * which is what makes the string interpolation below safe. A backup cannot
 * name a table into this code path.
 */
export async function importBackupPayload(
  db: DbAdapter,
  payload: BackupPayload,
  installedSchemaVersion: number,
): Promise<ImportOutcome> {
  const validation = validateBackupPayload(payload, installedSchemaVersion)
  if (!validation.valid) {
    return { ok: false, reason: validation.reason ?? 'corrupt' }
  }

  const rowCounts: Record<string, number> = {}

  // Schema introspection happens OUTSIDE the write transaction: it's metadata,
  // not part of the atomic change — and expo-sqlite is happier not mixing
  // PRAGMA reads into an exclusive transaction.
  const columnsByTable = new Map<string, Set<string>>()
  for (const t of EXPORT_TABLES) {
    const installed = await db.all<{ name: string }>(`PRAGMA table_info(${t})`)
    columnsByTable.set(t, new Set(installed.map((c) => c.name)))
  }

  try {
    await db.transaction(async (tx) => {
      // Children before parents.
      const wipeOrder: string[] = [...([...EXPORT_TABLES] as string[]).reverse(), ...WIPE_ONLY_TABLES]
      for (const t of wipeOrder) {
        try {
          await tx.run(`DELETE FROM ${t}`)
        } catch {
          // A table a future schema removed. Nothing to wipe is fine.
        }
      }

      for (const t of EXPORT_TABLES) {
        const rawRows = payload.tables[t]
        if (!rawRows || rawRows.length === 0) {
          rowCounts[t] = 0
          continue
        }

        const installedCols = columnsByTable.get(t) ?? new Set<string>()
        const isSyncable = (SYNCABLE_TABLES as readonly string[]).includes(t)
        const rows: BackupRow[] = []

        for (const [rowIndex, rawRow] of rawRows.entries()) {
          // Defense-in-depth: Never import secret keys into settings
          if (t === 'settings' && typeof rawRow['key'] === 'string' && isSecretSettingKey(rawRow['key'])) {
            continue
          }

          let processedRow = sanitizeExportRow(t, rawRow)
          // Backfill UUIDv7 and sync metadata for v1 backups or legacy rows missing UUID
          if (isSyncable && installedCols.has('uuid')) {
            const rowUuid = processedRow['uuid']
            if (!rowUuid || typeof rowUuid !== 'string') {
              let ts = payload.exported_at
              const rowCreatedAt = processedRow['created_at']
              const rowLoggedAt = processedRow['logged_at']
              const rowEffectiveFrom = processedRow['effective_from']
              if (typeof rowCreatedAt === 'number') {
                ts = rowCreatedAt
              } else if (typeof rowLoggedAt === 'number') {
                ts = rowLoggedAt
              } else if (typeof rowEffectiveFrom === 'number') {
                ts = rowEffectiveFrom
              }
              processedRow = {
                ...processedRow,
                uuid: deterministicUuidV7(ts, `${t}:${String(processedRow['id'] ?? rowIndex)}`),
                created_at: processedRow['created_at'] ?? ts,
                updated_at: processedRow['updated_at'] ?? ts,
                revision: processedRow['revision'] ?? 1,
                deleted_at: processedRow['deleted_at'] ?? null,
                sync_state: processedRow['sync_state'] ?? 'local',
              }
            }
          }
          rows.push(processedRow)
        }

        if (rows.length === 0) {
          rowCounts[t] = 0
          continue
        }

        const allRowKeys = new Set<string>()
        for (const r of rows) {
          for (const k of Object.keys(r)) {
            allRowKeys.add(k)
          }
        }
        const cols = Array.from(allRowKeys).filter((c) => installedCols.has(c))
        if (cols.length === 0) {
          rowCounts[t] = 0
          continue
        }

        const placeholders = cols.map(() => '?').join(',')
        const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`
        let n = 0
        for (const row of rows) {
          const values = cols.map((c) => {
            // Camera temp URIs are not durable even on the same device. A broken
            // path is worse than an honest null.
            if (t === 'meals' && c === 'photo_uri') return null
            return row[c] ?? null
          })
          await tx.run(sql, values)
          n++
        }
        rowCounts[t] = n
      }

      // Foreign key integrity verification before commit
      const fkViolations = await tx.all('PRAGMA foreign_key_check;')
      if (fkViolations.length > 0) {
        throw new Error(`Foreign key check failed: ${JSON.stringify(fkViolations)}`)
      }
    })
  } catch {
    return { ok: false, reason: 'corrupt' }
  }

  return { ok: true, rowCounts }
}

/** Human summary for the restore preview: "142 meals · 38 weigh-ins · …" */
export function describeBackup(payload: BackupPayload): string {
  const count = (t: string) => payload.tables[t]?.length ?? 0
  const parts: string[] = []
  if (count('meals')) parts.push(`${count('meals')} meals`)
  if (count('weight_entries')) parts.push(`${count('weight_entries')} weigh-ins`)
  if (count('exercise_entries')) parts.push(`${count('exercise_entries')} workouts`)
  if (count('saved_meals')) parts.push(`${count('saved_meals')} saved foods`)
  return parts.length ? parts.join(' · ') : 'settings and goals only'
}
