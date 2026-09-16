import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncMetadata, migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { loadReport } from './analytics'

const NOW = Date.parse('2026-09-07T12:00:00Z')

describe('mobile analytics read model', () => {
  let db: DbAdapter
  beforeEach(async () => {
    db = openMemoryDb()
    await migrate(db, NOW)
    const goal = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO goals
       (effective_from, goal_type, target_kcal, target_raw_kcal, protein_g, fat_g, carbs_g,
        bmr, tdee, adaptive, uuid, created_at, updated_at, revision, sync_state)
       VALUES (?, 'maintain', 2000, 2000, 120, 65, 240, 1600, 2200, 0, ?, ?, ?, 1, 'local')`,
      [NOW - 30 * 86_400_000, goal.uuid, NOW, NOW],
    )
  })

  async function addMeal(date: string, kcal: number | null, status: 'complete' | 'partial') {
    const sync = createSyncMetadata(NOW)
    const meal = await db.run(
      `INSERT INTO meals
       (logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at,
        uuid, updated_at, revision, sync_state)
       VALUES (?, ?, 'lunch', 1, 'complete', ?, ?, ?, 1, 'local')`,
      [NOW, date, NOW, sync.uuid, NOW],
    )
    const item = createSyncMetadata(NOW + 1)
    await db.run(
      `INSERT INTO log_items
       (meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
        snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, sort_order, logged_at,
        uuid, created_at, updated_at, revision, sync_state)
       VALUES (?, 'test', 'Meal', 100, 'scale', 'test', ?, 100, 50, 200, 0, ?, ?, ?, ?, 1, 'local')`,
      [Number(meal.lastInsertRowId), kcal, NOW, item.uuid, NOW, NOW],
    )
    await db.run(
      `INSERT INTO day_status (local_date, completion, confirmed_at, updated_at, actor, provenance)
       VALUES (?, ?, ?, ?, 'user', 'test')`,
      [date, status, NOW, NOW],
    )
  }

  it('uses per-100g snapshots once and excludes partial/unknown days from averages', async () => {
    await addMeal('2026-09-01', 2_000, 'complete')
    await addMeal('2026-09-02', 500, 'partial')
    const report = await loadReport(db, 'week', '2026-09-01', '2026-09-07')
    expect(report.nutrition.avg_kcal).toBe(2_000)
    expect(report.nutrition.days_included).toBe(1)
    expect(report.nutrition.excluded_days.find((day) => day.date === '2026-09-02')?.reason).toBe('partial')
    expect(report.nutrition.unknown_days).toBe(5)
  })

  it('marks a complete day with an unknown calorie snapshot unavailable, not zero', async () => {
    await addMeal('2026-09-01', null, 'complete')
    const report = await loadReport(db, 'week', '2026-09-01', '2026-09-07')
    expect(report.nutrition.avg_kcal).toBeNull()
    expect(report.nutrition.excluded_days[0]?.reason).toBe('nutrition_unavailable')
  })
})
