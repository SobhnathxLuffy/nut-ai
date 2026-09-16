import { describe, expect, it } from 'vitest'
import { migrate, undoOperation, redoOperation, listOperations } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  seedExercises,
  listExercises,
  startWorkout,
  activeWorkout,
  addExercise,
  saveSet,
  workoutDetail,
  finishWorkout,
  reopenWorkout,
  performanceHistory,
  deriveRecords,
  saveRoutine,
  listRoutines,
  isExerciseInWorkout,
  addExerciseToRoutine,
  editWorkoutExercise,
} from './index.js'
import { RoutineInput } from '@nutai/core-schema'

describe('Exercise Library Actions, Picker & Core Training Reliability', () => {
  it('Exercise Detail Action: Start quick workout creates workout and adds exercise once', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exercises = await listExercises(db)
    const ex = exercises[0]!

    // Ensure no active workout initially
    expect(await activeWorkout(db)).toBeNull()

    // Start quick workout with this exercise
    const workoutId = await startWorkout(db, '2026-09-16', 'Quick Workout', 10000)
    expect(workoutId).toBeGreaterThan(0)
    await addExercise(db, workoutId, ex.id, 10000)

    // Verify active workout exists and has exactly 1 exercise
    const active = await activeWorkout(db)
    expect(active).not.toBeNull()
    expect(active?.id).toBe(workoutId)

    const detail = await workoutDetail(db, workoutId)
    expect(detail.exercises).toHaveLength(1)
    expect(detail.exercises[0]?.exercise_id).toBe(ex.id)
    expect(detail.exercises[0]?.name).toBe(ex.name)

    // Verify duplicate detection
    const isPresent = await isExerciseInWorkout(db, workoutId, ex.id)
    expect(isPresent).toBe(true)

    const ex2 = exercises[1]!
    const isPresent2 = await isExerciseInWorkout(db, workoutId, ex2.id)
    expect(isPresent2).toBe(false)

    await db.close()
  })

  it('Exercise Detail Action: Add to Active Workout preserves active workout state and timer', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exercises = await listExercises(db)
    const ex1 = exercises[0]!
    const ex2 = exercises[1]!

    // Active workout started at 10000 with ex1
    const workoutId = await startWorkout(db, '2026-09-16', 'Leg Day', 10000)
    const we1 = await addExercise(db, workoutId, ex1.id, 10000)
    const set1 = await saveSet(db, we1, { load_kg: 80, reps: 5 }, { completed: true, restSeconds: 90 }, 11000)

    const beforeAdd = await activeWorkout(db)
    expect(beforeAdd?.started_at).toBe(10000)
    expect(beforeAdd?.rest_until).toBe(11000 + 90000)

    // Add ex2 from Exercise Detail
    await addExercise(db, workoutId, ex2.id, 12000)

    const afterAdd = await activeWorkout(db)
    // Started at and rest timer must be preserved
    expect(afterAdd?.id).toBe(workoutId)
    expect(afterAdd?.started_at).toBe(10000)
    expect(afterAdd?.rest_until).toBe(11000 + 90000)

    // Detail should now contain 2 exercises; ex1's completed set must be intact
    const detail = await workoutDetail(db, workoutId)
    expect(detail.exercises).toHaveLength(2)
    expect(detail.exercises[0]?.sets[0]?.id).toBe(set1)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBe(11000)
    expect(detail.exercises[1]?.exercise_id).toBe(ex2.id)

    await db.close()
  })

  it('Add to Routine: addExerciseToRoutine appends exercise with valid schema and progression rules', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exercises = await listExercises(db)
    const ex1 = exercises[0]!
    const ex2 = exercises[1]!

    const routineId = await saveRoutine(db, {
      name: 'Full Body A',
      exercises: [
        {
          exercise_id: ex1.id,
          group: null,
          sets: [
            { load_kg: 50, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
          ],
          rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 },
        },
      ],
    })

    // Add ex2 to routine
    await addExerciseToRoutine(db, routineId, ex2.id, 15000)

    const routines = await listRoutines(db)
    expect(routines).toHaveLength(1)
    const r = routines[0]!
    const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
    expect(parsed.exercises).toHaveLength(2)
    expect(parsed.exercises[1]?.exercise_id).toBe(ex2.id)
    expect(parsed.exercises[1]?.sets.length).toBeGreaterThanOrEqual(1)
    expect(parsed.exercises[1]?.rule.kind).toBe('double')

    await db.close()
  })

  it('Completed-set ordinary edits preserve completed_at for load, reps, RPE, RIR, tempo, notes, and kind', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    const w = await startWorkout(db, '2026-09-16', 'Precision Test', 10000)
    const we = await addExercise(db, w, ex.id, 11000)

    // Complete set at T = 12000
    const setId = await saveSet(
      db,
      we,
      { load_kg: 50, reps: 10, rpe: 8, rir: 2, tempo: '3-0-1-0' },
      { completed: true },
      12000,
    )

    let detail = await workoutDetail(db, w)
    let s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.load_kg).toBe(50)
    expect(s.reps).toBe(10)
    expect(s.rpe).toBe(8)
    expect(s.rir).toBe(2)
    expect(s.tempo).toBe('3-0-1-0')

    // 1. Edit load_kg at T = 13000 -> completed_at remains 12000
    await saveSet(db, we, { ...s, load_kg: 55 }, { id: setId, completed: true }, 13000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.load_kg).toBe(55)

    // 2. Edit reps at T = 14000 -> completed_at remains 12000
    await saveSet(db, we, { ...s, reps: 8 }, { id: setId, completed: true }, 14000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.reps).toBe(8)

    // 3. Edit RPE at T = 15000 -> completed_at remains 12000
    await saveSet(db, we, { ...s, rpe: 9 }, { id: setId, completed: true }, 15000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.rpe).toBe(9)

    // 4. Edit RIR at T = 16000 -> completed_at remains 12000
    await saveSet(db, we, { ...s, rir: 1 }, { id: setId, completed: true }, 16000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.rir).toBe(1)

    // 5. Edit tempo at T = 17000 -> completed_at remains 12000
    await saveSet(db, we, { ...s, tempo: '4-1-1-0' }, { id: setId, completed: true }, 17000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.tempo).toBe('4-1-1-0')

    // 6. Edit exercise notes at T = 18000 -> completed_at remains 12000
    await editWorkoutExercise(db, we, { notes: 'Paused on chest' }, 18000)
    detail = await workoutDetail(db, w)
    expect(detail.exercises[0]!.notes).toBe('Paused on chest')
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)

    // 7. Edit kind (warmup vs normal) at T = 19000 -> completed_at remains 12000
    await saveSet(db, we, s, { id: setId, completed: true, kind: 'drop' }, 19000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(12000)
    expect(s.kind).toBe('drop')

    // 8. Explicit toggle to completed: false at T = 20000 -> completed_at becomes null
    await saveSet(db, we, s, { id: setId, completed: false }, 20000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBeNull()

    // 9. Re-complete at T = 21000 -> completed_at becomes 21000
    await saveSet(db, we, s, { id: setId, completed: true }, 21000)
    detail = await workoutDetail(db, w)
    s = detail.exercises[0]!.sets[0]!
    expect(s.completed_at).toBe(21000)

    await db.close()
  })

  it('Edited completed sets correctly recompute volume, heaviest working set, e1RM, and PR state', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    // Session 1: 50 kg x 10 reps (e1RM = 50 * (1 + 10/30) = 66.6667, volume = 500)
    const w = await startWorkout(db, '2026-09-16', 'PR Session', 10000)
    const we = await addExercise(db, w, ex.id, 11000)
    const setId = await saveSet(db, we, { load_kg: 50, reps: 10 }, { completed: true }, 12000)
    await finishWorkout(db, w, 13000)

    let history = await performanceHistory(db)
    let records = deriveRecords(history)

    const initialHeaviest = records.find((r) => r.kind === 'heaviest load')
    const initialVolume = records.find((r) => r.kind === 'session volume')
    const initialE1rm = records.find((r) => r.kind === 'estimated 1RM')

    expect(initialHeaviest?.value).toBe(50)
    expect(initialVolume?.value).toBe(500)
    expect(initialE1rm?.value).toBeCloseTo(66.67, 1)

    // Reopen workout and edit completed set to 60 kg x 10 reps
    await reopenWorkout(db, w, 14000)
    await saveSet(db, we, { load_kg: 60, reps: 10 }, { id: setId, completed: true }, 15000)
    await finishWorkout(db, w, 16000)

    // Verify dynamic recomputation from performanceHistory
    history = await performanceHistory(db)
    records = deriveRecords(history)

    const updatedHeaviest = records.find((r) => r.kind === 'heaviest load')
    const updatedVolume = records.find((r) => r.kind === 'session volume')
    const updatedE1rm = records.find((r) => r.kind === 'estimated 1RM')

    expect(updatedHeaviest?.value).toBe(60)
    expect(updatedVolume?.value).toBe(600)
    // 60 * (1 + 10/30) = 80
    expect(updatedE1rm?.value).toBeCloseTo(80, 1)

    await db.close()
  })

  it('Stale draft & Undo/Redo preserves completed_at and restores accurate values', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    const w = await startWorkout(db, '2026-09-16', 'Undo Workout', 10000)
    const we = await addExercise(db, w, ex.id, 11000)
    const setId = await saveSet(db, we, { load_kg: 70, reps: 5 }, { completed: true }, 12000)

    // Edit set to 75 kg
    await saveSet(db, we, { load_kg: 75, reps: 5 }, { id: setId, completed: true }, 13000)
    let detail = await workoutDetail(db, w)
    expect(detail.exercises[0]?.sets[0]?.load_kg).toBe(75)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBe(12000)

    // Undo operation
    const ops = await listOperations(db)
    const lastOp = ops[0]!
    const undoRes = await undoOperation(db, lastOp.id, 14000)
    expect(undoRes.success).toBe(true)

    detail = await workoutDetail(db, w)
    expect(detail.exercises[0]?.sets[0]?.load_kg).toBe(70)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBe(12000)

    // Redo operation
    const redoRes = await redoOperation(db, lastOp.id)
    expect(redoRes.success).toBe(true)

    detail = await workoutDetail(db, w)
    expect(detail.exercises[0]?.sets[0]?.load_kg).toBe(75)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBe(12000)

    await db.close()
  })

  it('Accidental duplicate actions: rapid startWorkout is idempotent', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)

    const w1 = await startWorkout(db, '2026-09-16', 'Session A', 10000)
    const w2 = await startWorkout(db, '2026-09-16', 'Session B', 10500)
    // Starting again while active returns the existing workout ID
    expect(w2).toBe(w1)

    await db.close()
  })
})
