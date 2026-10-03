import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { TimelineEvent } from '@nutai/timeline'

/**
 * The day-detail data adapter (AGENTS.md §0.2 item O4) — same test shape as
 * home-reads.test.ts: repo.ts is adapter-injectable via a mocked
 * ../db/expo-adapter, and the in-memory node DB stands in for user.db, so the
 * adapter's queries run against the real SQL layer.
 *
 *   loadDayDetail        — totals for a fixture day (the same dayTotals /
 *                          currentGoal / timeline reads Home and DayTimeline
 *                          already perform), the empty-day shape, and the
 *                          per-meal kcal that must agree with the day total.
 *   parseDayParam        — missing → today (the nutai://day alias lands
 *                          dateless), bad dates → null.
 *   dayTitle             — Today / Yesterday / the deterministic full form.
 *   mealRowsFromTimeline — meal events become rows; unknown kcal stays null.
 *
 * Meals are seeded with raw SQL (the meals/log_items core columns, stable
 * since schema v1) instead of logMeal, so these tests pin the day-detail
 * adapter itself rather than the logging write path.
 */

const testState = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('../db/expo-adapter', () => ({
  openUserDb: async () => testState.database as DbAdapter,
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))
vi.mock('../inference/credentials', () => ({ clearCredential: vi.fn() }))
vi.mock('./food-mutations', () => ({
  emitFoodMutation: vi.fn(),
  getLastDeletedMealUndoUuid: vi.fn(() => null),
  setLastDeletedMealUndoUuid: vi.fn(),
}))

import { db } from './repo'
import { localDate } from './date-utils'
import { dayTitle, loadDayDetail, mealKcalForDay, mealRowsFromTimeline, parseDayParam } from './day-detail'

const NOW = 1_754_300_000_000
/** The local date the seed rows carry — same helper, no TZ drift. */
const DAY = localDate(NOW)

let database: DbAdapter

/** One analysed meal + item, in the dayTotals WHERE clause's happy path. */
async function seedMeal(
  id: number,
  slot: string,
  loggedAt: number,
  item: { name: string; grams: number; kcalPer100g: number; proteinPer100g: number },
): Promise<void> {
  await database.run(
    `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction,
                        analysis_status, engine_id, prompt_version, schema_version,
                        clamp_flags_json, uuid, created_at, updated_at, revision,
                        deleted_at, sync_state)
     VALUES (?,?,?,?,1,'manual','test','p1','s1','[]',?,?,?,1,NULL,'local')`,
    [id, loggedAt, DAY, slot, `seed-meal-${id}`, loggedAt, loggedAt],
  )
  await database.run(
    `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams,
                            gram_pathway, portion_source, snap_energy_kcal,
                            snap_protein_g, snap_fat_g, snap_carb_g,
                            is_estimate, sort_order, logged_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?)`,
    [id, 'userfood', item.name, item.grams, 'manual', 'manual', item.kcalPer100g, item.proteinPer100g, 3, 18, loggedAt],
  )
}

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
  testState.database = database
  // migrate() seeds NO goals row — stand one up the way onboarding would.
  await database.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive,
        uuid, created_at, updated_at, revision, deleted_at, sync_state)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,1,'day-detail-goal',?,?,1,null,'local')`,
    [NOW, 'lose', 0.5, 2_400, 2_450, 150, 65, 270, 1_650, 2_400, NOW, NOW],
  )
  // Two meals on DAY, with EXPLICIT slots (slotFor(NOW) depends on the
  // runner's timezone, and these tests must not):
  //   meal 101 breakfast: Dal  200 g × 150 kcal/100 g = 300 kcal
  //   meal 102 lunch:     Roti 100 g × 300 kcal/100 g = 300 kcal
  await seedMeal(101, 'breakfast', NOW, { name: 'Dal', grams: 200, kcalPer100g: 150, proteinPer100g: 7 })
  await seedMeal(102, 'lunch', NOW + 60_000, { name: 'Roti', grams: 100, kcalPer100g: 300, proteinPer100g: 7 })
})

describe('loadDayDetail — totals for a fixture day', () => {
  it('returns the same totals/goal the Home reads produce, plus meal rows', async () => {
    const data = await loadDayDetail(DAY)
    expect(data.date).toBe(DAY)
    expect(data.totals.mealCount).toBe(2)
    expect(data.totals.kcal).toBeCloseTo(600, 6)
    expect(data.totals.protein_g).toBeCloseTo(21, 6)
    expect(data.goal?.targetKcal).toBe(2_400)
    expect(data.goal?.checkinAcceptedAt).toBeNull()
    expect(data.status).toBe('unknown')
    expect(data.history).toEqual([])
    expect(data.meals).toHaveLength(2)
    // Slot labels come from the timeline, capitalised.
    const labels = data.meals.map((m) => m.label).sort()
    expect(labels).toEqual(['Breakfast', 'Lunch'])
    // Row detail is the timeline's own item-name join.
    expect(data.meals.map((m) => m.detail).sort()).toEqual(['Dal', 'Roti'])
    // Timeline ordering (by logged_at) is preserved in the rows.
    expect(data.meals.map((m) => m.id)).toEqual([101, 102])
  })

  it('per-meal kcal is the dayTotals expression grouped by meal — rows sum to the ring', async () => {
    const byMeal = await mealKcalForDay(DAY)
    expect(byMeal.get(101)).toBe(300)
    expect(byMeal.get(102)).toBe(300)
    const data = await loadDayDetail(DAY)
    const sum = data.meals.reduce((acc, m) => acc + (m.kcal ?? 0), 0)
    expect(sum).toBeCloseTo(data.totals.kcal, 6)
  })

  it('empty-day shape: no fabricated rows, zero totals, unknown status', async () => {
    const data = await loadDayDetail('2030-01-01')
    expect(data.meals).toEqual([])
    expect(data.totals.kcal).toBe(0)
    expect(data.totals.protein_g).toBe(0)
    expect(data.totals.mealCount).toBe(0)
    expect(data.totals.pendingCount).toBe(0)
    expect(data.status).toBe('unknown')
    expect(data.history).toEqual([])
  })
})

describe('parseDayParam — the ?date= param', () => {
  it('a missing param falls back to today (the nutai://day alias lands dateless)', () => {
    expect(parseDayParam(undefined, '2026-10-05')).toBe('2026-10-05')
    expect(parseDayParam('', '2026-10-05')).toBe('2026-10-05')
    expect(parseDayParam('   ', '2026-10-05')).toBe('2026-10-05')
  })

  it('accepts a valid ISO date verbatim', () => {
    expect(parseDayParam('2024-09-27', '2026-10-05')).toBe('2024-09-27')
  })

  it('rejects malformed and impossible dates — never silently another day', () => {
    expect(parseDayParam('2026-2-3', '2026-10-05')).toBeNull()
    expect(parseDayParam('2026-02-30', '2026-10-05')).toBeNull()
    expect(parseDayParam('garbage', '2026-10-05')).toBeNull()
    expect(parseDayParam('20240927', '2026-10-05')).toBeNull()
  })
})

describe('dayTitle — the friendly screen title', () => {
  it('Today / Yesterday for the relative days', () => {
    expect(dayTitle('2026-10-05', '2026-10-05')).toBe('Today')
    expect(dayTitle('2026-10-04', '2026-10-05')).toBe('Yesterday')
  })

  it('the deterministic full form for any other date', () => {
    expect(dayTitle('2024-09-27', '2026-10-05')).toBe('Friday, September 27, 2024')
    expect(dayTitle('2026-01-01', '2026-10-05')).toBe('Thursday, January 1, 2026')
  })
})

describe('mealRowsFromTimeline — row derivation', () => {
  const meal = (id: number, label: string): TimelineEvent => ({
    id: `meal:${id}`, type: 'meal', entity_id: id, at: NOW,
    local_date: DAY, label, detail: 'Dal', deleted: false,
  })

  it('keeps meal events, capitalises labels, leaves unknown kcal null', () => {
    const events: TimelineEvent[] = [
      { id: 'w:1', type: 'workout', entity_id: 1, at: NOW, local_date: DAY, label: 'QA Upper Day', detail: 'active', deleted: false },
      meal(10, 'breakfast'),
      meal(11, 'Meal'),
    ]
    const rows = mealRowsFromTimeline(events, new Map([[10, 300]]))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 10, label: 'Breakfast', kcal: 300 })
    expect(rows[1]).toMatchObject({ id: 11, label: 'Meal', kcal: null })
  })
})

// Guard: the adapter must keep using the app's db() singleton (the mocked
// openUserDb), not open its own connection.
describe('db wiring', () => {
  it('shares the repo singleton', async () => {
    const h = await db()
    expect(h).toBe(testState.database as DbAdapter)
  })
})
