import { createSyncMetadata, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import type { ManualFoodSelection } from './manual-food'
import { emitFoodMutation } from './food-mutations'
import { localDate, slotFor } from './date-utils'

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
 * Every non-deleted item logged on the given day(s), in meal order — the rows
 * the assistant's correction context block was built from. Multi-day support
 * (T-IMPL-A fix 1): "fix yesterday's breakfast" needs yesterday's rows, so both
 * the context and the apply step read the SAME window. Keys stay globally
 * unique (`m<mealId>i<itemId>`), so one call over [yesterday, today] is
 * equivalent to two single-day calls with no key collisions.
 */
export async function loadCorrectionRows(h: DbAdapter, date: string | string[]): Promise<CorrectionRowRef[]> {
  const dates = Array.isArray(date) ? date : [date]
  if (dates.length === 0) return []
  const placeholders = dates.map(() => '?').join(', ')
  const rows = await h.all<CorrectionRowRow>(
    `SELECT li.id AS item_id, li.meal_id, li.display_name, li.grams,
            li.snap_energy_kcal, m.meal_slot
     FROM log_items li JOIN meals m ON m.id = li.meal_id
     WHERE m.local_date IN (${placeholders}) AND m.deleted_at IS NULL AND li.deleted_at IS NULL
     ORDER BY m.logged_at ASC, m.id ASC, li.sort_order ASC, li.id ASC`,
    dates,
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
 *
 * `dates` is the resolution window for the write keys — the caller MUST pass
 * the same day(s) it built its context rows from (today + yesterday for the
 * assistant), or yesterday's keys would resolve as unknown here.
 */
export async function applyLoggedMealCorrections(
  h: DbAdapter,
  writes: LoggedCorrectionWrite[],
  now: number = Date.now(),
  dates: string[] = [localDate(now)],
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
     WHERE m.local_date IN (${dates.map(() => '?').join(', ')}) AND m.deleted_at IS NULL AND li.deleted_at IS NULL`,
    dates,
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

// ---------------------------------------------------------------------------
// Qualitative sizes (T-IMPL-A fix 4): the correction schema carried
// qualitative_size forever but apply dropped every grams==null op — "make it
// two rotis" could never work. This is the minimal honest mapping: relative
// words scale the row's CURRENT grams; a small vessel/unit prior table maps
// counted sizes ("2 rotis", "1 bowl"); anything unresolvable returns a REASON
// the caller reports as a skip — never a silent drop, never an invented gram.
// ---------------------------------------------------------------------------

/** vessel/unit → grams prior. Deliberately tiny; unlisted units refuse to guess. */
const SIZE_PRIORS: Record<string, number> = {
  bowl: 200, katori: 150, glass: 250, cup: 150, plate: 350, serving: 100,
  spoon: 10, tablespoon: 15, teaspoon: 5, slice: 35, roti: 40, chapati: 40,
  parantha: 60, paratha: 60, idli: 40, dosa: 120, vada: 40, puri: 25, egg: 50,
}

export type QualitativeResolution =
  | { ok: true; grams: number; basis: string }
  | { ok: false; reason: string }

export function resolveQualitativeGrams(
  qualitative: string,
  currentGrams: number | null,
): QualitativeResolution {
  const text = qualitative.toLowerCase().trim()
  if (!text) return { ok: false, reason: 'no amount was given' }

  // Relative sizes scale the row's CURRENT grams — the one baseline both the
  // apply layer already trusts and the user can see on screen.
  if (/\b(half)\b/.test(text) && currentGrams != null && currentGrams > 0)
    return { ok: true, grams: Math.round(currentGrams / 2), basis: 'half of the current amount' }
  if (/\b(quarter)\b/.test(text) && currentGrams != null && currentGrams > 0)
    return { ok: true, grams: Math.round(currentGrams / 4), basis: 'a quarter of the current amount' }
  if (/\b(double|twice)\b/.test(text) && currentGrams != null && currentGrams > 0)
    return { ok: true, grams: Math.round(currentGrams * 2), basis: 'double the current amount' }

  // "N <unit>" / "a <unit>" / "an <unit>" — count × prior when the unit is known.
  const m = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four)\s+([a-z]+?)s?\b/.exec(text)
  if (m) {
    const wordCounts: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }
    const count = /^\d/.test(m[1]) ? Number(m[1]) : wordCounts[m[1]]
    const unit = m[2]
    const prior = SIZE_PRIORS[unit]
    if (count != null && prior != null)
      return { ok: true, grams: Math.round(count * prior), basis: `${m[1]} ${unit} ≈ ${prior} g each` }
    if (count != null)
      return { ok: false, reason: `“${qualitative}” has no grams prior for “${unit}”` }
  }
  return { ok: false, reason: `“${qualitative}” could not be converted to grams` }
}

// ---------------------------------------------------------------------------
// add_item target meal (T-IMPL-A fix 6 / F6): the assistant used to append to
// the chronologically LAST meal of today, so "add a coffee" silently joined
// dinner. Resolve the target from meal words in the request, else the
// clock's slot, else the latest meal. Pure over the day's rows.
// ---------------------------------------------------------------------------

const MEAL_WORDS: Array<[RegExp, string]> = [
  [/\b(breakfast|morning|coffee|tea|chai|poha|oats|cereal)\b/, 'breakfast'],
  [/\b(lunch|afternoon|noon)\b/, 'lunch'],
  [/\b(dinner|supper|evening|night)\b/, 'dinner'],
  [/\b(snack|mid.?meal)\b/, 'snack'],
]

/** The meal slot a correction request names ("with breakfast", "this morning"), or null. */
export function mealSlotFromText(text: string): string | null {
  for (const [pattern, slot] of MEAL_WORDS) if (pattern.test(text.toLowerCase())) return slot
  return null
}

export interface AddTargetMeal {
  id: number
  slot: string | null
}

/**
 * Which of the day's meals an add_item lands in: the newest meal whose slot
 * matches the request's meal words (else the clock's slot), falling back to
 * the newest meal of the day only when the slot has no match. Null = nothing
 * logged that day — the caller says so instead of inventing a meal.
 */
export function resolveAddTargetMeal(
  requestText: string,
  now: number,
  meals: ReadonlyArray<{ id: number; slot: string | null; loggedAt: number }>,
): AddTargetMeal | null {
  if (meals.length === 0) return null
  const latest = [...meals].sort((a, b) => a.loggedAt - b.loggedAt || a.id - b.id).at(-1)!
  const wanted = mealSlotFromText(requestText) ?? slotFor(now)
  const match = meals
    .filter((m) => m.slot === wanted)
    .sort((a, b) => a.loggedAt - b.loggedAt || a.id - b.id)
    .at(-1)
  return match ? { id: match.id, slot: match.slot } : { id: latest.id, slot: latest.slot }
}
