import { createSyncMetadata, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import type { ManualFoodSelection } from './manual-food'
import { emitFoodMutation } from './food-mutations'
import { localDate } from './date-utils'

/**
 * Applying confirmed AIP-004 corrections to ALREADY-LOGGED meals.
 *
 * The parser (packages/prompt/src/correction.ts + runCorrectionIntent) only
 * PROPOSES operations; per AIP-004's implementation contract the AI can never
 * mutate storage directly. This module is the apply step that runs after the
 * user confirms, and every write goes through the operation log as a meal
 * 'update' whose prev_json/new_json carry { meal, items } snapshots — the
 * exact shape packages/db-adapter's undoOperation already knows how to revert
 * and replay (operations.ts: `table === 'meals' && 'meal' in prevData`).
 *
 * Takes the DbAdapter as a parameter (same reasoning as manual-food.ts) so the
 * whole apply path is testable under bare Node against openMemoryDb().
 */

/** Stable cross-reference id for one logged item: `m<mealId>i<itemId>`. */
export interface CorrectionRowRef {
  key: string
  mealId: number
  itemId: number
  displayName: string
  grams: number
  mealSlot: string | null
  kcalEach: number | null
}

interface CorrectionRowRow {
  item_id: number
  meal_id: number
  display_name: string
  grams: number
  snap_energy_kcal: number | null
  meal_slot: string | null
}

/**
 * Every non-deleted item logged on `date`, in meal order — the rows the
 * assistant's correction context block was built from.
 */
export async function loadCorrectionRows(h: DbAdapter, date: string): Promise<CorrectionRowRef[]> {
  const rows = await h.all<CorrectionRowRow>(
    `SELECT li.id AS item_id, li.meal_id, li.display_name, li.grams,
            li.snap_energy_kcal, m.meal_slot
     FROM log_items li JOIN meals m ON m.id = li.meal_id
     WHERE m.local_date = ? AND m.deleted_at IS NULL AND li.deleted_at IS NULL
     ORDER BY m.logged_at ASC, m.id ASC, li.sort_order ASC, li.id ASC`,
    [date],
  )
  return rows.map((r) => ({
    key: `m${r.meal_id}i${r.item_id}`,
    mealId: r.meal_id,
    itemId: r.item_id,
    displayName: r.display_name,
    grams: r.grams,
    mealSlot: r.meal_slot,
    kcalEach: r.snap_energy_kcal == null ? null : Math.round((r.snap_energy_kcal * r.grams) / 100),
  }))
}

export type LoggedCorrectionWrite =
  | { kind: 'remove'; key: string }
  | { kind: 'update'; key: string; grams: number }
  /** A corpus-resolved new item appended to an existing meal. */
  | { kind: 'add'; mealId: number; selection: ManualFoodSelection }

export interface ApplyCorrectionsResult {
  ok: boolean
  /** Meal ids whose contents actually changed (an op recorded per meal). */
  appliedMeals: number[]
  /** Keys the caller asked to change that do not exist in the log. */
  unknownKeys: string[]
  /** Human-readable list of writes that could not be applied, if any. */
  skipped: string[]
}

const TOUCHED_ITEM_UPDATE = `updated_at = ?, revision = revision + 1, sync_state = 'local'`

/**
 * Apply a batch of confirmed writes. All meals are corrected in ONE
 * transaction; each touched meal gets its own operation-log record so undo
 * and redo step through the corrections exactly as the user saw them.
 */
export async function applyLoggedMealCorrections(
  h: DbAdapter,
  writes: LoggedCorrectionWrite[],
  now: number = Date.now(),
): Promise<ApplyCorrectionsResult> {
  const unknownKeys: string[] = []
  const skipped: string[] = []

  // Resolve every key-based write up front; anything unknown never touches a
  // meal. Key resolution happens once so a batch mentioning the same item
  // twice still refers to one row.
  const keyIndex = new Map<string, CorrectionRowRef>()
  const rows = await h.all<CorrectionRowRow>(
    `SELECT li.id AS item_id, li.meal_id, li.display_name, li.grams,
            li.snap_energy_kcal, m.meal_slot
     FROM log_items li JOIN meals m ON m.id = li.meal_id
     WHERE m.local_date = ? AND m.deleted_at IS NULL AND li.deleted_at IS NULL`,
    [localDate(now)],
  )
  for (const r of rows) {
    keyIndex.set(`m${r.meal_id}i${r.item_id}`, {
      key: `m${r.meal_id}i${r.item_id}`,
      mealId: r.meal_id,
      itemId: r.item_id,
      displayName: r.display_name,
      grams: r.grams,
      mealSlot: r.meal_slot,
      kcalEach: r.snap_energy_kcal == null ? null : Math.round((r.snap_energy_kcal * r.grams) / 100),
    })
  }

  interface MealWrites {
    removes: number[]
    updates: Array<{ itemId: number; grams: number }>
    adds: ManualFoodSelection[]
  }
  const byMeal = new Map<number, MealWrites>()

  const bucketFor = (mealId: number): MealWrites => {
    let bucket = byMeal.get(mealId)
    if (!bucket) {
      bucket = { removes: [], updates: [], adds: [] }
      byMeal.set(mealId, bucket)
    }
    return bucket
  }

  for (const w of writes) {
    if (w.kind === 'add') {
      bucketFor(w.mealId).adds.push(w.selection)
      continue
    }
    const ref = keyIndex.get(w.key)
    if (!ref) {
      unknownKeys.push(w.key)
      continue
    }
    if (w.kind === 'remove') {
      bucketFor(ref.mealId).removes.push(ref.itemId)
    } else if (w.kind === 'update') {
      if (!Number.isFinite(w.grams) || w.grams < 0) {
        skipped.push(`${ref.displayName}: invalid amount`)
        continue
      }
      bucketFor(ref.mealId).updates.push({ itemId: ref.itemId, grams: w.grams })
    }
  }

  if (byMeal.size === 0) {
    return { ok: false, appliedMeals: [], unknownKeys, skipped }
  }

  const appliedMeals: number[] = []
  await h.transaction(async (tx) => {
    for (const [mealId, bucket] of byMeal) {
      const prevMeal = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
      if (!prevMeal) {
        skipped.push(`Meal #${mealId} no longer exists`)
        continue
      }
      const prevItems = await tx.all<Record<string, unknown>>(
        'SELECT * FROM log_items WHERE meal_id = ? ORDER BY id ASC', [mealId],
      )

      for (const itemId of bucket.removes) {
        await tx.run(
          `UPDATE log_items SET deleted_at = ?, ${TOUCHED_ITEM_UPDATE} WHERE id = ? AND meal_id = ? AND deleted_at IS NULL`,
          [now, now, itemId, mealId],
        )
      }
      for (const u of bucket.updates) {
        await tx.run(
          `UPDATE log_items SET grams = ?, ${TOUCHED_ITEM_UPDATE} WHERE id = ? AND meal_id = ? AND deleted_at IS NULL`,
          [u.grams, now, u.itemId, mealId],
        )
      }
      for (const selection of bucket.adds) {
        const sync = createSyncMetadata(now)
        const n = selection.nutrientSnapshot
        const sortOrderRow = await tx.get<{ next_sort: number }>(
          'SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_sort FROM log_items WHERE meal_id = ?', [mealId],
        )
        const foodId = selection.foodId
        await tx.run(
          `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                                  gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g,
                                  snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                  is_estimate, macros_user_edited, sort_order, logged_at, uuid,
                                  created_at, updated_at, revision, deleted_at, sync_state)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?)`,
          [
            mealId,
            Number.isFinite(foodId as number) ? foodId : null,
            foodId != null ? 'corpus' : 'estimate',
            selection.displayName,
            selection.grams,
            selection.gramPathway ?? 'fndds_standard_portion',
            selection.portionSource ?? 'db_search',
            n.kcal,
            n.protein_g,
            n.fat_g,
            n.carbs_g,
            n.fiber_g ?? null,
            n.sugar_g ?? null,
            n.sodium_mg ?? null,
            sortOrderRow?.next_sort ?? 0,
            now,
            sync.uuid,
            sync.created_at,
            sync.updated_at,
            sync.revision,
            sync.deleted_at,
            sync.sync_state,
          ],
        )
      }

      const newItems = await tx.all<Record<string, unknown>>(
        'SELECT * FROM log_items WHERE meal_id = ? ORDER BY id ASC', [mealId],
      )
      await tx.run(
        `UPDATE meals SET updated_at = ?, revision = revision + 1, sync_state = 'local' WHERE id = ?`,
        [now, mealId],
      )
      const newMeal = await tx.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])

      await recordOperation(tx, {
        entityType: 'meals',
        entityId: mealId,
        opType: 'update',
        prevJson: { meal: prevMeal, items: prevItems },
        newJson: { meal: newMeal, items: newItems },
        // The operation log only knows user/system/sync/auto. The correction IS
        // user-confirmed — the assistant merely proposed it — so 'user' is the
        // honest actor, and undo treats it exactly like a hand edit.
        actor: 'user',
        createdAt: now,
      })
      appliedMeals.push(mealId)
    }
  })

  if (appliedMeals.length > 0) emitFoodMutation({ kind: 'meal' })
  return { ok: appliedMeals.length > 0, appliedMeals, unknownKeys, skipped }
}
