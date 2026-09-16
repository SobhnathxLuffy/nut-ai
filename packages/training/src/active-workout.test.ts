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
  groupExercises,
  workoutDetail,
  finishWorkout,
  reopenWorkout,
  discardWorkout,
  updateWorkout,
} from './index.js'

describe('TRN-002 / TRN-003 / TRN-007: Active workout lifecycle, persistence, and supersets', () => {
  it('enforces single active workout invariant and supports recovery after restart', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    // Start workout
    const w1 = await startWorkout(db, '2026-09-12', 'Morning Session', 10000)
    expect(w1).toBeGreaterThan(0)

    // Starting another workout returns existing active workout id (does not duplicate)
    const w2 = await startWorkout(db, '2026-09-12', 'Another Session', 10500)
    expect(w2).toBe(w1)

    // Log an exercise and set
    const weId = await addExercise(db, w1, ex.id, 11000)
    const setId = await saveSet(db, weId, { load_kg: 50, reps: 10 }, { completed: false }, 12000)

    // Simulate app restart by querying activeWorkout directly
    const recovered = await activeWorkout(db)
    expect(recovered).not.toBeNull()
    expect(recovered?.id).toBe(w1)
    expect(recovered?.name).toBe('Morning Session')

    // Verify detail preserves uncompleted set draft
    const detail = await workoutDetail(db, w1)
    expect(detail.exercises[0]?.sets[0]?.id).toBe(setId)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBeNull()

    // Complete set
    await saveSet(db, weId, { load_kg: 50, reps: 10 }, { id: setId, completed: true, restSeconds: 90 }, 13000)
    const afterComplete = await workoutDetail(db, w1)
    expect(afterComplete.exercises[0]?.sets[0]?.completed_at).toBe(13000)

    // Rest timer set to now + 90s
    const active = await activeWorkout(db)
    expect(active?.rest_until).toBe(13000 + 90000)

    // Finish workout
    await finishWorkout(db, w1, 14000)
    expect(await activeWorkout(db)).toBeNull()

    // Reopen workout
    await reopenWorkout(db, w1, 15000)
    expect((await activeWorkout(db))?.id).toBe(w1)

    // Discard workout
    await discardWorkout(db, w1, 16000)
    expect(await activeWorkout(db)).toBeNull()

    await db.close()
  })

  it('handles superset grouping and delays rest timer until last exercise in group', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exList = await listExercises(db)
    const ex1 = exList[0]!
    const ex2 = exList[1]!

    const w = await startWorkout(db, '2026-09-12', 'Superset Day', 10000)
    const we1 = await addExercise(db, w, ex1.id, 11000)
    const we2 = await addExercise(db, w, ex2.id, 12000)

    // Group ex1 and ex2 into circuit
    await groupExercises(db, w, [we1, we2], 13000)
    const detail = await workoutDetail(db, w)
    expect(detail.exercises[0]?.superset_group_id).not.toBeNull()
    expect(detail.exercises[0]?.superset_group_id).toBe(detail.exercises[1]?.superset_group_id)

    // Completing set on first exercise in superset should NOT trigger rest timer
    await saveSet(db, we1, { load_kg: 40, reps: 10 }, { completed: true, restSeconds: 60 }, 14000)
    const activeMid = await activeWorkout(db)
    expect(activeMid?.rest_until).toBeNull()

    // Completing set on last exercise in superset DOES trigger rest timer
    await saveSet(db, we2, { load_kg: 30, reps: 12 }, { completed: true, restSeconds: 60 }, 15000)
    const activeEnd = await activeWorkout(db)
    expect(activeEnd?.rest_until).toBe(15000 + 60000)

    await db.close()
  })

  it('supports undo and redo for workout mutations', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const w = await startWorkout(db, '2026-09-12', 'Undo Test', 10000)
    await updateWorkout(db, w, { notes: 'Original note' }, 11000)
    await updateWorkout(db, w, { notes: 'Updated note' }, 12000)

    expect((await workoutDetail(db, w)).workout.notes).toBe('Updated note')

    // Undo update
    const ops = await listOperations(db)
    const lastOp = ops[0]!
    const undoRes = await undoOperation(db, lastOp.id, 13000)
    expect(undoRes.success).toBe(true)
    expect((await workoutDetail(db, w)).workout.notes).toBe('Original note')

    // Redo update
    const redoRes = await redoOperation(db, lastOp.id)
    expect(redoRes.success).toBe(true)
    expect((await workoutDetail(db, w)).workout.notes).toBe('Updated note')
    await db.close()
  })

  it('editing a completed set does not uncomplete it', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exList = await listExercises(db)
    const ex1 = exList[0]!

    const w = await startWorkout(db, '2026-09-12', 'Edit Test', 10000)
    const we1 = await addExercise(db, w, ex1.id, 11000)

    // Create and complete set
    const setId = await saveSet(db, we1, { load_kg: 40, reps: 8 }, { completed: true }, 12000)
    let detail = await workoutDetail(db, w)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBe(12000)

    // Edit values but pass completed: true (as the UI does now when editing a completed set)
    await saveSet(db, we1, { load_kg: 42.5, reps: 7 }, { id: setId, completed: true }, 13000)
    detail = await workoutDetail(db, w)
    // The completed_at timestamp should remain unchanged from original completion
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBe(12000)
    expect(detail.exercises[0]?.sets[0]?.load_kg).toBe(42.5)
    expect(detail.exercises[0]?.sets[0]?.reps).toBe(7)

    // Explicitly uncomplete
    await saveSet(db, we1, { load_kg: 42.5, reps: 7 }, { id: setId, completed: false }, 14000)
    detail = await workoutDetail(db, w)
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBeNull()

    await db.close()
  })
})
