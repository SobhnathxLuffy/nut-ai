/**
 * Structured Operations and Undo Engine.
 *
 * ADR-012 & SPEC §8: Durable operations log for undo/redo, audit trailing,
 * and sync idempotency.
 *
 * Each mutation records:
 * - Unique UUIDv7 and integer ID
 * - Target entity reference (type and ID)
 * - Operation type (insert, update, delete)
 * - Before / after serialized payloads (prev_json, new_json)
 * - Actor (user, system, sync, auto)
 * - Optional idempotency key for deduplicated replays
 * - Timestamp and undone_at marker
 */

import type { DbAdapter } from './types.js'
import { generateUuidV7 } from './uuid.js'

export type OperationActor = 'user' | 'system' | 'sync' | 'auto'

export type OperationType = 'insert' | 'update' | 'delete'

export interface OperationRecord {
  id: number
  uuid: string
  entity_type: string
  entity_id: number
  op_type: OperationType
  prev_json: string | null
  new_json: string | null
  actor: OperationActor | string
  idempotency_key: string | null
  created_at: number
  undone_at: number | null
}

export interface RecordOperationInput {
  entityType: string
  entityId: number
  opType: OperationType
  prevJson?: string | Record<string, unknown> | null
  newJson?: string | Record<string, unknown> | null
  actor?: OperationActor | string
  idempotencyKey?: string | null
  createdAt?: number
}

export interface UndoResult {
  success: boolean
  reason?: 'not_found' | 'already_undone' | 'unsupported_entity' | 'error'
  error?: string
  operation?: OperationRecord
}

export interface RedoResult {
  success: boolean
  reason?: 'not_found' | 'not_undone' | 'unsupported_entity' | 'error'
  error?: string
  operation?: OperationRecord
}

export interface CompactOptions {
  maxAgeMs?: number
  maxCount?: number
  now?: number
}

const ENTITY_ALIASES: Readonly<Record<string, string>> = {
  meal: 'meals',
  weight_entry: 'weight_entries',
  exercise_entry: 'exercise_entries',
  goal: 'goals',
  user_food: 'user_foods',
  saved_meal: 'saved_meals',
  user_container: 'user_containers',
  recipe: 'recipes',
}

const ENTITY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(Object.entries({
    exercises: ['name','tracking_type','aliases_json','primary_muscles_json','secondary_muscles_json','antagonist_muscles_json','equipment_json','notes','media_uri','is_custom','source'],
    equipment_inventory: ['name','kind','weight_kg','count'], routines: ['name','definition_json'], programs: ['name','definition_json'],
    workouts: ['name','local_date','started_at','finished_at','status','notes','location','routine_id','rest_until'],
    workout_exercises: ['workout_id','exercise_id','sort_order','superset_group_id','notes','tracking_type'],
    workout_sets: ['workout_exercise_id','sort_order','kind','load_kg','reps','duration_s','distance_m','assistance_kg','rir','rpe','tempo','planned_json','completed_at'],
    logging_shortcuts: ['meal_id','kind','name','snapshot_json'],
  }).map(([table, columns]) => [table, ['id','uuid','created_at','updated_at','revision','deleted_at','sync_state',...columns]])),
  day_status: ['local_date','completion','confirmed_at','updated_at','actor','provenance'],
  batch: ['changes'],
  meals: ['id', 'logged_at', 'local_date', 'meal_slot', 'photo_uri', 'portion_eaten_fraction', 'analysis_status', 'retry_count', 'next_retry_at', 'engine_id', 'prompt_version', 'schema_version', 'clamp_flags_json', 'created_at', 'uuid', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  weight_entries: ['id', 'local_date', 'weight_kg', 'logged_at', 'uuid', 'created_at', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  exercise_entries: ['id', 'local_date', 'name', 'kcal', 'provenance', 'external_id', 'logged_at', 'uuid', 'created_at', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  goals: ['id', 'effective_from', 'goal_type', 'rate_lb_per_week', 'target_kcal', 'target_raw_kcal', 'floor_applied', 'protein_g', 'fat_g', 'carbs_g', 'bmr', 'tdee', 'adaptive', 'uuid', 'created_at', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  user_foods: ['id', 'name', 'brand', 'barcode', 'basis', 'serving_size_g', 'serving_amount', 'serving_unit', 'energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'source_photo_uri', 'pending_resolution', 'created_at', 'synced_to_community', 'uuid', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  saved_meals: ['id', 'name', 'items_json', 'use_count', 'last_used_at', 'created_at', 'uuid', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  user_containers: ['id', 'label', 'type', 'usable_ml', 'diameter_mm', 'created_at', 'uuid', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  recipes: ['id', 'uuid', 'name', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision'],
  recipe_versions: ['id', 'uuid', 'recipe_id', 'version_number', 'preparation', 'added_oil_g', 'added_water_g', 'final_cooked_weight_g', 'servings', 'created_at', 'sync_state', 'updated_at', 'revision', 'deleted_at'],
  recipe_components: ['id', 'uuid', 'recipe_version_id', 'food_id', 'gram_weight', 'created_at', 'sync_state', 'snap_energy_kcal', 'snap_protein_g', 'snap_fat_g', 'snap_carb_g', 'snap_fiber_g', 'snap_sugar_g', 'snap_sodium_mg', 'updated_at', 'revision', 'deleted_at', 'display_name'],
  log_items: ['id', 'meal_id', 'matched_food_id', 'matched_food_source', 'raw_model_label', 'display_name', 'grams', 'gram_pathway', 'portion_source', 'snap_energy_kcal', 'snap_protein_g', 'snap_fat_g', 'snap_carb_g', 'snap_fiber_g', 'snap_sugar_g', 'snap_sodium_mg', 'is_estimate', 'macros_user_edited', 'band_half_pct', 'assumptions_json', 'sort_order', 'logged_at', 'uuid', 'created_at', 'updated_at', 'revision', 'deleted_at', 'sync_state'],
  scan_cost_ledger: ['id', 'meal_id', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'local_month', 'created_at'],
}

export function normalizeOperationEntityType(entityType: string): string | null {
  const canonical = ENTITY_ALIASES[entityType] ?? entityType
  return ENTITY_COLUMNS[canonical] && canonical !== 'log_items' && canonical !== 'scan_cost_ledger'
    ? canonical
    : null
}

function validatedKeys(table: string, row: Record<string, unknown>, includeId: boolean): string[] {
  const allowed = new Set([...(ENTITY_COLUMNS[table] ?? []), ...(table === 'goals' ? ['adaptive_evidence_json'] : [])])
  const keys = Object.keys(row).filter((key) => row[key] !== undefined && (includeId || key !== 'id'))
  const invalid = keys.find((key) => !allowed.has(key))
  if (invalid) throw new Error(`Unsupported ${table} operation column: ${invalid}`)
  return keys
}

export function isValidOperationPayload(entityType: string, json: string): boolean {
  const table = normalizeOperationEntityType(entityType)
  if (!table) return false
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const payload = parsed as Record<string, unknown>
    if (table === 'batch') {
      return Object.keys(payload).length === 1 && Array.isArray(payload['changes']) && payload['changes'].length <= 1000 && payload['changes'].every((c: BatchChange) =>
        c && typeof c === 'object' && c.entityType !== 'batch' && Number.isSafeInteger(c.entityId) &&
        ['insert','update','delete'].includes(c.opType) &&
        (c.prev === null || isValidOperationPayload(c.entityType, JSON.stringify(c.prev))) &&
        (c.next === null || isValidOperationPayload(c.entityType, JSON.stringify(c.next))))
    }
    if (table === 'recipes' && 'recipe' in payload) {
      const recipe = payload['recipe']
      if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return false
      validatedKeys('recipes', recipe as Record<string, unknown>, true)
      for (const [key, childTable] of [
        ['versions', 'recipe_versions'],
        ['components', 'recipe_components'],
      ] as const) {
        const rows = payload[key]
        if (!Array.isArray(rows)) return false
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) return false
          validatedKeys(childTable, row as Record<string, unknown>, true)
        }
      }
      return true
    }
    if (table !== 'meals' || !('meal' in payload)) {
      validatedKeys(table, payload, true)
      return true
    }
    const meal = payload['meal']
    if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return false
    validatedKeys('meals', meal as Record<string, unknown>, true)
    for (const [key, childTable] of [
      ['items', 'log_items'],
      ['ledger', 'scan_cost_ledger'],
    ] as const) {
      const rows = payload[key]
      if (rows !== undefined && !Array.isArray(rows)) return false
      for (const row of rows ?? []) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false
        validatedKeys(childTable, row as Record<string, unknown>, true)
      }
    }
    return true
  } catch {
    return false
  }
}

async function insertRow(db: DbAdapter, table: string, row: Record<string, unknown>): Promise<void> {
  const keys = validatedKeys(table, row, true)
  if (keys.length === 0) return
  if (typeof row['id'] === 'number') {
    const existing = await db.get<{ id: number }>(`SELECT id FROM ${table} WHERE id = ?`, [row['id']])
    if (existing) throw new Error(`Cannot restore ${table} id ${row['id']}: identity is already in use`)
  }
  const cols = keys.join(', ')
  const placeholders = keys.map(() => '?').join(', ')
  const values = keys.map((k) => row[k] as import('./types.js').SqlValue)
  await db.run(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, values)
}

async function updateRow(db: DbAdapter, table: string, id: number, row: Record<string, unknown>): Promise<void> {
  const keys = validatedKeys(table, row, false)
  if (keys.length === 0) return
  const setClauses = keys.map((k) => `${k} = ?`).join(', ')
  const values = [...keys.map((k) => row[k] as import('./types.js').SqlValue), id]
  if (table === 'day_status') {
    await db.run(`UPDATE day_status SET ${setClauses} WHERE local_date = ?`, [...values.slice(0,-1), dayIdToDate(id)])
  } else await db.run(`UPDATE ${table} SET ${setClauses} WHERE id = ?`, values)
}

/**
 * Record a mutation in the operations table.
 * If an idempotencyKey is supplied and already recorded, returns the existing operation (deduplication).
 */
export async function recordOperation(
  db: DbAdapter,
  input: RecordOperationInput,
): Promise<OperationRecord> {
  const entityType = normalizeOperationEntityType(input.entityType)
  if (!entityType) throw new Error(`Unsupported operation entity: ${input.entityType}`)
  const actor = input.actor ?? 'user'
  if (!(['user', 'system', 'sync', 'auto'] as readonly string[]).includes(actor)) {
    throw new Error(`Unsupported operation actor: ${input.actor}`)
  }

  const createdAt = input.createdAt ?? Date.now()
  const uuid = generateUuidV7(createdAt)
  const prevJson =
    typeof input.prevJson === 'object' && input.prevJson !== null
      ? JSON.stringify(input.prevJson)
      : input.prevJson ?? null
  const newJson =
    typeof input.newJson === 'object' && input.newJson !== null
      ? JSON.stringify(input.newJson)
      : input.newJson ?? null
  if (prevJson && !isValidOperationPayload(entityType, prevJson)) {
    throw new Error(`Invalid previous payload for operation entity: ${entityType}`)
  }
  if (newJson && !isValidOperationPayload(entityType, newJson)) {
    throw new Error(`Invalid new payload for operation entity: ${entityType}`)
  }
  const idempotencyKey = input.idempotencyKey ?? null

  const res = await db.run(
    `INSERT OR IGNORE INTO operations
       (uuid, entity_type, entity_id, op_type, prev_json, new_json, actor, idempotency_key, created_at, undone_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [uuid, entityType, input.entityId, input.opType, prevJson, newJson, actor, idempotencyKey, createdAt],
  )

  if (res.changes === 0 && idempotencyKey) {
    const existing = await getOperationByIdempotencyKey(db, idempotencyKey)
    if (existing) return existing
  }
  if (res.changes === 0) throw new Error('Operation insert was rejected')

  const opId = Number(res.lastInsertRowId)
  const op = await getOperation(db, opId)
  if (!op) {
    throw new Error(`Failed to retrieve newly created operation with id ${opId}`)
  }
  return op
}

export async function getOperation(
  db: DbAdapter,
  idOrUuid: number | string,
): Promise<OperationRecord | null> {
  if (typeof idOrUuid === 'number') {
    const row = await db.get<OperationRecord>('SELECT * FROM operations WHERE id = ?', [idOrUuid])
    return row ?? null
  }
  const row = await db.get<OperationRecord>('SELECT * FROM operations WHERE uuid = ?', [idOrUuid])
  return row ?? null
}

export async function getOperationByIdempotencyKey(
  db: DbAdapter,
  idempotencyKey: string,
): Promise<OperationRecord | null> {
  const row = await db.get<OperationRecord>(
    'SELECT * FROM operations WHERE idempotency_key = ?',
    [idempotencyKey],
  )
  return row ?? null
}

export async function listOperations(
  db: DbAdapter,
  options?: {
    entityType?: string
    entityId?: number
    limit?: number
    offset?: number
    includeUndone?: boolean
  },
): Promise<OperationRecord[]> {
  const conditions: string[] = []
  const params: import('./types.js').SqlValue[] = []

  if (options?.entityType) {
    conditions.push('entity_type = ?')
    params.push(options.entityType)
  }
  if (options?.entityId !== undefined) {
    conditions.push('entity_id = ?')
    params.push(options.entityId)
  }
  if (options?.includeUndone === false) {
    conditions.push('undone_at IS NULL')
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options?.limit ?? 100
  const offset = options?.offset ?? 0

  params.push(limit, offset)

  return db.all<OperationRecord>(
    `SELECT * FROM operations ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    params,
  )
}

async function deleteEntity(db: DbAdapter, table: string, entityId: number): Promise<void> {
  if (table === 'day_status') {
    await db.run('DELETE FROM day_status WHERE local_date = ?', [dayIdToDate(entityId)])
    return
  }
  if (table === 'meals') {
    await db.run('DELETE FROM log_items WHERE meal_id = ?', [entityId])
    await db.run('DELETE FROM scan_cost_ledger WHERE meal_id = ?', [entityId])
  }
  if (table === 'recipes') {
    await db.run(
      'DELETE FROM recipe_components WHERE recipe_version_id IN (SELECT id FROM recipe_versions WHERE recipe_id = ?)',
      [entityId],
    )
    await db.run('DELETE FROM recipe_versions WHERE recipe_id = ?', [entityId])
  }
  await db.run(`DELETE FROM ${table} WHERE id = ?`, [entityId])
}

async function restoreEntity(
  db: DbAdapter,
  table: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (table === 'recipes') {
    const recipe = payload['recipe']
    const versions = payload['versions']
    const components = payload['components']
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || !Array.isArray(versions) || !Array.isArray(components)) {
      throw new Error('Invalid recipe operation payload')
    }
    await insertRow(db, 'recipes', recipe as Record<string, unknown>)
    for (const version of versions) {
      if (!version || typeof version !== 'object' || Array.isArray(version)) throw new Error('Invalid recipe version payload')
      await insertRow(db, 'recipe_versions', version as Record<string, unknown>)
    }
    for (const component of components) {
      if (!component || typeof component !== 'object' || Array.isArray(component)) throw new Error('Invalid recipe component payload')
      await insertRow(db, 'recipe_components', component as Record<string, unknown>)
    }
    return
  }
  if (table !== 'meals') {
    await insertRow(db, table, payload)
    return
  }

  const meal = payload['meal']
  if (!meal || typeof meal !== 'object' || Array.isArray(meal)) {
    throw new Error('Invalid meal operation payload')
  }
  await insertRow(db, 'meals', meal as Record<string, unknown>)

  for (const [key, childTable] of [
    ['items', 'log_items'],
    ['ledger', 'scan_cost_ledger'],
  ] as const) {
    const rows = payload[key]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new Error(`Invalid meal operation ${key} payload`)
    }
    for (const row of rows ?? []) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`Invalid row in meal operation ${key} payload`)
      }
      await insertRow(db, childTable, row as Record<string, unknown>)
    }
  }
}

/**
 * Reverses an operation and sets undone_at.
 */
export async function undoOperation(
  db: DbAdapter,
  idOrUuid: number | string,
  now: number = Date.now(),
): Promise<UndoResult> {
  const op = await getOperation(db, idOrUuid)
  if (!op) {
    return { success: false, reason: 'not_found' }
  }
  if (op.undone_at !== null) {
    return { success: false, reason: 'already_undone', operation: op }
  }

  const table = normalizeOperationEntityType(op.entity_type)
  if (!table) return { success: false, reason: 'unsupported_entity', operation: op }

  try {
    return await db.transaction(async (tx) => {
      const live = await getOperation(tx, op.id)
      if (!live || live.undone_at !== null) return { success: false, reason: 'already_undone' as const }
      if (table === 'batch') {
        await replayBatch(tx, op.new_json, true)
      } else if (op.op_type === 'insert') {
        await deleteEntity(tx, table, op.entity_id)
      } else if (op.op_type === 'delete') {
        if (!op.prev_json) throw new Error('No prev_json available to restore deleted entity')
        await restoreEntity(tx, table, JSON.parse(op.prev_json) as Record<string, unknown>)
      } else if (op.op_type === 'update') {
        if (!op.prev_json) throw new Error('No prev_json available to revert update')
        const prevData = JSON.parse(op.prev_json) as Record<string, unknown>
        if (table === 'recipes' || (table === 'meals' && 'meal' in prevData)) {
          await deleteEntity(tx, table, op.entity_id)
          await restoreEntity(tx, table, prevData)
        } else {
          const rowToRestore = (prevData['meal'] ?? prevData) as Record<string, unknown>
          await updateRow(tx, table, op.entity_id, rowToRestore)
        }
      }

      await tx.run('UPDATE operations SET undone_at = ? WHERE id = ?', [now, op.id])
      const updated = await getOperation(tx, op.id)
      return { success: true, operation: updated ?? op }
    })
  } catch (error) {
    return { success: false, reason: 'error', error: error instanceof Error ? error.message : String(error), operation: op }
  }
}

/**
 * Re-applies an undone operation and clears undone_at.
 */
export async function redoOperation(
  db: DbAdapter,
  idOrUuid: number | string,
): Promise<RedoResult> {
  const op = await getOperation(db, idOrUuid)
  if (!op) {
    return { success: false, reason: 'not_found' }
  }
  if (op.undone_at === null) {
    return { success: false, reason: 'not_undone', operation: op }
  }

  const table = normalizeOperationEntityType(op.entity_type)
  if (!table) return { success: false, reason: 'unsupported_entity', operation: op }

  try {
    return await db.transaction(async (tx) => {
      const live = await getOperation(tx, op.id)
      if (!live || live.undone_at === null) return { success: false, reason: 'not_undone' as const }
      if (table === 'batch') {
        await replayBatch(tx, op.new_json, false)
      } else if (op.op_type === 'insert') {
        if (!op.new_json) throw new Error('No new_json available to redo insert')
        await restoreEntity(tx, table, JSON.parse(op.new_json) as Record<string, unknown>)
      } else if (op.op_type === 'delete') {
        await deleteEntity(tx, table, op.entity_id)
      } else if (op.op_type === 'update') {
        if (!op.new_json) throw new Error('No new_json available to redo update')
        const newData = JSON.parse(op.new_json) as Record<string, unknown>
        if (table === 'recipes' || (table === 'meals' && 'meal' in newData)) {
          await deleteEntity(tx, table, op.entity_id)
          await restoreEntity(tx, table, newData)
        } else {
          const rowToApply = (newData['meal'] ?? newData) as Record<string, unknown>
          await updateRow(tx, table, op.entity_id, rowToApply)
        }
      }

      await tx.run('UPDATE operations SET undone_at = NULL WHERE id = ?', [op.id])
      const updated = await getOperation(tx, op.id)
      return { success: true, operation: updated ?? op }
    })
  } catch (error) {
    return { success: false, reason: 'error', error: error instanceof Error ? error.message : String(error), operation: op }
  }
}

export interface BatchChange {
  entityType: string; entityId: number; opType: OperationType
  prev: Record<string, unknown> | null; next: Record<string, unknown> | null
}
function dayIdToDate(id: number): string {
  const value = String(id)
  if (!/^\d{8}$/.test(value)) throw new Error('Invalid day operation identity')
  return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`
}
async function replayBatch(db: DbAdapter, json: string | null, undo: boolean): Promise<void> {
  if (!json || !isValidOperationPayload('batch', json)) throw new Error('Invalid batch operation')
  const { changes } = JSON.parse(json) as { changes: BatchChange[] }
  for (const c of undo ? [...changes].reverse() : changes) {
    const table = normalizeOperationEntityType(c.entityType)!
    const remove = undo ? c.opType === 'insert' : c.opType === 'delete'
    const restore = undo ? c.opType === 'delete' : c.opType === 'insert'
    const data = undo ? c.prev : c.next
    if (remove) await deleteEntity(db, table, c.entityId)
    else if (!data) throw new Error('Missing batch snapshot')
    else if (restore) await restoreEntity(db, table, data)
    else await updateRow(db, table, c.entityId, data)
  }
}

/**
 * Retention and compaction: Retain for 30 days or up to 1000 operations, whichever is smaller.
 */
export async function compactOperations(
  db: DbAdapter,
  options?: CompactOptions,
): Promise<{ deletedCount: number }> {
  const now = options?.now ?? Date.now()
  const maxAgeMs = options?.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000
  const maxCount = options?.maxCount ?? 1000
  const cutoff = now - maxAgeMs

  // Prune rows that either exceed the max count limit or are older than the 30-day cutoff
  const res = await db.run(
    `DELETE FROM operations
     WHERE id NOT IN (
       SELECT id FROM operations
       ORDER BY created_at DESC, id DESC
       LIMIT ?
     ) OR created_at < ?`,
    [maxCount, cutoff],
  )

  return { deletedCount: res.changes }
}
