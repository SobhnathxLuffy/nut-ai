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
import { ONBOARDING_DRAFT_KEY } from '../onboarding/draft'
import { TUTORIAL_SEEN_KEY } from '../tutorial/key'
import { EXPORT_TABLES, WIPE_ONLY_TABLES } from './backup-core'
import { parseCheckinAcceptedAt } from './home-instrument'
import { localDate, slotFor } from './date-utils'
import { emitFoodMutation, getLastDeletedMealUndoUuid, setLastDeletedMealUndoUuid } from './food-mutations'
import { clearCredential } from '../inference/credentials'
import { openUserDb } from '../db/expo-adapter'
import { serializeMealHonesty } from './meal-honesty'
import { PROVIDER_IDS } from '@nutai/prompt'

export { localDate, slotFor, getLastDeletedMealUndoUuid, setLastDeletedMealUndoUuid }

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
    // P2-33 (QA Wave 4): compaction used to be dead code — the operations
    // table (with full meal snapshots) grew unbounded for the install's
    // lifetime. It runs once per open, off the critical path, and NEVER
    // blocks or fails boot: worst case the journal keeps growing until the
    // next launch.
    void compactOperations(handle, { maxCount: 500, maxAgeMs: 90 * 86_400_000 }).catch(() => {})
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

  for (const p of PROVIDER_IDS) {
    await clearCredential(p)
  }

  await Storage.removeItem(ONBOARDING_DONE_KEY)
  // A reset is a FRESH START, so two more kv keys must go with the done flag:
  // the onboarding draft (a leftover draft would resume PRE-reset answers —
  // the resume path only honors a draft while onboarding is unfinished, and
  // reset just un-finished it) and the walkthrough's seen marker (a
  // re-completed onboarding may offer the tutorial again).
  await Storage.removeItem(ONBOARDING_DRAFT_KEY)
  await Storage.removeItem(TUTORIAL_SEEN_KEY)

  // Task 3-c (widget): after a wipe the home-screen widget must show an
  // empty/reset state — never the pre-reset numbers. The sentinel snapshot
  // (everything null, todayStatus 'reset', stale:true) is defined in
  // src/widgets/publish.ts. Dynamic import keeps repo.ts's module graph free
  // of expo/react-native for the plain-Node tests, and the try/catch keeps
  // the reset itself unbreakable — the widget is cosmetic.
  try {
    const { publishResetSnapshot } = await import('../widgets/publish')
    publishResetSnapshot()
  } catch {
    /* widget publish is best-effort */
  }
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
  /**
   * When the CURRENT goal row was written by an ACCEPTED weekly check-in
   * (`accepted_at` inside adaptive_evidence_json), in ms — null for every
   * other writer (onboarding, hand override, backup import). Home's
   * adaptive-target state machine (§8.2) derives its "locked" state from
   * this; no other reader depends on it yet.
   */
  checkinAcceptedAt?: number | null
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
    adaptive_evidence_json?: string | null
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
    checkinAcceptedAt: parseCheckinAcceptedAt(row.adaptive_evidence_json),
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

/**
 * The optional custom OpenAI-compatible base URL (AI resellers like
 * aicredits.in). Null when unset — every caller then uses the official
 * endpoint. The pure URL rewriting lives in inference/base-url.ts.
 */
export async function customProviderBaseUrl(): Promise<string | null> {
  const raw = await setting('provider_base_url')
  const trimmed = (raw ?? '').trim()
  return trimmed ? trimmed : null
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

  // T5-fix2 (review SHOULD-FIX #2): a goal edit changes exactly what the Today
  // widget renders (kcal remaining + protein vs target), but it emits NO food
  // mutation — the widget kept the OLD target until the next food write or app
  // restart. Debounced schedule (~2s trailing, never an immediate publish)
  // after the transaction COMMITS, mirroring resetEverything's dynamic-import
  // seam: repo.ts's module graph stays free of expo/react-native for the
  // plain-Node tests, and the try/catch keeps the goal write unbreakable —
  // the widget is cosmetic.
  try {
    const { scheduleWidgetPublish } = await import('../widgets/publish')
    scheduleWidgetPublish()
  } catch {
    /* widget publish is best-effort */
  }
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

/**
 * kcal actually logged per meal slot for one day (UI/UX report §8.2 — the
 * hero ring's press-for-detail expansion). The SAME arithmetic and WHERE
 * clause as dayTotals — only the GROUP BY differs — so the slot rows always
 * add up to exactly the number the ring shows. Meals with a NULL slot are
 * returned under the `'unslotted'` key (real data; the caller surfaces it
 * honestly instead of silently folding it into a slot).
 */
export async function slotKcalForDay(date: string): Promise<Record<string, number>> {
  const h = await db()
  const rows = await h.all<{ slot: string | null; kcal: number | null }>(
    `SELECT m.meal_slot AS slot,
            SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal
     FROM meals m
     JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.deleted_at IS NULL AND li.deleted_at IS NULL
       AND m.analysis_status IN ('complete','manual')
     GROUP BY m.meal_slot`,
    [date],
  )
  const bySlot: Record<string, number> = {}
  for (const r of rows) bySlot[r.slot ?? 'unslotted'] = r.kcal ?? 0
  return bySlot
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
    /** P2-9: null = a custom model whose catalogue price is unknown. */
    costUsd: number | null
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
  // Task 5-5 (O6, honesty-contract follow-up): the meal-level honesty snapshot
  // serialized AT LOG TIME — post-review, so it is the state the user actually
  // accepted (the scan store keeps mealBand current through every edit via
  // recomputeAfterEdit). Downstream: logged-meals.ts parses it back and
  // meal-detail renders it; the eval harness can finally attribute error to a
  // pathway from history instead of losing the telemetry at unmount.
  const honestyJson = serializeMealHonesty(result)

  return h.transaction(async (tx) => {
    if (options?.idempotencyKey) {
      const existing = await getOperationByIdempotencyKey(tx, options.idempotencyKey)
      if (existing) return existing.entity_id
    }
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                          analysis_status, engine_id, prompt_version, schema_version,
                          clamp_flags_json, honesty_json, created_at, uuid, updated_at, revision,
                          deleted_at, sync_state)
       VALUES (?,?,?,?,?,'complete',?,?,?,?,?,?,?,?,?,?,?)`,
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
        honestyJson,
        now,
        mealSync.uuid,
        mealSync.updated_at,
        mealSync.revision,
        mealSync.deleted_at,
        mealSync.sync_state,
      ],
    )
    const mealId = Number(meal.lastInsertRowId)

    // Task 5-5 (O6, honesty-contract follow-up): the schema v1.3 per-row
    // quality fields — visibility, portionRange, qualitativeAmount,
    // preparation — are carried on the IngredientRow and shown on the result
    // screen, and since v12 they persist here too, so a logged meal keeps the
    // model's own honesty disclosures in history. Rows whose pathway predates
    // the block (barcode, label, receipt, manual) carry undefined/NULL — no
    // claim is not a claim of 'visible'. A CROSSING range (min > max) is
    // dropped to NULL here exactly as the pipeline nulls it, never stored as
    // nonsense.
    let sort = 0
    for (const row of result.meal.ingredients) {
      const itemSync = createSyncMetadata(now)
      const foodId = row.sourceFoodId == null ? null : Number(row.sourceFoodId)
      const range =
        row.portionRange && row.portionRange.minG <= row.portionRange.maxG ? row.portionRange : null
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, raw_model_label,
                                display_name, grams, gram_pathway, portion_source,
                                snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
                                snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, band_half_pct,
                                assumptions_json, sort_order, logged_at, uuid,
                                created_at, updated_at, revision, deleted_at, sync_state,
                                visibility, qualitative_amount, portion_min_g, portion_max_g,
                                preparation_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          row.visibility ?? null,
          row.qualitativeAmount ?? null,
          range ? range.minG : null,
          range ? range.maxG : null,
          row.preparation ? JSON.stringify(row.preparation) : null,
        ],
      )
    }

    if (meta) {
      await tx.run(
        `INSERT INTO scan_cost_ledger (meal_id, provider, model, input_tokens, output_tokens,
                                       cost_usd, local_month, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        // P2-9: the column is NOT NULL, so an unknown catalogue price stores 0 —
        // but the honest 'cost unknown' flag lives at the app layer (ScanMeta
        // and computeScanCost return null) and is rendered on the result
        // screen. The row keeps the exact custom model id and real token
        // counts, so spend stays reconstructable.
        [mealId, meta.provider, meta.model, meta.inputTokens, meta.outputTokens, meta.costUsd ?? 0, date.slice(0, 7), now],
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

// ---------------------------------------------------------------------------
// Optimistic scan log (Cal AI pattern #1) — the shutter writes the meal row
// FIRST, as 'captured', and the orchestrator upgrades the SAME row in place:
// queued/analyzing → complete (or failed, photo retained). The dayTotals
// pendingCount reader and the timeline's pending copy already existed; this is
// the writer they were waiting for. No new columns, no migration: the schema
// default (analysis_status='captured') was designed for exactly this.
// ---------------------------------------------------------------------------

/**
 * Insert the pending meal row at shutter time. Zero log_items: the timeline
 * renders 'Analysis pending' for itemless meals and dayTotals counts the row
 * as pending contributing zero kcal — the honest "logged but not yet known".
 * Nothing here can fail the meal: no key, no network, no model. The
 * food-mutation event makes the pending card appear on Home/Food in the SAME
 * tap that dismissed the camera — the optimistic flow's visible half.
 */
export async function createPendingMeal(photoUri: string | null, now: number): Promise<number> {
  const h = await db()
  const sync = createSyncMetadata(now)
  const mealId = await h.transaction(async (tx) => {
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                          analysis_status, created_at, uuid, updated_at, revision, deleted_at, sync_state)
       VALUES (?,?,?,?,1.0,'captured',?,?,?,?,?,?)`,
      [now, localDate(now), slotFor(now), photoUri, now, sync.uuid, sync.updated_at, sync.revision, sync.deleted_at, sync.sync_state],
    )
    return Number(meal.lastInsertRowId)
  })
  emitFoodMutation({ kind: 'meal' })
  return mealId
}

/**
 * Advance a pending row's stored stage ('queued' = the model call is running,
 * 'analyzing' = the deterministic pipeline is matching). The pending card's
 * staged copy derives from THIS column — a stored field, never a timer — and
 * each transition emits the food-mutation event that re-renders the card's
 * copy (event-driven, no polling). Guarded to pending rows only, so a
 * cancelled meal can never be revived.
 */
export async function markPendingMealStage(mealId: number, status: 'queued' | 'analyzing'): Promise<void> {
  const h = await db()
  const res = await h.run(
    `UPDATE meals SET analysis_status = ?, updated_at = ?, revision = revision + 1, sync_state = 'local'
     WHERE id = ? AND deleted_at IS NULL AND analysis_status IN ('captured','queued','analyzing')`,
    [status, Date.now(), mealId],
  )
  if (res.changes > 0) emitFoodMutation({ kind: 'meal' })
}

/**
 * Analysis failed. The row (and its photo) STAYS, marked 'failed' — the card
 * renders "Couldn't analyse — tap to fix" with retry / log-manually / delete.
 * 'failed' is deliberately outside dayTotals' pending set: a meal we could not
 * analyse counts as neither eaten nor silently growing.
 */
export async function failPendingMeal(mealId: number): Promise<void> {
  const h = await db()
  await h.run(
    `UPDATE meals SET analysis_status = 'failed', updated_at = ?, revision = revision + 1, sync_state = 'local'
     WHERE id = ? AND deleted_at IS NULL AND analysis_status IN ('captured','queued','analyzing')`,
    [Date.now(), mealId],
  )
  emitFoodMutation({ kind: 'meal' })
}

/**
 * Re-arm a FAILED row for another analysis attempt (the card's Retry). Only a
 * failed row may be re-queued — a completed meal never re-enters the pipeline
 * through this door — and the caller re-fires startScan(uri, { mealId }) with
 * the photo uri this row retained.
 */
export async function retryPendingMeal(mealId: number): Promise<string | null> {
  const h = await db()
  const row = await h.get<{ photo_uri: string | null }>(
    `SELECT photo_uri FROM meals WHERE id = ? AND deleted_at IS NULL AND analysis_status = 'failed'`,
    [mealId],
  )
  if (!row) return null
  await h.run(
    `UPDATE meals SET analysis_status = 'captured', updated_at = ?, revision = revision + 1, sync_state = 'local'
     WHERE id = ?`,
    [Date.now(), mealId],
  )
  emitFoodMutation({ kind: 'meal' })
  return row.photo_uri
}

/**
 * Upgrade a pending row to a complete meal IN PLACE — the same transaction
 * shape logMeal uses (meal row + per-100 g item snapshots + cost ledger), but
 * UPDATE-ing the row the shutter created instead of inserting a second one.
 *
 * The single recorded operation is an INSERT whose snapshot is the completed
 * state, so undo removes the whole scan and redo restores it — the pending
 * stage is never resurrected as a zombie row. If the user deleted the row
 * while analysis ran ("Log manually instead"), this returns false and the
 * result is dropped: a cancelled scan is never resurrected by a late answer.
 */
export async function completePendingMeal(
  mealId: number,
  result: import('@nutai/pipeline').ScanResult,
  meta: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number | null
  } | null,
  now: number,
): Promise<boolean> {
  const h = await db()
  const date = localDate(now)
  const honestyJson = serializeMealHonesty(result)

  const completed = await h.transaction(async (tx) => {
    const pending = await tx.get<Record<string, unknown>>(
      `SELECT id FROM meals
       WHERE id = ? AND deleted_at IS NULL AND analysis_status IN ('captured','queued','analyzing')`,
      [mealId],
    )
    if (!pending) return false

    // USER EDITS WIN (owner mandate): if items were somehow attached to the
    // pending row while analysis was in flight (deep-linked meal-detail edit),
    // the model's items must not clobber them — the meal still completes, but
    // the user's rows stand and the model's are dropped.
    const preexisting = await tx.get<{ c: number }>(
      'SELECT COUNT(*) c FROM log_items WHERE meal_id = ? AND deleted_at IS NULL',
      [mealId],
    )
    const keepUserItems = (preexisting?.c ?? 0) > 0
    if (keepUserItems) console.warn(`[scan] meal ${mealId} gained user items while analysing — keeping them, dropping model items`)

    await tx.run(
      `UPDATE meals SET portion_eaten_fraction = ?, analysis_status = 'complete', engine_id = ?,
                         prompt_version = ?, schema_version = ?, clamp_flags_json = ?, honesty_json = ?,
                         updated_at = ?, revision = revision + 1, sync_state = 'local'
       WHERE id = ?`,
      [
        result.meal.portionEatenFraction,
        result.meal.engineId,
        result.meal.promptVersion,
        result.meal.schemaVersion,
        JSON.stringify(result.clampFlags ?? []),
        honestyJson,
        now,
        mealId,
      ],
    )

    let sort = 0
    for (const row of keepUserItems ? [] : result.meal.ingredients) {
      const itemSync = createSyncMetadata(now)
      const foodId = row.sourceFoodId == null ? null : Number(row.sourceFoodId)
      const range =
        row.portionRange && row.portionRange.minG <= row.portionRange.maxG ? row.portionRange : null
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, raw_model_label,
                                display_name, grams, gram_pathway, portion_source,
                                snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
                                snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, band_half_pct,
                                assumptions_json, sort_order, logged_at, uuid,
                                created_at, updated_at, revision, deleted_at, sync_state,
                                visibility, qualitative_amount, portion_min_g, portion_max_g,
                                preparation_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          row.visibility ?? null,
          row.qualitativeAmount ?? null,
          range ? range.minG : null,
          range ? range.maxG : null,
          row.preparation ? JSON.stringify(row.preparation) : null,
        ],
      )
    }

    if (meta) {
      await tx.run(
        `INSERT INTO scan_cost_ledger (meal_id, provider, model, input_tokens, output_tokens,
                                       cost_usd, local_month, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [mealId, meta.provider, meta.model, meta.inputTokens, meta.outputTokens, meta.costUsd ?? 0, date.slice(0, 7), now],
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
      actor: 'user',
      createdAt: now,
    })
    return true
  })

  if (completed) emitFoodMutation({ kind: 'meal' })
  return completed
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

  const operation = await h.transaction(async (tx) => {
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
  if (operation) {
    setLastDeletedMealUndoUuid(operation.uuid)
    emitFoodMutation({ kind: 'meal', operationUuid: operation.uuid })
  }
  return operation
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
  if (meals.length === 0) return []

  // P2-34 (QA Wave 4): this used to run ONE log_items query PER meal — the
  // hottest screen paid N+1 latency on every focus. One IN-query grouped in
  // JS is equivalent: sort_order ASC, id ASC within each meal.
  const placeholders = meals.map(() => '?').join(', ')
  const itemRows = await h.all<{
    meal_id: number
    id: number
    display_name: string
    grams: number
    snap_energy_kcal: number | null
    sort_order: number
  }>(
    `SELECT meal_id, id, display_name, grams, snap_energy_kcal, sort_order
     FROM log_items WHERE meal_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`,
    meals.map((m) => m.id),
  )
  const byMeal = new Map<number, typeof itemRows>()
  for (const row of itemRows) {
    const list = byMeal.get(row.meal_id)
    if (list) list.push(row)
    else byMeal.set(row.meal_id, [row])
  }

  return meals.map((m) => ({
    id: m.id,
    slot: m.meal_slot,
    loggedAt: m.logged_at,
    analysisStatus: m.analysis_status,
    items: (byMeal.get(m.id) ?? []).map((i) => ({
      id: i.id,
      displayName: i.display_name,
      grams: i.grams,
      energyKcal: Math.round((i.snap_energy_kcal ?? 0) * (i.grams / 100)),
    })),
  }))
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

function emitMutationForOperation(op?: OperationRecord) {
  if (!op) return
  const type = op.entity_type
  if (type === 'meals' || type === 'batch' || type === 'saved_meals') {
    emitFoodMutation({ kind: 'meal', operationUuid: op.uuid })
    emitFoodMutation({ kind: 'shortcut', operationUuid: op.uuid })
  } else if (type === 'user_foods') {
    emitFoodMutation({ kind: 'custom-food', operationUuid: op.uuid })
    emitFoodMutation({ kind: 'meal', operationUuid: op.uuid })
  } else if (type === 'recipes') {
    emitFoodMutation({ kind: 'recipe', operationUuid: op.uuid })
    emitFoodMutation({ kind: 'meal', operationUuid: op.uuid })
  } else if (type === 'logging_shortcuts') {
    emitFoodMutation({ kind: 'shortcut', operationUuid: op.uuid })
  }
}

export async function undoLastOperation(now: number = Date.now()): Promise<UndoResult> {
  const h = await db()
  const lastOp = await h.get<{ id: number }>(
    'SELECT id FROM operations WHERE undone_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1',
  )
  if (!lastOp) {
    return { success: false, reason: 'not_found' }
  }
  const result = await undoOperation(h, lastOp.id, now)
  if (result.success) {
    emitMutationForOperation(result.operation)
    if (result.operation && result.operation.uuid === getLastDeletedMealUndoUuid()) {
      setLastDeletedMealUndoUuid(null)
    }
  }
  return result
}

export async function undoRecordedOperation(
  idOrUuid: number | string,
  now: number = Date.now(),
): Promise<UndoResult> {
  const result = await undoOperation(await db(), idOrUuid, now)
  if (result.success) {
    emitMutationForOperation(result.operation)
    if (result.operation && result.operation.uuid === getLastDeletedMealUndoUuid()) {
      setLastDeletedMealUndoUuid(null)
    }
  }
  return result
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
  const result = await redoOperation(h, lastUndone.id)
  if (result.success) emitMutationForOperation(result.operation)
  return result
}

export async function redoRecordedOperation(
  idOrUuid: number | string,
): Promise<RedoResult> {
  const result = await redoOperation(await db(), idOrUuid)
  if (result.success) emitMutationForOperation(result.operation)
  return result
}

// ---------------------------------------------------------------------------
// Workout-scoped undo/redo (Task 12-b M1)
// ---------------------------------------------------------------------------

/** The entity types whose operations are WORKOUT edits. Mirrors the scoping
 * idea of packages/training's WORKOUT_WRITE_TABLES registry. Deliberately
 * absent: 'exercise_entries' (the food diary's manual exercise log, a
 * different feature) and everything food-side ('meals', 'log_items', ...). */
const WORKOUT_ENTITY_TYPES = new Set(['workouts', 'workout_exercises', 'workout_sets'])

/**
 * M1 discriminator. Every workout UI mutation is ONE batch operation recorded
 * by packages/training's mutate(): its new_json is `{ changes: [...] }` where
 * each change names the table it touched, and only training's writeRow can
 * write the workout tables. Food paths record their own batches (favorite
 * shortcuts, repeat-meal copies) whose changes only ever touch
 * meals/log_items/logging_shortcuts, and no marker field exists on the
 * operation row — so the table names inside the batch payload are the
 * cleanest correct discriminator (adding a marker would change the training
 * write path). 'batch' is therefore shared, and a batch counts as
 * workout-related iff any of its changes touched a workout table.
 */
function isWorkoutOperation(op: { entity_type: string; new_json: string | null }): boolean {
  if (WORKOUT_ENTITY_TYPES.has(op.entity_type)) return true
  if (op.entity_type !== 'batch' || !op.new_json) return false
  try {
    const changes = (JSON.parse(op.new_json) as { changes?: Array<{ entityType?: unknown }> }).changes
    return Array.isArray(changes) && changes.some((c) => WORKOUT_ENTITY_TYPES.has(String(c?.entityType)))
  } catch {
    return false // a corrupt payload is not recognisably a workout operation
  }
}

/**
 * Newest workout-scope operation id (same orderings as undoLastOperation /
 * redoLastOperation), or null. The SQL arms keep the scan small: direct
 * workout-table types are exact; batch rows prefilter on the substring every
 * workout-table name carries ("workout" — a food batch's payload never has
 * it, bar user-typed text) before the precise payload check rejects any
 * prefilter false positive.
 */
async function newestWorkoutOperationId(
  h: DbAdapter,
  options: { undone: boolean },
): Promise<number | null> {
  const rows = await h.all<{ id: number; entity_type: string; new_json: string | null }>(
    `SELECT id, entity_type, new_json FROM operations
     WHERE undone_at IS ${options.undone ? 'NOT NULL' : 'NULL'}
       AND (entity_type IN ('workouts','workout_exercises','workout_sets')
            OR (entity_type = 'batch' AND new_json LIKE '%workout%'))
     ORDER BY ${options.undone ? 'undone_at DESC, id DESC' : 'created_at DESC, id DESC'}`,
  )
  for (const row of rows) if (isWorkoutOperation(row)) return row.id
  return null
}

/** undoLastOperation scoped to workout operations: a food log newer than the
 * last workout action can no longer be undone by the workout screen's
 * "Undo workout action" (M1). Same result contract, so the caller's existing
 * "Nothing to undo" toast flow is unchanged when no workout op is live. */
export async function undoLastWorkoutOperation(now: number = Date.now()): Promise<UndoResult> {
  const h = await db()
  const id = await newestWorkoutOperationId(h, { undone: false })
  if (id == null) {
    return { success: false, reason: 'not_found' }
  }
  const result = await undoOperation(h, id, now)
  if (result.success) {
    emitMutationForOperation(result.operation)
    if (result.operation && result.operation.uuid === getLastDeletedMealUndoUuid()) {
      setLastDeletedMealUndoUuid(null)
    }
  }
  return result
}

/** redoLastOperation scoped to workout operations (M1 — see undo above). */
export async function redoLastWorkoutOperation(): Promise<RedoResult> {
  const h = await db()
  const id = await newestWorkoutOperationId(h, { undone: true })
  if (id == null) {
    return { success: false, reason: 'not_found' }
  }
  const result = await redoOperation(h, id)
  if (result.success) emitMutationForOperation(result.operation)
  return result
}

export async function listRecentOperations(limit: number = 20): Promise<OperationRecord[]> {
  const h = await db()
  return listOperations(h, { limit })
}


export async function compactHistory(options?: {
  maxAgeMs?: number
  maxCount?: number
  now?: number
}): Promise<{ deletedCount: number }> {
  const h = await db()
  return compactOperations(h, options)
}
