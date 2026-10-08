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
  weekdayOfLocalDate,
  weekdayToCycleDay,
  cycleDayToWeekday,
  programDayStatus,
  programWeekOf,
  programWeekAdherence,
  computeTrainingStreak,
  offsetLocalDate,
  deleteRoutine,
  finishWorkout,
  saveSet,
  performanceHistory,
  defaultSetsFor,
  insertWarmupRamp,
  detectSessionPRs,
  reopenWorkout,
  startWorkout,
  addExercise,
} from './index.js'
import { ProgramInput } from '@nutai/core-schema'

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

  // Owner QA 2026-10: the editor stored calendar weekday indexes while the
  // engine reads cycle days — "I scheduled Wed and nothing ever ran". The
  // conversion helpers below are the contract the UI now sits on: the user
  // picks real weekdays, save/load converts at that single boundary.
  it('interconverts calendar weekdays and cycle days (schedule bug regression)', () => {
    // 2026-09-01 is a Tuesday.
    expect(weekdayOfLocalDate('2026-09-01')).toBe(2)
    // "Wednesday" with a Tuesday start is cycle day 1 — not the raw index 3.
    expect(weekdayToCycleDay(3, '2026-09-01')).toBe(1)
    // Sunday with a Tuesday start wraps forward to cycle day 5.
    expect(weekdayToCycleDay(0, '2026-09-01')).toBe(5)
    // The start date's own weekday is always cycle day 0.
    expect(weekdayToCycleDay(2, '2026-09-01')).toBe(0)
    // Round trip: cycle day back to the weekday it was picked from.
    expect(cycleDayToWeekday(1, '2026-09-01')).toBe(3)
    expect(cycleDayToWeekday(5, '2026-09-01')).toBe(0)
    // End-to-end: a user who assigns a routine to Wednesday on a program
    // starting Tuesday 2026-09-01 gets a workout on real Wednesdays.
    const plan = {
      name: 'Wed Plan',
      start_date: '2026-09-01',
      weeks: 4,
      schedule: [{ day: weekdayToCycleDay(3, '2026-09-01'), routine_id: 1 }],
    }
    expect(scheduledRoutine(plan, '2026-09-02')).toBe(1) // Wed, week 1
    expect(scheduledRoutine(plan, '2026-09-01')).toBeNull() // Tue, start day: rest
    expect(scheduledRoutine(plan, '2026-09-09')).toBe(1) // Wed, week 2
  })

  it('reports program day status for before/rest/scheduled/finished', () => {
    const plan = {
      name: 'Block',
      start_date: '2026-09-01',
      weeks: 2,
      schedule: [{ day: 0, routine_id: 7 }],
    }
    expect(programDayStatus(plan, '2026-08-30')).toEqual({ kind: 'before', daysUntil: 2 })
    expect(programDayStatus(plan, '2026-09-01')).toEqual({ kind: 'scheduled', routineId: 7 })
    expect(programDayStatus(plan, '2026-09-02')).toEqual({ kind: 'rest' })
    expect(programDayStatus(plan, '2026-09-15')).toEqual({ kind: 'finished' })
  })

  it('updates an existing program when saveProgram is called with an id', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!
    const r1 = await saveRoutine(db, {
      name: 'Full Body',
      exercises: [
        {
          exercise_id: ex.id,
          group: null,
          sets: [{ load_kg: 50, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }],
          rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 },
        },
      ],
    })

    const progId = await saveProgram(db, {
      name: 'Old Name',
      start_date: '2026-09-01',
      weeks: 8,
      schedule: [{ day: 0, routine_id: r1 }],
    })
    // Edit: same id, new name and weeks.
    await saveProgram(
      db,
      {
        name: 'Edited Block',
        start_date: '2026-09-01',
        weeks: 12,
        schedule: [{ day: 0, routine_id: r1 }],
      },
      progId,
    )
    const programs = await listPrograms(db)
    expect(programs).toHaveLength(1)
    const def = JSON.parse(programs[0]!.definition_json)
    expect(programs[0]!.name).toBe('Edited Block')
    expect(def.weeks).toBe(12)

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

  // T-IMPL-B A2/A3/H: history spans ALL completed workouts (any routine), the
  // engine's explanation surfaces on the workout row, and planned_json keeps
  // the ROUTINE's plan instead of the progressed values.
  it('progresses from a session logged under a DIFFERENT routine, keeps the plan, and stores the why', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!

    const sets = (load: number, reps: number) => [
      { load_kg: load, reps, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
      { load_kg: load, reps, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null },
    ]
    const rule = { kind: 'double' as const, increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 }

    // Session 1: an EMPTY workout (no routine at all — the live-session path).
    const wid = await startWorkout(db, '2026-09-10', 'Empty workout', 1000)
    const weid = await addExercise(db, wid, ex.id, 1100)
    await saveSet(db, weid, sets(60, 8)[0]!, { completed: true }, 1200)
    await saveSet(db, weid, sets(60, 8)[1]!, { completed: true }, 1300)
    await finishWorkout(db, wid, 1400)

    // The user then saves this session as routine "From Session" and launches
    // it later: progression must read the empty-workout history.
    const r2 = await saveRoutine(db, {
      name: 'From Session',
      exercises: [{ exercise_id: ex.id, group: null, sets: sets(60, 8), rule }],
    })
    const wid2 = await launchRoutine(db, r2, '2026-09-17', 5000)
    const detail = await workoutDetail(db, wid2)
    // A2: +1 rep per slot from the cross-routine/cross-workout history.
    expect(detail.exercises[0]?.sets[0]?.reps).toBe(9)
    expect(detail.exercises[0]?.sets[0]?.load_kg).toBe(60)
    // H: planned_json stays the ROUTINE's plan (60×8), NOT the progressed 60×9.
    const plan = JSON.parse(detail.exercises[0]!.sets[0]!.planned_json!)
    expect(plan.reps).toBe(8)
    // A3: the why rides the workout row for the "This week" banner.
    expect(detail.workout.progression_note).toContain(ex.name)
    expect(detail.workout.progression_note!.toLowerCase()).toContain('rep')

    await db.close()
  })

  it('leaves the plan and the note untouched when there is no history yet', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!
    const r1 = await saveRoutine(db, {
      name: 'Fresh',
      exercises: [{ exercise_id: ex.id, group: null, sets: [{ load_kg: 60, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }], rule: { kind: 'fixed', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 } }],
    })
    const wid = await launchRoutine(db, r1, '2026-09-12', 10000)
    const detail = await workoutDetail(db, wid)
    expect(detail.exercises[0]?.sets[0]?.load_kg).toBe(60)
    expect(detail.workout.progression_note).toBeNull()
    await db.close()
  })

  it('defaultSetsFor seeds from the last completed session and falls back to the type table', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!
    const wid = await startWorkout(db, '2026-09-10', 'Empty workout', 1000)
    const weid = await addExercise(db, wid, ex.id, 1100)
    const set = (reps: number) => ({ load_kg: 70, reps, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null })
    await saveSet(db, weid, set(10), { completed: true }, 1200)
    await saveSet(db, weid, set(11), { completed: true }, 1300)
    await saveSet(db, weid, set(10), { completed: true }, 1400)
    await finishWorkout(db, wid, 1500)

    const history = await performanceHistory(db)
    const seeded = defaultSetsFor({ id: ex.id, tracking_type: ex.tracking_type }, history)
    expect(seeded).toHaveLength(3) // the session's three logged sets, in slot order
    expect(seeded[0]).toEqual(set(10))
    expect(seeded[1]).toEqual(set(11))
    expect(seeded[2]).toEqual(set(10))

    // Never-logged exercise falls back to the ONE shared type table.
    const fallback = defaultSetsFor({ id: 999999, tracking_type: 'weight_reps' }, history)
    expect(fallback).toHaveLength(3)
    expect(fallback[0]?.load_kg).toBe(20)
    expect(fallback[0]?.reps).toBe(10)
    await db.close()
  })

  it('deleting a routine strips it from program schedules in the same action (T-IMPL-B D)', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!
    const mkRoutine = async (name: string) =>
      saveRoutine(db, {
        name,
        exercises: [{ exercise_id: ex.id, group: null, sets: [{ load_kg: 50, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }], rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 } }],
      })
    const r1 = await mkRoutine('Doomed')
    const r2 = await mkRoutine('Survivor')

    // Program A schedules ONLY r1; program B schedules r1 and r2.
    const pa = await saveProgram(db, { name: 'Only Doomed', start_date: '2026-09-01', weeks: 8, schedule: [{ day: 0, routine_id: r1 }] })
    await saveProgram(db, { name: 'Mixed', start_date: '2026-09-01', weeks: 8, schedule: [{ day: 0, routine_id: r1 }, { day: 1, routine_id: r2 }] })

    await deleteRoutine(db, r1, 5000)

    const programs = await listPrograms(db)
    // Program A had nothing left to schedule — an empty schedule is not a program.
    expect(programs.find((p) => p.id === pa)).toBeUndefined()
    const mixed = ProgramInput.parse(JSON.parse(programs.find((p) => p.name === 'Mixed')!.definition_json))
    expect(mixed.schedule.map((s) => s.routine_id)).toEqual([r2])
    // The routine itself is gone from the list.
    expect((await listRoutines(db)).find((r) => r.id === r1)).toBeUndefined()
    await db.close()
  })

  it('reports Week N of M from the sanctioned day math (T-IMPL-B F2)', () => {
    // Week math is pure: the same days-from-start ÷ 7 formula scheduledRoutine
    // uses — never a second day language.
    const plan = { name: 'Block', start_date: '2026-09-01', weeks: 4, schedule: [{ day: 0, routine_id: 1 }] }
    expect(programWeekOf(plan, '2026-09-01')).toBe(1)
    expect(programWeekOf(plan, '2026-09-07')).toBe(1)
    expect(programWeekOf(plan, '2026-09-08')).toBe(2)
    expect(programWeekOf(plan, '2026-08-31')).toBeNull() // before the block
    expect(programWeekOf(plan, '2026-09-29')).toBeNull() // after 4 weeks
  })

  it('adherence counts scheduled dates vs completed sessions for the current week', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!
    const r1 = await saveRoutine(db, {
      name: 'Pull A',
      exercises: [{ exercise_id: ex.id, group: null, sets: [{ load_kg: 50, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }], rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 } }],
    })
    // A start date whose weekday is the same as the anchor date's, so BOTH
    // dates are scheduled (cycle day 0): anchor = start + 7.
    const anchor = '2026-09-09'
    const start = offsetLocalDate(anchor, -7)
    const cycleDay = weekdayToCycleDay(weekdayOfLocalDate(anchor), start)
    await saveProgram(db, { name: 'Block', start_date: start, weeks: 4, schedule: [{ day: cycleDay, routine_id: r1 }] })
    const planDef = { name: 'Block', start_date: start, weeks: 4, schedule: [{ day: cycleDay, routine_id: r1 }] }
    expect(programWeekOf(planDef, anchor)).toBe(2)

    // No completed session yet: scheduled but none done.
    const before = await programWeekAdherence(db, planDef, anchor)
    expect(before.week).toBe(2)
    expect(before.scheduledDates).toContain(anchor)
    expect(before.completedDates).toEqual([])

    // A completed workout on the anchor date flips the slot to done.
    const wid = await startWorkout(db, anchor, 'Pull A', 1000)
    const weid = await addExercise(db, wid, ex.id, 1100)
    await saveSet(db, weid, { load_kg: 50, reps: 10, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }, { completed: true }, 1200)
    await finishWorkout(db, wid, 1300)
    const after = await programWeekAdherence(db, planDef, anchor)
    expect(after.completedDates).toEqual([anchor])
    await db.close()
  })

  it('counts a simple, labeled training streak of consecutive calendar weeks', () => {
    // 2026-09-07 is a Monday; weeks are Monday-aligned and the current week
    // counts once it already has a session.
    const weeks = ['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-21', '2026-09-23']
    expect(computeTrainingStreak(weeks, '2026-09-24')).toBe(3)
    // The streak breaks when a whole week has no session.
    expect(computeTrainingStreak(['2026-09-07', '2026-09-21'], '2026-09-22')).toBe(1)
    // No session yet in the current week: the streak reads 0 (it does not
    // reach back and use last week to flatter the number).
    expect(computeTrainingStreak(['2026-09-07'], '2026-09-14')).toBe(0)
    expect(computeTrainingStreak([], '2026-09-14')).toBe(0)
  })

  it('inserts a warm-up ramp before the first working set, exactly once (T-IMPL-B I)', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db))[0]!
    const r1 = await saveRoutine(db, {
      name: 'Ramp Me',
      exercises: [{ exercise_id: ex.id, group: null, sets: [{ load_kg: 100, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }, { load_kg: 100, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }], rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 } }],
    })
    const wid = await launchRoutine(db, r1, '2026-09-12', 10000)
    const weid = (await workoutDetail(db, wid)).exercises[0]!.id

    await insertWarmupRamp(db, weid, 20000)
    const detail = await workoutDetail(db, wid)
    const sets = detail.exercises[0]!.sets
    expect(sets).toHaveLength(5)
    const warmups = sets.filter((s) => s.kind === 'warmup')
    expect(warmups.map((s) => [s.load_kg, s.reps])).toEqual([[40, 5], [70, 3], [90, 1]])
    // The ramp sits BEFORE the working sets in order, and the working sets
    // kept their planned values.
    const working = sets.filter((s) => s.kind === 'normal')
    expect(working.map((s) => s.load_kg)).toEqual([100, 100])
    expect(sets.findIndex((s) => s.kind === 'warmup')).toBeLessThan(sets.findIndex((s) => s.kind === 'normal'))

    // A second ramp is refused — one ramp per exercise.
    await expect(insertWarmupRamp(db, weid, 21000)).rejects.toThrow('already has a warm-up ramp')
    await db.close()
  })

  // T-IMPL-B A1 "+1 set": when the rep ladder tops out, launchRoutine appends
  // ONE extra set (the ladder-restart prescription), once per exercise.
  it('appends one extra set at launch when a bodyweight exercise hit max_reps (A1)', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db)).find((e) => e.tracking_type === 'bodyweight_reps')!

    // Session 1: two sets at the 12-rep ceiling (bodyweight_reps rows still
    // carry a load cell — 0 for pure bodyweight, the engine's completion rule).
    const wid0 = await startWorkout(db, '2026-09-10', 'Empty workout', 1000)
    const weid0 = await addExercise(db, wid0, ex.id, 1100)
    const ceiling = { load_kg: 0, reps: 12, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }
    await saveSet(db, weid0, ceiling, { completed: true }, 1200)
    await saveSet(db, weid0, ceiling, { completed: true }, 1300)
    await finishWorkout(db, wid0, 1400)

    const r1 = await saveRoutine(db, {
      name: 'Bodyweight Block',
      exercises: [{ exercise_id: ex.id, group: null, sets: [ceiling, ceiling], rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 } }],
    })
    const wid = await launchRoutine(db, r1, '2026-09-17', 5000)
    const detail = await workoutDetail(db, wid)
    const sets = detail.exercises[0]!.sets
    // The routine authors 2 sets; the ceiling grants a THIRD.
    expect(sets).toHaveLength(3)
    expect(sets.map((s) => s.reps)).toEqual([8, 8, 8])
    expect(sets[2]!.planned_json).not.toBeNull()
    expect(detail.workout.progression_note).toContain('one more set added')
    await db.close()
  })

  // T-IMPL-B F4: a finish-time PR banner backed by the same Epley window the
  // Progress charts use — a better e1RM than EVERY previous session wins.
  it('detectSessionPRs flags a session that beats every previous e1RM', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const ex = (await listExercises(db)).find((e) => e.name === 'Barbell Bench Press')!

    const logSession = async (load: number, reps: number, at: number) => {
      const wid = await startWorkout(db, '2026-09-10', 'Bench', at)
      const weid = await addExercise(db, wid, ex.id, at + 100)
      await saveSet(db, weid, { load_kg: load, reps, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }, { completed: true }, at + 200)
      await finishWorkout(db, wid, at + 300)
      return wid
    }
    await logSession(80, 8, 1000) // e1RM ≈ 101.3
    const better = await logSession(90, 8, 90000) // e1RM ≈ 114

    const prsBetter = await detectSessionPRs(db, better)
    expect(prsBetter).toEqual([{ name: ex.name, e1rm_kg: Math.round(90 * (1 + 8 / 30) * 100) / 100 }])
    // The later, weaker session is NOT a PR (90×8 stands), even once a
    // warm-up ramp rides along — warmup rows never win a PR.
    const weaker = await logSession(85, 8, 170000) // e1RM ≈ 107.6 — below 114
    await reopenWorkout(db, weaker, 175000)
    const weid = (await workoutDetail(db, weaker)).exercises[0]!.id
    await insertWarmupRamp(db, weid, 176000)
    expect(await detectSessionPRs(db, weaker)).toEqual([])
    await db.close()
  })
})
