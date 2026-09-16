import { describe, expect, it } from 'vitest'
import { migrate } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { validateSet } from '@nutai/core-schema'
import {
  seedExercises,
  listExercises,
  createExercise,
  startWorkout,
  addExercise,
  EXERCISE_LIBRARY,
} from './index.js'

describe('TRN-001: Exercise and Equipment Schema & Tracking Types', () => {
  it('seeds over 200 factual exercises into the database', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const list = await listExercises(db)
    expect(list.length).toBeGreaterThan(200)

    const bench = list.find((e) => e.name === 'Barbell Bench Press')
    expect(bench).toBeDefined()
    expect(bench?.tracking_type).toBe('weight_reps')
    expect(bench?.primary_muscles).toContain('chest')
    expect(bench?.is_custom).toBe(0)

    await db.close()
  })

  it('EXERCISE_LIBRARY passes strict Zod validation without duplicate names', () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThan(200)
    expect(Object.isFrozen(EXERCISE_LIBRARY)).toBe(true)
    const names = new Set<string>()
    for (const exercise of EXERCISE_LIBRARY) {
      expect(exercise.name.length).toBeGreaterThan(0)
      expect(exercise.primary_muscles.length).toBeGreaterThan(0)
      expect(names.has(exercise.name)).toBe(false)
      names.add(exercise.name)
    }
  })

  it('allows creating valid custom exercises with stable UUID', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)

    const customId = await createExercise(db, {
      name: 'Custom Cable Crossover',
      tracking_type: 'weight_reps',
      primary_muscles: ['chest'],
      equipment: ['cable'],
      aliases: ['cable fly'],
    })

    expect(customId).toBeGreaterThan(0)
    const list = await listExercises(db)
    const created = list.find((e) => e.id === customId)
    expect(created).toBeDefined()
    expect(created?.is_custom).toBe(1)
    expect(created?.uuid).toBeDefined()
    expect(created?.aliases).toContain('cable fly')

    await db.close()
  })

  it('validates set values according to tracking type', () => {
    // weight_reps accepts load_kg and reps
    expect(() =>
      validateSet('weight_reps', { load_kg: 50, reps: 10 }),
    ).not.toThrow()

    // weight_reps rejects distance_m
    expect(() =>
      validateSet('weight_reps', { load_kg: 50, reps: 10, distance_m: 100 }),
    ).toThrow('distance_m is incompatible with weight_reps')

    // time accepts duration_s only
    expect(() =>
      validateSet('time', { duration_s: 60 }),
    ).not.toThrow()
    expect(() =>
      validateSet('time', { duration_s: 60, load_kg: 20 }),
    ).toThrow('load_kg is incompatible with time')

    // assisted requires assistance_kg and reps
    expect(() =>
      validateSet('assisted', { assistance_kg: 15, reps: 8 }),
    ).not.toThrow()
    expect(() =>
      validateSet('assisted', { load_kg: 15, reps: 8 }),
    ).toThrow('load_kg is incompatible with assisted')
  })

  it('enforces database trigger constraints on workout_sets', async () => {
    const db = openMemoryDb()
    await migrate(db, 1000)
    await seedExercises(db)
    const bench = (await listExercises(db)).find((e) => e.name === 'Barbell Bench Press')!

    const w = await startWorkout(db, '2026-09-12')
    const we = await addExercise(db, w, bench.id)

    // Direct SQL insert violating tracking type triggers ABORT
    await expect(
      db.run(
        `INSERT INTO workout_sets (uuid, workout_exercise_id, sort_order, load_kg, distance_m, created_at)
         VALUES ('11111111-1111-7111-8111-111111111111', ?, 0, 50, 1000, ?)`,
        [we, Date.now()],
      ),
    ).rejects.toThrow('Invalid fields for exercise tracking type')

    // Cannot modify historical tracking type
    await expect(
      db.run(`UPDATE workout_exercises SET tracking_type = 'time' WHERE id = ?`, [we]),
    ).rejects.toThrow('Replace exercise instead of changing historical tracking type')

    await db.close()
  })
})
