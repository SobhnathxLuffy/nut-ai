import type { DbAdapter } from '@nutai/db-adapter'
import { slotFor, localDate } from './date-utils'
import { mealSnapshot, repeatSnapshots, type MealSnapshot, type RecentFood, type Shortcut } from './shortcuts'

/**
 * One-tap logging — UI/UX report Ch. 8.3 / §7.1 (Wave 3, the Food write
 * surface).
 *
 * The shortcut strip becomes one-tap log cards: each card shows the meal, its
 * last gram preset, and a plus; a repeat log is a SINGLE TAP. The derivation
 * of what a card shows (preset grams, current slot) lives HERE as pure
 * functions so the derivation is testable without React Native, and the write
 * itself stays on the ONE repeat path (`repeatSnapshots`) — immutable meal
 * snapshots, `recordOperation` provenance, Undo. No ad-hoc INSERTs exist in
 * this module; a one-tap log is a repeat log with the slot re-derived.
 */

/** Card provenance — which shortcut strip mode a one-tap card came from. */
export type OneTapSource = 'recent' | 'frequent' | 'favorite'

export interface OneTapCard {
  /** Stable React key. */
  key: string
  /** Meal name as the strip shows it (the shortcut's saved name, or the item's display name). */
  name: string
  /** Total grams the LAST log of this meal carried — the card's gram preset. */
  presetGrams: number
  source: OneTapSource
  /** How many times this meal was logged in the strip's 30-day window (recent/frequent cards). */
  frequency?: number
  /**
   * Meal id to snapshot at write time (recent/frequent cards). Null when the
   * card carries its own snapshot (shortcut cards — their provenance is the
   * saved snapshot, byte-identical on every repeat).
   */
  mealId: number | null
  /** The saved snapshot for shortcut cards; null for recent/frequent cards. */
  snapshot: MealSnapshot | null
}

/**
 * The gram preset a one-tap card shows: the sum of the immutable snapshot's
 * item grams (the exact mass the repeat would write). Null grams count as 0
 * rather than NaN-ing the card.
 */
export function presetGramsFromSnapshot(snapshot: MealSnapshot): number {
  let total = 0
  for (const item of snapshot.items) {
    const grams = Number(item['grams'])
    if (Number.isFinite(grams) && grams > 0) total += grams
  }
  return total
}

/**
 * Re-target a copied meal at the CURRENT slot — the same deterministic rule
 * `logMeal` applies (`slotFor(now)`), so a breakfast meal repeated at 13:00
 * lands in lunch instead of silently keeping the original slot. The snapshot
 * is still copied verbatim otherwise (immutable provenance preserved).
 */
export function snapshotForCurrentSlot(snapshot: MealSnapshot, now: number): MealSnapshot {
  return { ...snapshot, meal: { ...snapshot.meal, meal_slot: slotFor(now) } }
}

/** Parse a shortcut row into a one-tap card. Corrupt JSON degrades to null — never a crash card. */
export function oneTapCardFromShortcut(shortcut: Shortcut): OneTapCard | null {
  let snapshot: MealSnapshot
  try {
    snapshot = JSON.parse(shortcut.snapshot_json) as MealSnapshot
  } catch {
    return null
  }
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) return null
  return {
    key: `shortcut-${shortcut.id}`,
    name: shortcut.name,
    presetGrams: presetGramsFromSnapshot(snapshot),
    source: shortcut.kind,
    mealId: null,
    snapshot,
  }
}

/** A recent/frequent food becomes a card that snapshots its latest meal at write time. */
export function oneTapCardFromRecentFood(food: RecentFoodWithGrams, source: 'recent' | 'frequent'): OneTapCard {
  return {
    key: `recent-${food.id}`,
    name: food.name,
    presetGrams: food.grams,
    source,
    mealId: food.id,
    snapshot: null,
    frequency: food.frequency,
  }
}

export interface RecentFoodWithGrams extends RecentFood {
  /** Total grams of the food's most recent meal — the card's preset. */
  grams: number
}

/**
 * `recentFoods` + the gram preset each card needs. The inner query is
 * `recentFoods`' own GROUP BY verbatim; the wrap only attaches the latest
 * meal's total grams (the mass `mealSnapshot(id)` would repeat), so ranking
 * semantics cannot drift between the two readers.
 */
export function recentFoodsWithGrams(db: DbAdapter, now: number): Promise<RecentFoodWithGrams[]> {
  return db.all(
    `SELECT r.id, r.name, r.last_used_at, r.frequency,
       (SELECT COALESCE(SUM(grams), 0) FROM log_items li2
         WHERE li2.meal_id = r.id AND li2.deleted_at IS NULL) AS grams
     FROM (
       SELECT MAX(m.id) id, li.display_name name, MAX(m.logged_at) last_used_at, COUNT(DISTINCT m.id) frequency
       FROM meals m JOIN log_items li ON li.meal_id = m.id
       WHERE m.deleted_at IS NULL AND li.deleted_at IS NULL
         AND m.logged_at BETWEEN ? AND ?
         AND m.analysis_status IN ('complete','manual') AND COALESCE(m.engine_id,'') NOT LIKE 'test%'
       GROUP BY li.matched_food_source, li.matched_food_id, li.display_name
       ORDER BY last_used_at DESC, id DESC LIMIT 50
     ) r`,
    [now - 30 * 86400000, now],
  )
}

/**
 * THE one-tap write. Single tap → the meal is logged for the current slot with
 * the preset grams: this is `repeatSnapshots` (immutable snapshot copy +
 * `recordOperation` provenance + food-mutation emit) with the slot re-derived
 * from time of day exactly like `logMeal`. Returns the new meal id.
 */
export async function oneTapLog(
  db: DbAdapter,
  card: OneTapCard,
  now: number,
  idempotencyKey?: string,
): Promise<number> {
  const snapshot =
    card.snapshot != null ? card.snapshot : await mealSnapshot(db, card.mealId!)
  if (!snapshot.items.length) throw new Error('This meal has no items to log')
  const ids = await repeatSnapshots(
    db,
    [snapshotForCurrentSlot(snapshot, now)],
    localDate(now),
    now,
    idempotencyKey,
  )
  return ids[0]!
}
