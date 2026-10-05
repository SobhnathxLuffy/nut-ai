import Storage from 'expo-sqlite/kv-store'
import { createSyncMetadata, migrate, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import type { CalorieTarget, MacroTargets } from '@nutai/goals'
import { openUserDb } from '../db/expo-adapter'
import { clearDraft } from './draft'
import { ONBOARDING_DONE_KEY } from './done-key'
import {
  activityFor,
  ageFrom,
  featureDefaultsFor,
  inferredGoal,
  todayEmphasisFor,
  type OnboardingAnswers,
} from './store'

/**
 * Write the onboarding result into `user.db`.
 *
 * The `goals` table is APPEND-ONLY. A goal change is a new row, never an UPDATE,
 * so a historical day can always be read against the target that was actually in
 * force that day. Recomputing March against August's target would silently
 * rewrite whether someone hit their goal three months ago.
 *
 * `target_raw_kcal` and `floor_applied` are stored alongside the final target,
 * because "1,200 because we clamped it" and "1,200 because that is your maths"
 * are different facts and the Settings screen has to be able to tell them apart.
 */
export async function persistOnboarding(
  answers: OnboardingAnswers,
  target: CalorieTarget,
  macros: MacroTargets,
  // P3-D5: injectable for the unit suite; production callers omit it and get
  // the app-lifetime singleton.
  dbOverride?: DbAdapter,
): Promise<void> {
  const db = dbOverride ?? (await openUserDb())
  const now = Date.now()

  await migrate(db, now)

  const features = featureDefaultsFor(answers.blocker)

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT OR REPLACE INTO user_profile
         (id, sex, birth_year, height_cm, activity_level, units, weight_visible,
          gamification, inference_path, created_at)
       VALUES (1, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        answers.sex,
        answers.birthYear,
        answers.heightCm,
        activityFor(answers.workoutsPerWeek),
        answers.units,
        features.streakOn ? 1 : 0,
        answers.provider && answers.provider !== 'none' ? 'cloud' : 'none',
        now,
      ],
    )

    const goalSync = createSyncMetadata(now)
    const goalInsert = await tx.run(
      `INSERT INTO goals
         (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
          floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive,
          uuid, created_at, updated_at, revision, deleted_at, sync_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`,
      [
        now,
        inferredGoal(answers),
        null,
        target.target,
        target.targetRaw,
        target.floorApplied ? 1 : 0,
        macros.protein_g,
        macros.fat_g,
        macros.carbs_g,
        target.bmr,
        target.tdee,
        goalSync.uuid,
        goalSync.created_at,
        goalSync.updated_at,
        goalSync.revision,
        goalSync.deleted_at,
        goalSync.sync_state,
      ],
    )
    const goalId = Number(goalInsert.lastInsertRowId)
    const goal = await tx.get<Record<string, unknown>>('SELECT * FROM goals WHERE id = ?', [goalId])
    await recordOperation(tx, {
      entityType: 'goals', entityId: goalId, opType: 'insert', newJson: goal,
      actor: 'user', createdAt: now,
    })

    if (answers.weightKg != null) {
      const localDate = new Date(now).toISOString().slice(0, 10)
      const previous = await tx.get<Record<string, unknown>>(
        'SELECT * FROM weight_entries WHERE local_date = ?', [localDate],
      )
      if (previous) {
        await tx.run(
          `UPDATE weight_entries SET weight_kg = ?, logged_at = ?, updated_at = ?,
                                     revision = revision + 1, sync_state = 'local'
           WHERE local_date = ?`,
          [answers.weightKg, now, now, localDate],
        )
      } else {
        const weightSync = createSyncMetadata(now)
        await tx.run(
          `INSERT INTO weight_entries
             (local_date, weight_kg, logged_at, uuid, created_at, updated_at, revision, deleted_at, sync_state)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [localDate, answers.weightKg, now, weightSync.uuid, weightSync.created_at,
           weightSync.updated_at, weightSync.revision, weightSync.deleted_at, weightSync.sync_state],
        )
      }
      const weight = await tx.get<Record<string, unknown>>(
        'SELECT * FROM weight_entries WHERE local_date = ?', [localDate],
      )
      await recordOperation(tx, {
        entityType: 'weight_entries', entityId: Number(weight?.['id']),
        opType: previous ? 'update' : 'insert', prevJson: previous, newJson: weight,
        actor: 'user', createdAt: now,
      })
    }

    // Every setting below has a consumer. See the note at the top of store.ts:
    // a field written here with nothing reading it means the screen that asked
    // for it should be deleted, not the row.
    const settings: Array<[string, string]> = [
      ['diet.style', answers.dietStyle ?? 'balanced'],
      ['goal.desiredWeightKg', String(answers.desiredWeightKg ?? answers.weightKg ?? '')],
      ['goal.blocker', answers.blocker ?? ''],
      ['goal.accomplish', answers.accomplish ?? ''],
      ['today.emphasis', todayEmphasisFor(answers.accomplish)],
      ['calories.rollover', answers.rolloverCalories ? 'true' : 'false'],
      ['calories.rolloverCapKcal', '200'],
      ['professional.working', answers.worksWithProfessional ? 'true' : 'false'],
      ['export.shareablePdf', answers.worksWithProfessional ? 'true' : 'false'],
      ['coaching.suppressNudges', answers.worksWithProfessional ? 'true' : 'false'],
      // T5-a: the dead reminders.enabled write is gone — nothing read it. The
      // notifications system keys off its own categories/permissions state
      // (src/notifications), and the plan screen's bullet is copy, not state.
      // Per the note above, a written-but-unread field is a bug, not a row.
      ['streak.enabled', features.streakOn ? 'true' : 'false'],
      ['foods.savedPinned', features.savedMealsPinned ? 'true' : 'false'],
      ['mealIdeas.visible', features.showMealIdeas ? 'true' : 'false'],
      ['health.intent', answers.healthConnected ? 'true' : 'false'],
      // THE canonical keys the scan orchestrator reads. The apikey screen
      // writes these on verify too; writing here as well covers the skip path
      // and keeps one vocabulary — the old inference.* mirror keys are gone.
      ['provider', answers.provider ?? 'none'],
      ['provider_model', answers.providerModel ?? ''],
      ['age.years', String(ageFrom(answers, now))],
      ['weight.displayUnit', answers.units === 'imperial' ? 'lb' : 'kg'],
      // Height units are independent of weight (2026-10 rebuild): the display
      // choice rides its own settings key; height_cm itself stays canonical cm.
      ['height.displayUnit', answers.heightUnit],
    ]

    for (const [key, value] of settings) {
      await tx.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
    }
  })

  // Do NOT close the handle here. openUserDb() hands out a cached,
  // app-lifetime singleton (and on web it is literally the same object
  // repo.ts holds in `cached`); closing it pulls the database out from under
  // every later reader — the whole app then fails with "DB has been closed."
  // Nothing else in the app closes it either; reset keeps the handle and only
  // deletes rows.
  await Storage.setItem(ONBOARDING_DONE_KEY, 'true')
  // Completion ends the draft: a done onboarding must never resume. Cleared
  // AFTER the done key so a kill between the two writes leaves resume intact
  // (the resume path checks the done key first, so a leftover draft is inert).
  await clearDraft()
}
