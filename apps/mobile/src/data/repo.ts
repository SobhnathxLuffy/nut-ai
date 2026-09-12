import {
  migrate,
  getDayStatus as getDayStatusDb,
  setDayStatus as setDayStatusDb,
  listDayStatuses as listDayStatusesDb,
  recordOperation,
  undoOperation,
  redoOperation,
  getOperationByIdempotencyKey,
  listOperations,
  compactOperations,
  createSyncMetadata,
  type DbAdapter,
  type DayStatusRecord,
  type SetDayStatusInput,
  type OperationRecord,
  type OperationActor,
  type UndoResult,
  type RedoResult,
} from '@nutai/db-adapter'
import {
  type Goal,
  type MacroTargets,
  type WeightPoint,
} from '@nutai/goals'
import Storage from 'expo-sqlite/kv-store'
import { seedExercises } from '@nutai/training'
import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'
import { EXPORT_TABLES, WIPE_ONLY_TABLES } from './backup-core'
import { localDate, slotFor } from './date-utils'
import { clearCredential } from '../inference/credentials'
import { openUserDb } from '../db/expo-adapter'

export { localDate, slotFor }

/**
 * The read/write layer over `user.db`.
 *
 * Every screen goes through here rather than holding its own SQL, so the
 * invariants live in one place: goals are append-only, day totals are always
 * derived from log_items rather than stored, and the adaptive loop can never run
 * on days it should not admit.
 */

let cached: DbAdapter | null = null
let opening: Promise<DbAdapter> | null = null

export async function db(): Promise<DbAdapter> {
  if (cached) return cached
  if (!opening) opening = (async () => {
    const handle = await openUserDb()
    await migrate(handle, Date.now())
    await seedExercises(handle)
    cached = handle
    return handle
  })().catch(error => { opening = null; throw error })
  return opening
}


/**
 * Wipe every local trace and send the app back to the first onboarding screen.
 *
 * Deletes user data, drops the stored API credentials out of the Keychain, and
 * clears the completion flag. The bundled nutrition corpus is left alone — it is
 * a read-only build artifact, not user data, and re-importing 4.7 MB to prove a
 * point would just make this slow.
 */
export async function resetEverything(): Promise<void> {
  const h = await db()
  // ONE source of truth for "what counts as user data": the backup lists.
  // Children before parents, so foreign keys never block the wipe.
  const tables: string[] = [...([...EXPORT_TABLES] as string[]).reverse(), ...WIPE_ONLY_TABLES]
  await h.transaction(async (tx) => {
    for (const t of tables) {
      // A missing table is not an error here — an interrupted migration should
      // still be resettable, which is exactly when someone reaches for this.
      try {
        await tx.run(`DELETE FROM ${t}`)
      } catch {
        /* table absent */
      }
    }
  })

  for (const p of ['anthropic', 'openai', 'google'] as const) {
    await clearCredential(p)
  }

  await Storage.removeItem(ONBOARDING_DONE_KEY)
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface CurrentGoal {
  goalType: Goal
  targetKcal: number
  targetRawKcal: number
  floorApplied: boolean
  protein_g: number
  fat_g: number
  carbs_g: number
  bmr: number
  tdee: number
  adaptive: boolean
  effectiveFrom: number
}

/**
 * The goal in force right now.
 *
 * `goals` is append-only, so "current" means the newest row — and a historical
 * day can still be read against whichever row was in force that day. Recomputing
 * March against August's target would silently rewrite whether someone hit their
 * goal three months ago.
 */
export async function currentGoal(): Promise<CurrentGoal | null> {
  const h = await db()
  const row = await h.get<{
    goal_type: string
    target_kcal: number
    target_raw_kcal: number
    floor_applied: number
    protein_g: number
    fat_g: number
    carbs_g: number
    bmr: number
    tdee: number
    adaptive: number
    effective_from: number
  }>('SELECT * FROM goals ORDER BY effective_from DESC, id DESC LIMIT 1')

  if (!row) return null
  return {
    goalType: row.goal_type as Goal,
    targetKcal: row.target_kcal,
    targetRawKcal: row.target_raw_kcal,
    floorApplied: row.floor_applied === 1,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    carbs_g: row.carbs_g,
    bmr: row.bmr,
    tdee: row.tdee,
    adaptive: row.adaptive === 1,
    effectiveFrom: row.effective_from,
  }
}

export async function setting(key: string, fallback = ''): Promise<string> {
  const h = await db()
  const row = await h.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  return row?.value ?? fallback
}

export async function putSetting(key: string, value: string): Promise<void> {
  const h = await db()
  await h.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
}

/** Manual target override from the plan screen's pencil icons. */
export async function overrideTargets(
  next: { targetKcal: number; macros: MacroTargets },
  base: CurrentGoal,
  now: number,
): Promise<void> {
  const h = await db()
  const sync = createSyncMetadata(now)
  await h.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive,
        uuid, created_at, updated_at, revision, deleted_at, sync_state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        now, base.goalType, null, next.targetKcal, next.targetKcal, 0,
        next.macros.protein_g, next.macros.fat_g, next.macros.carbs_g,
        base.bmr, base.tdee, 0, sync.uuid, sync.created_at, sync.updated_at,
        sync.revision, sync.deleted_at, sync.sync_state,
      ],
    )
    const goalId = Number(inserted.lastInsertRowId)
    const goal = await tx.get<Record<string, unknown>>('SELECT * FROM goals WHERE id = ?', [goalId])
    await recordOperation(tx, {
      entityType: 'goals', entityId: goalId, opType: 'insert', newJson: goal,
      actor: 'user', createdAt: now,
    })
  })
}

// ---------------------------------------------------------------------------
// Day totals
// ---------------------------------------------------------------------------

export interface DayTotals {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  mealCount: number
  distinctSlots: number
  pendingCount: number
}

/**
 * Derived from log_items on every read, never stored.
 *
 * `day_summaries` exists as a cache for the widget, but it is droppable and
 * rebuildable — this query is the source of truth.
 */
export async function dayTotals(date: string): Promise<DayTotals> {
  const h = await db()

  const row = await h.get<{
    kcal: number | null
    p: number | null
    f: number | null
    c: number | null
    meals: number | null
    slots: number | null
  }>(
    `SELECT
       SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal,
       SUM(li.snap_protein_g   * li.grams / 100.0 * m.portion_eaten_fraction) AS p,
       SUM(li.snap_fat_g       * li.grams / 100.0 * m.portion_eaten_fraction) AS f,
       SUM(li.snap_carb_g      * li.grams / 100.0 * m.portion_eaten_fraction) AS c,
       COUNT(DISTINCT m.id)        AS meals,
       COUNT(DISTINCT m.meal_slot) AS slots
     FROM meals m
     JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.deleted_at IS NULL AND li.deleted_at IS NULL AND m.analysis_status IN ('complete','manual')`,
    [date],
  )

  const pending = await h.get<{ c: number }>(
    `SELECT COUNT(*) c FROM meals
     WHERE local_date = ? AND analysis_status IN ('captured','queued','analyzing')`,
    [date],
  )

  return {
    kcal: row?.kcal ?? 0,
    protein_g: row?.p ?? 0,
    fat_g: row?.f ?? 0,
    carbs_g: row?.c ?? 0,
    mealCount: row?.meals ?? 0,
    distinctSlots: row?.slots ?? 0,
    // Pending scans contribute ZERO calories. A number that silently grows later
    // is worse than a number that is visibly incomplete.
    pendingCount: pending?.c ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

/**
 * Persist a reviewed scan. One transaction: the meal row, every ingredient with
 * its per-100 g snapshot copied in (never re-looked-up live), and the cost
 * ledger entry with REAL token counts. analysis_status lands as 'complete',
 * which is what dayTotals reads — logging is what makes the Today ring move.
 */
export async function logMeal(
  result: import('@nutai/pipeline').ScanResult,
  meta: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  } | null,
  photoUri: string | null,
  now: number,
  options?: {
    actor?: OperationActor | string
    idempotencyKey?: string
  },
): Promise<number> {
  const h = await db()
  const date = localDate(now)
  const mealSync = createSyncMetadata(now)

  return h.transaction(async (tx) => {
    if (options?.idempotencyKey) {
      const existing = await getOperationByIdempotencyKey(tx, options.idempotencyKey)
      if (existing) return existing.entity_id
    }
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                          analysis_status, engine_id, prompt_version, schema_version,
                          clamp_flags_json, created_at, uuid, updated_at, revision,
                          deleted_at, sync_state)
       VALUES (?,?,?,?,?,'complete',?,?,?,?,?,?,?,?,?,?)`,
      [
        now,
        date,
        slotFor(now),
        photoUri,
        result.meal.portionEatenFraction,
        result.meal.engineId,
        result.meal.promptVersion,
        result.meal.schemaVersion,
        JSON.stringify(result.clampFlags ?? []),
        now,
        mealSync.uuid,
        mealSync.updated_at,
        mealSync.revision,
        mealSync.deleted_at,
        mealSync.sync_state,
      ],
    )
    const mealId = Number(meal.lastInsertRowId)

    let sort = 0
    for (const row of result.meal.ingredients) {
      const itemSync = createSyncMetadata(now)
      const foodId = row.sourceFoodId == null ? null : Number(row.sourceFoodId)
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, raw_model_label,
                                display_name, grams, gram_pathway, portion_source,
                                snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
                                snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, band_half_pct,
                                assumptions_json, sort_order, logged_at, uuid,
                                created_at, updated_at, revision, deleted_at, sync_state)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          mealId,
          Number.isFinite(foodId as number) ? foodId : null,
          row.origin === 'web_lookup' ? 'web' : row.sourceFoodId != null ? 'corpus' : 'estimate',
          row.sourceUrl ?? null,
          row.displayName,
          row.grams,
          row.gramPathway,
          row.origin,
          row.nutrientSnapshot.kcal,
          row.nutrientSnapshot.protein_g,
          row.nutrientSnapshot.fat_g,
          row.nutrientSnapshot.carbs_g,
          row.nutrientSnapshot.fiber_g ?? null,
          row.nutrientSnapshot.sugar_g ?? null,
          row.nutrientSnapshot.sodium_mg ?? null,
          row.isEstimate ? 1 : 0,
          row.macrosUserEdited ? 1 : 0,
          row.bandHalfPct,
          JSON.stringify(row.assumptions ?? []),
          sort++,
          now,
          itemSync.uuid,
          itemSync.created_at,
          itemSync.updated_at,
          itemSync.revision,
          itemSync.deleted_at,
          itemSync.sync_state,
        ],
      )
    }

    if (meta) {
      await tx.run(
        `INSERT INTO scan_cost_ledger (meal_id, provider, model, input_tokens, output_tokens,
                                       cost_usd, local_month, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [mealId, meta.provider, meta.model, meta.inputTokens, meta.outputTokens, meta.costUsd, date.slice(0, 7), now],
      )
    }

    const mealRow = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
    const itemRows = await tx.all<Record<string, unknown>>(
      'SELECT * FROM log_items WHERE meal_id = ? ORDER BY id ASC',
      [mealId],
    )
    const ledgerRows = await tx.all<Record<string, unknown>>(
      'SELECT * FROM scan_cost_ledger WHERE meal_id = ? ORDER BY id ASC',
      [mealId],
    )

    await recordOperation(tx, {
      entityType: 'meals',
      entityId: mealId,
      opType: 'insert',
      newJson: { meal: mealRow, items: itemRows, ledger: ledgerRows },
      actor: options?.actor ?? 'user',
      idempotencyKey: options?.idempotencyKey,
      createdAt: now,
    })

    return mealId
  })
}

export async function deleteMeal(
  mealId: number,
  options?: {
    actor?: OperationActor | string
    idempotencyKey?: string
    now?: number
  },
): Promise<OperationRecord | null> {
  const h = await db()
  const now = options?.now ?? Date.now()

  return h.transaction(async (tx) => {
    if (options?.idempotencyKey) {
      const existing = await getOperationByIdempotencyKey(tx, options.idempotencyKey)
      if (existing) return existing
    }
    const mealRow = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
    if (!mealRow) return null
    const itemRows = await tx.all<Record<string, unknown>>(
      'SELECT * FROM log_items WHERE meal_id = ? ORDER BY id ASC', [mealId],
    )
    const ledgerRows = await tx.all<Record<string, unknown>>(
      'SELECT * FROM scan_cost_ledger WHERE meal_id = ? ORDER BY id ASC', [mealId],
    )
    await tx.run('DELETE FROM log_items WHERE meal_id = ?', [mealId])
    await tx.run('DELETE FROM scan_cost_ledger WHERE meal_id = ?', [mealId])
    await tx.run('DELETE FROM meals WHERE id = ?', [mealId])

    return recordOperation(tx, {
      entityType: 'meals',
      entityId: mealId,
      opType: 'delete',
      prevJson: { meal: mealRow, items: itemRows, ledger: ledgerRows },
      actor: options?.actor ?? 'user',
      idempotencyKey: options?.idempotencyKey,
      createdAt: now,
    })

  })
}

export async function updateMealSlot(
  mealId: number,
  slot: string,
  options?: {
    actor?: OperationActor | string
    idempotencyKey?: string
    now?: number
  },
): Promise<boolean> {
  const h = await db()
  const now = options?.now ?? Date.now()
  return h.transaction(async (tx) => {
    if (options?.idempotencyKey && await getOperationByIdempotencyKey(tx, options.idempotencyKey)) {
      return true
    }
    const prevRow = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
    if (!prevRow) return false
    await tx.run(
      `UPDATE meals SET meal_slot = ?, updated_at = ?, revision = revision + 1,
                        sync_state = 'local' WHERE id = ?`,
      [slot, now, mealId],
    )
    const newRow = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])

    await recordOperation(tx, {
      entityType: 'meals',
      entityId: mealId,
      opType: 'update',
      prevJson: prevRow,
      newJson: newRow,
      actor: options?.actor ?? 'user',
      idempotencyKey: options?.idempotencyKey,
      createdAt: now,
    })

    return true
  })
}

export interface DayMealItem {
  id: number
  displayName: string
  grams: number
  energyKcal: number
}

export interface DayMeal {
  id: number
  slot: string | null
  loggedAt: number
  analysisStatus: string
  items: DayMealItem[]
}

export async function mealsForDay(date: string): Promise<DayMeal[]> {
  const h = await db()
  const meals = await h.all<{
    id: number
    meal_slot: string | null
    logged_at: number
    analysis_status: string
  }>(
    'SELECT id, meal_slot, logged_at, analysis_status FROM meals WHERE local_date = ? ORDER BY logged_at ASC, id ASC',
    [date],
  )

  const result: DayMeal[] = []
  for (const m of meals) {
    const items = await h.all<{
      id: number
      display_name: string
      grams: number
      snap_energy_kcal: number | null
    }>(
      'SELECT id, display_name, grams, snap_energy_kcal FROM log_items WHERE meal_id = ? ORDER BY sort_order ASC, id ASC',
      [m.id],
    )
    result.push({
      id: m.id,
      slot: m.meal_slot,
      loggedAt: m.logged_at,
      analysisStatus: m.analysis_status,
      items: items.map((i) => ({
        id: i.id,
        displayName: i.display_name,
        grams: i.grams,
        energyKcal: Math.round((i.snap_energy_kcal ?? 0) * (i.grams / 100)),
      })),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export async function logWeight(
  kg: number,
  now: number,
  options?: {
    actor?: OperationActor | string
    idempotencyKey?: string
  },
): Promise<void> {
  const h = await db()
  const date = localDate(now)

  await h.transaction(async (tx) => {
    if (options?.idempotencyKey && await getOperationByIdempotencyKey(tx, options.idempotencyKey)) return
    const existing = await tx.get<Record<string, unknown>>(
      'SELECT * FROM weight_entries WHERE local_date = ?', [date],
    )
    if (existing) {
      await tx.run(
        `UPDATE weight_entries SET weight_kg = ?, logged_at = ?, updated_at = ?,
                                   revision = revision + 1, sync_state = 'local'
         WHERE local_date = ?`,
        [kg, now, now, date],
      )
    } else {
      const sync = createSyncMetadata(now)
      await tx.run(
        `INSERT INTO weight_entries
           (local_date, weight_kg, logged_at, uuid, created_at, updated_at, revision, deleted_at, sync_state)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [date, kg, now, sync.uuid, sync.created_at, sync.updated_at, sync.revision, sync.deleted_at, sync.sync_state],
      )
    }
    const newRow = await tx.get<Record<string, unknown>>(
      'SELECT * FROM weight_entries WHERE local_date = ?',
      [date],
    )
    const entityId = Number(newRow?.['id'] ?? 0)

    await recordOperation(tx, {
      entityType: 'weight_entries',
      entityId,
      opType: existing ? 'update' : 'insert',
      prevJson: existing ?? null,
      newJson: newRow ?? null,
      actor: options?.actor ?? 'user',
      idempotencyKey: options?.idempotencyKey,
      createdAt: now,
    })
  })
}

export async function weightHistory(): Promise<WeightPoint[]> {
  const h = await db()
  const rows = await h.all<{ local_date: string; weight_kg: number }>(
    'SELECT local_date, weight_kg FROM weight_entries ORDER BY local_date ASC',
  )
  return rows.map((r) => ({
    day: Math.floor(Date.parse(`${r.local_date}T00:00:00Z`) / 86_400_000),
    weightKg: r.weight_kg,
  }))
}

// ---------------------------------------------------------------------------
// The adaptive loop
// ---------------------------------------------------------------------------

export interface AdaptiveOutcome {
  ran: boolean
  reason: string
  previousKcal?: number
  newKcal?: number
  surfaced?: boolean
  explanation?: string
}

/**
 * Run the adaptive-TDEE estimator and, if it moved enough to matter, write a new
 * goals row.
 *
 * Three gates before it is allowed to change anything, each guarding a real
 * failure:
 *
 *   1. ENOUGH WEIGH-INS. A slope from two points is noise wearing a trend's
 *      clothes.
 *   2. ONLY COMPLETE DAYS feed the intake average. Admitting half-logged days
 *      biases intake downward, which inflates observed TDEE, which RAISES the
 *      target — a silent feedback loop that rewards under-logging.
 *   3. A >= 75 kcal MOVE before anything is surfaced. A target that shifts daily
 *      teaches people to ignore it.
 */
export async function runAdaptive(_now: number): Promise<AdaptiveOutcome> {
  return { ran: false, reason: 'Review weekly check-in suggestions in Progress. Targets change only after you accept.' }
}

export async function getDayStatus(targetDate: string): Promise<DayStatusRecord | null> {
  const h = await db()
  return getDayStatusDb(h, targetDate)
}

export async function setDayStatus(input: SetDayStatusInput): Promise<DayStatusRecord> {
  const h = await db()
  return setDayStatusDb(h, input)
}

export async function listDayStatuses(options?: {
  startDate?: string
  endDate?: string
}): Promise<DayStatusRecord[]> {
  const h = await db()
  return listDayStatusesDb(h, options)
}

// ---------------------------------------------------------------------------
// Operations & Undo
// ---------------------------------------------------------------------------

export async function undoLastOperation(now: number = Date.now()): Promise<UndoResult> {
  const h = await db()
  const lastOp = await h.get<{ id: number }>(
    'SELECT id FROM operations WHERE undone_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1',
  )
  if (!lastOp) {
    return { success: false, reason: 'not_found' }
  }
  return undoOperation(h, lastOp.id, now)
}

export async function undoRecordedOperation(
  idOrUuid: number | string,
  now: number = Date.now(),
): Promise<UndoResult> {
  return undoOperation(await db(), idOrUuid, now)
}

export async function logExercise(name: string, kcal: number, now: number = Date.now()): Promise<number> {
  const h = await db()
  const sync = createSyncMetadata(now)
  return h.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO exercise_entries
         (local_date, name, kcal, provenance, external_id, logged_at, uuid, created_at,
          updated_at, revision, deleted_at, sync_state)
       VALUES (?,?,?,'manual',NULL,?,?,?,?,?,?,?)`,
      [localDate(now), name, kcal, now, sync.uuid, sync.created_at, sync.updated_at,
        sync.revision, sync.deleted_at, sync.sync_state],
    )
    const id = Number(inserted.lastInsertRowId)
    const row = await tx.get<Record<string, unknown>>('SELECT * FROM exercise_entries WHERE id = ?', [id])
    await recordOperation(tx, {
      entityType: 'exercise_entries', entityId: id, opType: 'insert', newJson: row,
      actor: 'user', createdAt: now,
    })
    return id
  })
}

export async function redoLastOperation(): Promise<RedoResult> {
  const h = await db()
  const lastUndone = await h.get<{ id: number }>(
    'SELECT id FROM operations WHERE undone_at IS NOT NULL ORDER BY undone_at DESC, id DESC LIMIT 1',
  )
  if (!lastUndone) {
    return { success: false, reason: 'not_found' }
  }
  return redoOperation(h, lastUndone.id)
}

export async function listRecentOperations(limit: number = 20): Promise<OperationRecord[]> {
  const h = await db()
  return listOperations(h, { limit })
}

export async function latestUndoableMealOperation(): Promise<OperationRecord | null> {
  const h = await db()
  const [operation] = await listOperations(h, {
    entityType: 'meals',
    limit: 1,
    includeUndone: false,
  })
  return operation ?? null
}

export async function compactHistory(options?: {
  maxAgeMs?: number
  maxCount?: number
  now?: number
}): Promise<{ deletedCount: number }> {
  const h = await db()
  return compactOperations(h, options)
}
