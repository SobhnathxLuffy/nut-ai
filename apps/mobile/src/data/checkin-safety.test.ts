import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncMetadata, listOperations, migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { acceptCheckin, changeDayStatus, reviewCheckin, saveSafety } from './checkin.js'

const NOW = 1_760_000_000_000
const END_DATE = '2026-03-08'

describe('Check-in Consent and Safety Guardrails (ADP-005)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)

    // Seed profile: adult (30yo), normal BMI, male
    await db.run(
      `INSERT INTO user_profile (id, sex, birth_year, height_cm, units, created_at)
       VALUES (1, 'male', 1995, 180, 'metric', ?)`,
      [NOW],
    )

    // Seed goal
    const sync = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO goals (
        id, uuid, effective_from, goal_type, rate_lb_per_week, target_kcal,
        target_raw_kcal, floor_applied, protein_g, fat_g, carbs_g, bmr, tdee,
        adaptive, created_at, updated_at, revision, deleted_at, sync_state
      ) VALUES (1, ?, ?, 'lose', 0.5, 2000, 2000, 0, 150, 55, 225, 1750, 2400, 1, ?, ?, 1, NULL, 'local')`,
      [sync.uuid, NOW - 30 * 86_400_000, NOW, NOW],
    )

    // Seed default reviewed safety settings with unlocked macros
    await saveSafety(db, {
      reviewed: true,
      pregnant: false,
      lactating: false,
      eating_disorder_risk: false,
      locks: { kcal: false, protein: false, fat: false, carbs: false },
    })

    // Seed 8 complete days with steady weight loss
    for (let i = 1; i <= 8; i++) {
      const date = `2026-03-0${i}`
      const mealSync = createSyncMetadata(NOW)
      await db.run(
        `INSERT INTO meals (
          id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
          logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'lunch', 1.0, 'complete')`,
        [i, mealSync.uuid, NOW, NOW, 1, mealSync.sync_state, NOW, date],
      )

      await db.run(
        `INSERT INTO log_items (
          id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
          meal_id, matched_food_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
          snap_energy_kcal, snap_protein_g, logged_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'f1', 'usda', 'Food', 100, 'direct', 'default', 2400, 150, ?)`,
        [i, mealSync.uuid, NOW, NOW, 1, mealSync.sync_state, i, NOW],
      )

      await db.run(
        `INSERT INTO weight_entries (
          id, uuid, local_date, weight_kg, logged_at, created_at, updated_at, revision, deleted_at, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, 'local')`,
        [i, mealSync.uuid, date, 80.0 - (i - 1) * 0.1, NOW, NOW, NOW],
      )

      await changeDayStatus(db, { localDate: date, completion: 'complete' })
    }
  })

  it('allows safe adaptive target suggestion when all guardrails pass', async () => {
    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.flags).toHaveLength(0)
    expect(review.suggestion).not.toBeNull()
  })

  it('blocks suggestion when user is a minor (<18 years old)', async () => {
    const currentYear = new Date(NOW).getFullYear()
    // Birth year makes user 16 years old
    await db.run('UPDATE user_profile SET birth_year = ? WHERE id = 1', [currentYear - 16])

    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.flags).toContain('Adaptive changes are unavailable for people under 18.')
    expect(review.suggestion).toBeNull()
  })

  it('blocks suggestion when pregnant or lactating', async () => {
    await saveSafety(db, {
      reviewed: true,
      pregnant: true,
      lactating: false,
      eating_disorder_risk: false,
      locks: { kcal: false, protein: false, fat: false, carbs: false },
    })

    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.flags).toContain('Pregnancy or lactation needs individual professional guidance.')
    expect(review.suggestion).toBeNull()
  })

  it('blocks suggestion when eating disorder risk is signaled', async () => {
    await saveSafety(db, {
      reviewed: true,
      pregnant: false,
      lactating: false,
      eating_disorder_risk: true,
      locks: { kcal: false, protein: false, fat: false, carbs: false },
    })

    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.flags).toContain(
      'Use targets agreed with a qualified professional when eating or weight tracking is a concern.',
    )
    expect(review.suggestion).toBeNull()
  })

  it('blocks suggestion when BMI is below underweight threshold (<18.5)', async () => {
    // 50kg at 180cm -> BMI ~ 15.4
    await db.run('UPDATE weight_entries SET weight_kg = 50.0')

    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.flags).toContain(
      'Adaptive changes are unavailable at a low body weight; seek individual guidance.',
    )
    expect(review.suggestion).toBeNull()
  })

  it('blocks suggestion when safety settings have not been reviewed', async () => {
    await saveSafety(db, {
      reviewed: false,
      pregnant: false,
      lactating: false,
      eating_disorder_risk: false,
      locks: { kcal: false, protein: false, fat: false, carbs: false },
    })

    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.flags).toContain('Please review your safety information first.')
    expect(review.suggestion).toBeNull()
  })

  it('requires explicit confirmation and updates target with full audit trail', async () => {
    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.suggestion).not.toBeNull()

    // 1. Refuses without explicit confirmation
    await expect(
      acceptCheckin(db, END_DATE, review.fingerprint, false, NOW),
    ).rejects.toThrow('Explicit confirmation is required')

    // 2. Refuses with mismatched/stale fingerprint
    await expect(
      acceptCheckin(db, END_DATE, 'stale-fingerprint', true, NOW),
    ).rejects.toThrow('Your data changed')

    // 3. Accepts with valid confirmation
    const newGoalId = await acceptCheckin(db, END_DATE, review.fingerprint, true, NOW)
    expect(newGoalId).toBeGreaterThan(1)

    // Goal was updated
    const activeGoal = await db.get<{ target_kcal: number; adaptive: number; adaptive_evidence_json: string }>(
      'SELECT target_kcal, adaptive, adaptive_evidence_json FROM goals WHERE id = ?',
      [newGoalId],
    )
    expect(activeGoal?.target_kcal).toBe(review.suggestion!.proposed.kcal)
    expect(activeGoal?.adaptive).toBe(1)
    expect(JSON.parse(activeGoal?.adaptive_evidence_json ?? '{}')).toHaveProperty('local_date', END_DATE)

    // Operation was recorded in operations table for audit and undo
    const ops = await listOperations(db, { entityType: 'goals', entityId: newGoalId })
    expect(ops).toHaveLength(1)
    expect(ops[0].op_type).toBe('insert')
    expect(ops[0].actor).toBe('user')
  })

  it('rejection leaves existing target completely unchanged', async () => {
    const initialGoal = await db.get<{ target_kcal: number }>(
      'SELECT target_kcal FROM goals ORDER BY id DESC LIMIT 1',
    )
    const review = await reviewCheckin(db, END_DATE, NOW)
    expect(review.suggestion).not.toBeNull()

    // User chooses to reject / ignore the suggestion (no acceptCheckin call made)
    const currentGoal = await db.get<{ target_kcal: number }>(
      'SELECT target_kcal FROM goals ORDER BY id DESC LIMIT 1',
    )
    expect(currentGoal?.target_kcal).toBe(initialGoal?.target_kcal)
  })
})
