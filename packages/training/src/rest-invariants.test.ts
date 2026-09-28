import { describe, expect, it } from 'vitest'
import { migrate } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { seedExercises, listExercises, startWorkout, activeWorkout, addExercise, saveSet } from './index.js'

/**
 * P2-8 regression locks for the rest timer.
 *
 * The QA report flagged that rest "auto-starts with zero completed sets".
 * The intended contract is narrower and must stay exactly this way:
 *   - starting a workout never starts a rest
 *   - adding exercises never starts a rest
 *   - creating or editing DRAFT sets never starts a rest
 *   - only a real draft -> completed transition starts a rest
 *     (honouring an explicit restSeconds override)
 */
describe('rest timer invariants (P2-8)', () => {
  it('starting a workout, adding exercises and drafting sets never auto-starts rest', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exercises = await listExercises(db)
    const ex1 = exercises[0]!
    const ex2 = exercises[1]!

    const workoutId = await startWorkout(db, '2026-09-28', 'Rest Invariants', 10_000)
    expect((await activeWorkout(db))?.rest_until ?? null).toBeNull()

    const we1 = await addExercise(db, workoutId, ex1.id, 11_000)
    expect((await activeWorkout(db))?.rest_until ?? null).toBeNull()

    // Draft set with values, never completed:
    const draft = await saveSet(db, we1, { load_kg: 80, reps: 5 }, { completed: false }, 12_000)
    expect(draft).toBeGreaterThan(0)
    expect((await activeWorkout(db))?.rest_until ?? null).toBeNull()

    // Editing the draft values again must not start rest either:
    await saveSet(db, we1, { load_kg: 82.5, reps: 5 }, { id: draft, completed: false }, 13_000)
    expect((await activeWorkout(db))?.rest_until ?? null).toBeNull()

    // A second exercise joins the workout — still no rest:
    await addExercise(db, workoutId, ex2.id, 14_000)
    expect((await activeWorkout(db))?.rest_until ?? null).toBeNull()
  })

  it('a real draft -> completed transition starts rest and honours the per-call override', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exercises = await listExercises(db)
    const workoutId = await startWorkout(db, '2026-09-28', 'Rest Override', 10_000)
    const we = await addExercise(db, workoutId, exercises[0]!.id, 11_000)
    const draft = await saveSet(db, we, { load_kg: 60, reps: 8 }, { completed: false }, 12_000)

    // Default auto-rest is 90s:
    await saveSet(db, we, { load_kg: 60, reps: 8 }, { id: draft, completed: true }, 13_000)
    expect((await activeWorkout(db))?.rest_until).toBe(13_000 + 90_000)

    // Explicit override (the workout screen now passes the remembered
    // preference) replaces the default:
    const draft2 = await saveSet(db, we, { load_kg: 65, reps: 6 }, { completed: false }, 200_000)
    await saveSet(db, we, { load_kg: 65, reps: 6 }, { id: draft2, completed: true, restSeconds: 120 }, 201_000)
    expect((await activeWorkout(db))?.rest_until).toBe(201_000 + 120_000)
  })
})
