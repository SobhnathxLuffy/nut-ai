import { describe, expect, it, vi } from 'vitest'
import { migrate } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  activeWorkout,
  addExercise,
  createExercise,
  discardWorkout,
  finishWorkout,
  listExercises,
  onWorkoutsChanged,
  saveEquipment,
  saveSet,
  seedExercises,
  startWorkout,
} from './index.js'

/**
 * O8 (Wave 5B) — the training write event bus.
 *
 * UI/UX report Table 12.1: the ActiveWorkout card used to re-read the DB on a
 * 5s poll while a rest timer ran. The contract locked here is what lets that
 * poll go away:
 *   - every workout/workout-exercise/workout-set write through THIS repo
 *     instance fires the subscriber exactly once (per transaction, after commit)
 *   - a subscriber may re-read and already see the committed row
 *   - unrelated writes (exercises, equipment, routines) and other repo
 *     instances stay silent
 */

describe('onWorkoutsChanged (O8, Wave 5B)', () => {
  it('fires once per workout write — and AFTER commit, so the listener already sees the new state', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const exercise = (await listExercises(db))[0]!

    const seenWorkoutIds: number[] = []
    const listener = vi.fn(() => {
      // Re-read immediately: the notification must arrive post-commit.
      void activeWorkout(db).then(w => { if (w) seenWorkoutIds.push(w.id) })
    })
    onWorkoutsChanged(db, listener)

    const id = await startWorkout(db, '2026-09-28', 'Event Bus', 10_000)
    expect(listener).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(seenWorkoutIds).toEqual([id]))

    // A whole set-completion batch (workout_sets insert + workouts rest_until
    // update) is ONE transaction — one notification, not one per table.
    const we = await addExercise(db, id, exercise.id, 11_000)
    expect(listener).toHaveBeenCalledTimes(2)
    await saveSet(db, we, { load_kg: 60, reps: 8 }, { completed: true }, 12_000)
    expect(listener).toHaveBeenCalledTimes(3)

    await finishWorkout(db, id, 20_000)
    expect(listener).toHaveBeenCalledTimes(4)
    await db.close()
  })

  it('does not fire for unrelated writes (exercises, equipment) or no-op writes', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const listener = vi.fn()
    onWorkoutsChanged(db, listener)

    await createExercise(db, { name: 'Event Bus Probe', tracking_type: 'reps', primary_muscles: ['chest'] })
    await saveEquipment(db, { name: 'Probe bar', kind: 'barbell', weight_kg: 20, count: 1 })
    expect(listener).not.toHaveBeenCalled()

    // startWorkout on an already-active workout is an idempotent no-op (zero
    // changes) — no event.
    const id = await startWorkout(db, '2026-09-28', 'No-op probe', 10_000)
    expect(listener).toHaveBeenCalledTimes(1)
    await startWorkout(db, '2026-09-28', 'Ignored second start', 11_000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect((await activeWorkout(db))?.id).toBe(id)
    await db.close()
  })

  it('a rolled-back write stays silent, and other repo instances are not notified', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const listener = vi.fn()
    onWorkoutsChanged(db, listener)

    // saveSet on a nonexistent workout-exercise throws inside the transaction —
    // nothing commits, nothing notifies.
    await expect(saveSet(db, 999_999, { load_kg: 60, reps: 8 }, {}, 10_000)).rejects.toThrow('Exercise not found')
    expect(listener).not.toHaveBeenCalled()

    // A different adapter instance (another "repo instance") hears nothing.
    const otherDb = openMemoryDb()
    await migrate(otherDb, 1000)
    const otherListener = vi.fn()
    onWorkoutsChanged(otherDb, otherListener)
    await startWorkout(db, '2026-09-28', 'Instance scope', 11_000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(otherListener).not.toHaveBeenCalled()
    await db.close()
    await otherDb.close()
  })

  it('unsubscribing stops notifications for that listener only', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = onWorkoutsChanged(db, first)
    onWorkoutsChanged(db, second)

    const id = await startWorkout(db, '2026-09-28', 'Unsubscribe probe', 10_000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribe()
    // A write only the still-subscribed listener hears.
    await discardWorkout(db, id, 11_000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    await db.close()
  })
})
