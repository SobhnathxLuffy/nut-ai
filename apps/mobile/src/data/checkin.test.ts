import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSyncMetadata,
  getDayStatus,
  listOperations,
  migrate,
  undoOperation,
  type DbAdapter,
} from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  changeDayStatus,
  checkinDays,
  readSafety,
  reviewCheckin,
  saveSafety,
  DEFAULT_SAFETY,
} from './checkin.js'

const NOW = 1_760_000_000_000

describe('Day Completeness & Checkin Data (ADP-001 & ADP-002)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)

    // Seed default user profile
    await db.run(
      `INSERT INTO user_profile (id, sex, birth_year, height_cm, units, created_at)
       VALUES (1, 'male', 1995, 180, 'metric', ?)`,
      [NOW],
    )
  })

  async function seedMeal(
    id: number,
    localDate: string,
    kcal: number,
    proteinG: number,
    analysisStatus = 'complete',
  ) {
    const sync = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO meals (
        id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'lunch', 1.0, ?)`,
      [id, sync.uuid, NOW, NOW, 1, sync.sync_state, NOW, localDate, analysisStatus],
    )

    await db.run(
      `INSERT INTO log_items (
        id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        meal_id, matched_food_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
        snap_energy_kcal, snap_protein_g, logged_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'food-1', 'usda', 'Test Food', 100, 'direct', 'default', ?, ?, ?)`,
      [id, sync.uuid, NOW, NOW, 1, sync.sync_state, id, kcal, proteinG, NOW],
    )
  }

  async function seedGoal(targetKcal = 2000, proteinG = 150) {
    const sync = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO goals (
        id, uuid, effective_from, goal_type, rate_lb_per_week, target_kcal,
        target_raw_kcal, floor_applied, protein_g, fat_g, carbs_g, bmr, tdee,
        adaptive, created_at, updated_at, revision, deleted_at, sync_state
      ) VALUES (1, ?, ?, 'lose', 1.0, ?, ?, 0, ?, 55, 220, 1750, 2400, 1, ?, ?, 1, NULL, 'local')`,
      [sync.uuid, NOW - 30 * 86_400_000, targetKcal, targetKcal, proteinG, NOW, NOW],
    )
  }

  it('changes day status and records operation for undo', async () => {
    const date = '2026-03-05'

    // Initially unrecorded -> null
    const initial = await getDayStatus(db, date)
    expect(initial).toBeNull()

    // Set to complete
    await changeDayStatus(db, {
      localDate: date,
      completion: 'complete',
      provenance: 'timeline',
      now: NOW,
    })

    const afterSet = await getDayStatus(db, date)
    expect(afterSet?.completion).toBe('complete')
    expect(afterSet?.provenance).toBe('timeline')

    // Operation was recorded in operations table
    const ops = await listOperations(db, { entityType: 'day_status' })
    expect(ops).toHaveLength(1)
    expect(ops[0].op_type).toBe('insert')

    // Undo the operation
    const undoResult = await undoOperation(db, ops[0].id)
    expect(undoResult.success).toBe(true)

    // Status reverted (row deleted because it was an insert)
    const afterUndo = await getDayStatus(db, date)
    expect(afterUndo).toBeNull()
  })

  it('updates existing day status and restores previous status on undo', async () => {
    const date = '2026-03-05'

    // First: set to partial
    await changeDayStatus(db, {
      localDate: date,
      completion: 'partial',
      now: NOW,
    })

    // Second: user changes to fasting
    await changeDayStatus(db, {
      localDate: date,
      completion: 'fasting',
      now: NOW + 1000,
    })

    const current = await getDayStatus(db, date)
    expect(current?.completion).toBe('fasting')

    const ops = await listOperations(db, { entityType: 'day_status' })
    expect(ops).toHaveLength(2)
    expect(ops[0].op_type).toBe('update')

    // Undo the second change
    const undoResult = await undoOperation(db, ops[0].id)
    expect(undoResult.success).toBe(true)

    const reverted = await getDayStatus(db, date)
    expect(reverted?.completion).toBe('partial')
  })

  it('checkinDays correctly differentiates complete, fasting, partial, and unknown', async () => {
    const d1 = '2026-03-01'
    const d2 = '2026-03-02'
    const d3 = '2026-03-03'
    const d4 = '2026-03-04'

    await seedMeal(1, d1, 600, 40)
    await changeDayStatus(db, { localDate: d1, completion: 'complete' })

    // d2 is fasting with no meals -> intentional 0 kcal
    await changeDayStatus(db, { localDate: d2, completion: 'fasting' })

    // d3 is partial with a small meal
    await seedMeal(3, d3, 300, 20)
    await changeDayStatus(db, { localDate: d3, completion: 'partial' })

    // d4 has no status record -> defaults to unknown
    await seedMeal(4, d4, 500, 30)

    const days = await checkinDays(db, d1, d4)
    expect(days).toHaveLength(4)

    expect(days[0].date).toBe(d1)
    expect(days[0].status).toBe('complete')
    expect(days[0].kcal).toBe(600)

    expect(days[1].date).toBe(d2)
    expect(days[1].status).toBe('fasting')
    expect(days[1].kcal).toBe(0) // Intentional fast

    expect(days[2].date).toBe(d3)
    expect(days[2].status).toBe('partial')
    expect(days[2].kcal).toBe(300)

    expect(days[3].date).toBe(d4)
    expect(days[3].status).toBe('unknown')
  })

  it('past day status edits update analytics inputs and weekly metrics exclusions', async () => {
    await seedGoal()
    const endDate = '2026-03-07'

    // Seed 7 days of meals
    for (let i = 1; i <= 7; i++) {
      const date = `2026-03-0${i}`
      await seedMeal(i, date, 2000, 150)
      await changeDayStatus(db, { localDate: date, completion: 'complete' })
    }

    // Baseline: all 7 days complete
    const reviewInitial = await reviewCheckin(db, endDate, NOW)
    expect(reviewInitial.metrics.included_dates).toHaveLength(7)
    expect(reviewInitial.metrics.average_kcal).toBe(2000)

    // Edit a past day (03-03) to partial
    await changeDayStatus(db, { localDate: '2026-03-03', completion: 'partial' })

    // Re-check: past day edit immediately recalculates analytics inputs
    const reviewUpdated = await reviewCheckin(db, endDate, NOW)
    expect(reviewUpdated.metrics.included_dates).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
    ])
    expect(reviewUpdated.metrics.excluded_dates).toContainEqual({
      date: '2026-03-03',
      reason: 'partial',
    })
    expect(reviewUpdated.metrics.average_kcal).toBe(2000)
  })

  it('reads and saves safety settings correctly', async () => {
    const initial = await readSafety(db)
    expect(initial).toEqual(DEFAULT_SAFETY)

    await saveSafety(db, {
      reviewed: true,
      pregnant: false,
      lactating: false,
      eating_disorder_risk: false,
      locks: { kcal: false, protein: true, fat: false, carbs: false },
    })

    const updated = await readSafety(db)
    expect(updated.reviewed).toBe(true)
    expect(updated.locks.kcal).toBe(false)
  })
})
