/**
 * The day-detail data adapter (AGENTS.md §0.2 item O4 — the dedicated
 * day-detail view the 56-day strip navigates into).
 *
 * Composition, NOT arithmetic: the totals come from repo.dayTotals, the goal
 * from repo.currentGoal, the meal rows from the @nutai/timeline query Home's
 * own DayTimeline renders — every number on the day-detail screen is the same
 * number the Home instrument already shows for that date.
 *
 * `mealKcalForDay` follows the precedent `slotKcalForDay` set in repo.ts: the
 * SAME SUM expression and WHERE clause as dayTotals with only the GROUP BY
 * changed (per meal id instead of per slot), so the row-level kcal always adds
 * up to exactly the day total the ring renders.
 *
 * The pure helpers (parseDayParam / dayTitle / mealRowsFromTimeline) stay free
 * of any DB or React Native import so the vitest suite can pin them under bare
 * Node; `loadDayDetail` is the thin async composition the screen calls.
 */

import { timeline, type TimelineEvent } from '@nutai/timeline'
import {
  getDayStatus,
  listOperations,
  type DayCompletion,
  type OperationRecord,
} from '@nutai/db-adapter'
import { currentGoal, db, dayTotals, type CurrentGoal, type DayTotals } from './repo'
import { isValidLocalDate, localDate } from './date-utils'

// ---------------------------------------------------------------------------
// Pure helpers (Node-testable)
// ---------------------------------------------------------------------------

/**
 * Validate the `?date=` param of /day-detail.
 *
 * A missing/empty param is NOT an error — the `nutai://day` deep link
 * resolves to `/day-detail` with the query stripped, and the honest landing
 * for that tap is today's day view. A malformed or impossible date
 * (`2026-2-3`, `2026-02-30`) returns null and the screen renders its
 * bad-link Empty instead of silently substituting a different day.
 */
export function parseDayParam(param: string | undefined, today: string): string | null {
  if (param === undefined || param.trim() === '') return today
  return isValidLocalDate(param) ? param : null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Noon anchor so a UTC-offset boundary can never shift the calendar day. */
function atNoon(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

/**
 * The friendly screen title for a date: "Today", "Yesterday", or the full
 * deterministic form "Friday, September 27, 2024". Deterministic on purpose —
 * no locale dependency, so the e2e spec can assert it.
 */
export function dayTitle(date: string, today: string): string {
  if (date === today) return 'Today'
  const yesterday = localDate(atNoon(today).getTime() - 86_400_000)
  if (date === yesterday) return 'Yesterday'
  const d = atNoon(date)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export interface DayMealRow {
  /** meals.id — the param meal-detail expects. */
  id: number
  /** Meal slot label ("Breakfast"… or "Meal" when the slot is NULL). */
  label: string
  /** Item display names, comma-joined — the timeline's own detail. */
  detail: string
  /** logged_at in ms. */
  at: number
  /** This meal's kcal, or null when it has no analysed items yet. */
  kcal: number | null
}

/**
 * Meal rows for the day list: the timeline's meal events (already ordered,
 * non-deleted) enriched with the per-meal kcal. An event with no kcal entry
 * keeps `kcal: null` — a pending/unanalysed meal shows "—" rather than a
 * fabricated zero (the same honesty rule dayTotals applies to pendingCount).
 */
export function mealRowsFromTimeline(
  events: readonly TimelineEvent[],
  kcalByMeal: ReadonlyMap<number, number>,
): DayMealRow[] {
  return events
    .filter((e) => e.type === 'meal')
    .map((e) => ({
      id: e.entity_id,
      label: e.label.charAt(0).toUpperCase() + e.label.slice(1),
      detail: e.detail,
      at: e.at,
      kcal: kcalByMeal.get(e.entity_id) ?? null,
    }))
}

// ---------------------------------------------------------------------------
// DB reads
// ---------------------------------------------------------------------------

/**
 * kcal per meal for one day — the dayTotals SELECT with only the GROUP BY
 * changed (per meal id), exactly the relationship slotKcalForDay has to
 * dayTotals. The rows therefore sum to the day total the ring shows.
 */
export async function mealKcalForDay(date: string): Promise<Map<number, number>> {
  const h = await db()
  const rows = await h.all<{ meal_id: number; kcal: number | null }>(
    `SELECT m.id AS meal_id,
            SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal
     FROM meals m
     JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.deleted_at IS NULL AND li.deleted_at IS NULL
       AND m.analysis_status IN ('complete','manual')
     GROUP BY m.id`,
    [date],
  )
  const byMeal = new Map<number, number>()
  for (const r of rows) byMeal.set(r.meal_id, r.kcal ?? 0)
  return byMeal
}

export interface DayDetailData {
  date: string
  totals: DayTotals
  goal: CurrentGoal | null
  meals: DayMealRow[]
  status: DayCompletion
  /** The DayStatusControl's undo history, same read DayTimeline performs. */
  history: OperationRecord[]
}

/**
 * Everything /day-detail renders for one date, in one read. The queries are
 * the ones Home/DayTimeline already run — no new nutrition math, no new
 * WHERE clauses beyond the meal-id grouping documented above.
 */
export async function loadDayDetail(date: string): Promise<DayDetailData> {
  const h = await db()
  const [events, totals, goal, kcal, status, history] = await Promise.all([
    timeline(h, date),
    dayTotals(date),
    currentGoal(),
    mealKcalForDay(date),
    getDayStatus(h, date),
    listOperations(h, {
      entityType: 'day_status',
      entityId: Number(date.replaceAll('-', '')),
      limit: 4,
    }),
  ])
  return {
    date,
    totals,
    goal,
    meals: mealRowsFromTimeline(events, kcal),
    status: status?.completion ?? 'unknown',
    history,
  }
}
