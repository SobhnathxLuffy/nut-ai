import { describe, expect, it } from 'vitest'
import { migrate } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  seedExercises,
  listExercises,
  saveRoutine,
  listRoutines,
  saveProgram,
  listPrograms,
  scheduledRoutine,
  launchRoutine,
  workoutDetail,
} from './index.js'

describe('TRN-005: Routines and Programs', () => {
  it('saves and lists routines with validated progression rules', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    const routineId = await saveRoutine(db, {
      name: 'Push Day A',
      exercises: [
        {
          exercise_id: ex.id,
          group: null,
          sets: [
            { load_kg: 60, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
            { load_kg: 60, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
            { load_kg: 60, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
          ],
          rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 },
        },
      ],
    })

    expect(routineId).toBeGreaterThan(0)
    const routines = await listRoutines(db)
    expect(routines).toHaveLength(1)
    expect(routines[0]?.name).toBe('Push Day A')

    await db.close()
  })

  it('manages programs and determines scheduled routines by date', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    const r1 = await saveRoutine(db, {
      name: 'Legs A',
      exercises: [
        {
          exercise_id: ex.id,
          group: null,
          sets: [{ load_kg: 80, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }],
          rule: { kind: 'double', increment: 5, min_reps: 6, max_reps: 10, target_rir: 2 },
        },
      ],
    })

    const progId = await saveProgram(db, {
      name: '12-Week Strength',
      start_date: '2026-09-01',
      weeks: 12,
      schedule: [
        { day: 0, routine_id: r1 }, // Day 0 (Tuesday 2026-09-01)
      ],
    })
    expect(progId).toBeGreaterThan(0)

    const programs = await listPrograms(db)
    expect(programs).toHaveLength(1)

    const progDef = JSON.parse(programs[0]!.definition_json)
    // On start date (offset 0 days): scheduled routine is r1
    expect(scheduledRoutine(progDef, '2026-09-01')).toBe(r1)
    // Day 1 (2026-09-02): Rest day => null
    expect(scheduledRoutine(progDef, '2026-09-02')).toBeNull()
    // Day 7 (2026-09-08): Next cycle day 0 => r1
    expect(scheduledRoutine(progDef, '2026-09-08')).toBe(r1)
    // After 12 weeks: null
    expect(scheduledRoutine(progDef, '2027-01-01')).toBeNull()

    await db.close()
  })

  it('launches a routine into an active workout with planned sets initialized', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    const r1 = await saveRoutine(db, {
      name: 'Chest Focus',
      exercises: [
        {
          exercise_id: ex.id,
          group: null,
          sets: [
            { load_kg: 70, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
            { load_kg: 70, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
          ],
          rule: { kind: 'fixed', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 },
        },
      ],
    })

    const workoutId = await launchRoutine(db, r1, '2026-09-12', 10000)
    expect(workoutId).toBeGreaterThan(0)

    const detail = await workoutDetail(db, workoutId)
    expect(detail.workout.status).toBe('active')
    expect(detail.workout.routine_id).toBe(r1)
    expect(detail.exercises).toHaveLength(1)
    expect(detail.exercises[0]?.sets).toHaveLength(2)
    // Planned JSON is preserved for both sets
    expect(detail.exercises[0]?.sets[0]?.planned_json).not.toBeNull()
    expect(detail.exercises[0]?.sets[0]?.completed_at).toBeNull()

    await db.close()
  })
})
