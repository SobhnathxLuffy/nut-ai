import type { DbAdapter } from '@nutai/db-adapter'

/**
 * The optimistic scan card reader (Cal AI pattern #1 + #4 — design the wait).
 *
 * A food scan now exists as a meal row from the SHUTTER moment: 'captured' →
 * 'queued' → 'analyzing' → 'complete', or 'failed' with the photo retained.
 * This module is the one reader both pending-card surfaces (Home timeline and
 * the Food tab) share, plus the pure staged-copy mapping — the card's status
 * text derives from the STORED analysis_status column, never a timer.
 */

export const PENDING_SCAN_STATUSES = ['captured', 'queued', 'analyzing'] as const
export type PendingScanStatus = (typeof PENDING_SCAN_STATUSES)[number]

export type ScanCardStatus = PendingScanStatus | 'failed' | 'complete'

export function isPendingScanStatus(status: string): status is PendingScanStatus {
  return (PENDING_SCAN_STATUSES as readonly string[]).includes(status)
}

/**
 * Staged status copy, mapped from the persisted row state (Cal AI pattern #4:
 * never a bare spinner; the worst case is named, not hidden). 'failed' copy is
 * rendered by the card itself — this maps the WAIT.
 */
export function pendingStageCopy(status: string): string {
  switch (status) {
    case 'captured':
      return 'Photo saved — analysis is starting…'
    case 'queued':
      return 'Detecting foods…'
    case 'analyzing':
      return 'Estimating portions and calculating macros…'
    default:
      return 'Analysing…'
  }
}

export interface ScanCardItem {
  itemId: number
  name: string
  grams: number
  kcal: number | null
  isEstimate: boolean
}

export interface ScanCard {
  mealId: number
  slot: string | null
  loggedAt: number
  status: ScanCardStatus
  photoUri: string | null
  items: ScanCardItem[]
}

interface ScanCardRow {
  meal_id: number
  meal_slot: string | null
  logged_at: number
  analysis_status: string
  photo_uri: string | null
  item_id: number | null
  display_name: string | null
  grams: number | null
  snap_energy_kcal: number | null
  is_estimate: number | null
}

/**
 * Every scan-born meal for one day that is NOT an ordinary logged row: the
 * pending stages, the failed rows (photo retained), and today's completed
 * scans (engine_id set — manual/recipe/one-tap logs are analysis_status
 * 'manual' or engine_id NULL and never appear here).
 */
export async function scansForDay(h: DbAdapter, date: string): Promise<ScanCard[]> {
  const rows = await h.all<ScanCardRow>(
    `SELECT m.id AS meal_id, m.meal_slot, m.logged_at, m.analysis_status, m.photo_uri,
            li.id AS item_id, li.display_name, li.grams, li.snap_energy_kcal, li.is_estimate
     FROM meals m
     LEFT JOIN log_items li ON li.meal_id = m.id AND li.deleted_at IS NULL
     WHERE m.local_date = ? AND m.deleted_at IS NULL
       AND (m.analysis_status IN ('captured','queued','analyzing','failed')
            OR (m.analysis_status = 'complete' AND m.engine_id IS NOT NULL))
     ORDER BY m.logged_at ASC, m.id ASC, li.sort_order ASC, li.id ASC`,
    [date],
  )

  const byMeal = new Map<number, ScanCard>()
  for (const r of rows) {
    let card = byMeal.get(r.meal_id)
    if (!card) {
      card = {
        mealId: r.meal_id,
        slot: r.meal_slot,
        loggedAt: r.logged_at,
        status: r.analysis_status as ScanCardStatus,
        photoUri: r.photo_uri,
        items: [],
      }
      byMeal.set(r.meal_id, card)
    }
    if (r.item_id != null) {
      card.items.push({
        itemId: r.item_id,
        name: r.display_name ?? 'Food',
        grams: r.grams ?? 0,
        kcal:
          r.snap_energy_kcal == null || r.grams == null
            ? null
            : Math.round((r.snap_energy_kcal * r.grams) / 100),
        isEstimate: r.is_estimate === 1,
      })
    }
  }
  return [...byMeal.values()]
}

/** Per-item line for the completed card — "Rice · 200 g · 260 kcal", honest '—' when unreported. */
export function scanItemLine(item: ScanCardItem): string {
  const grams = `${Math.round(item.grams)} g`
  const kcal = item.kcal != null ? `${item.kcal} kcal` : 'kcal not reported'
  return `${item.name} · ${grams} · ${kcal}`
}
