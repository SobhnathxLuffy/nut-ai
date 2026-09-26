import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { kgToLb, lbToKg, LB_PER_KG } from '@nutai/analytics'
import { seedExercises, listExercises, startWorkout, addExercise, saveSet, workoutDetail } from '@nutai/training'
import { readWeightUnit, writeWeightUnit } from './weight-units'
import {
  getFieldLabels,
  formatLoadForDisplay,
  describeSet,
  setValuesToDisplay,
  canonicalizeFieldValue,
} from './workout-load'

describe('workout load units and conversions (BUG-009)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await migrate(db, Date.now())
    await seedExercises(db)
  })

  describe('unit conversion helpers', () => {
    it('provides correct field labels per unit preference', () => {
      const kgLabels = getFieldLabels('kg')
      expect(kgLabels.load_kg).toBe('Load (kg)')
      expect(kgLabels.assistance_kg).toBe('Assistance (kg)')
      expect(kgLabels.reps).toBe('Reps')

      const lbLabels = getFieldLabels('lb')
      expect(lbLabels.load_kg).toBe('Load (lb)')
      expect(lbLabels.assistance_kg).toBe('Assistance (lb)')
      expect(lbLabels.reps).toBe('Reps')
    })

    it('formats kg loads for display correctly in kg mode', () => {
      expect(formatLoadForDisplay(null, 'kg')).toBe('')
      expect(formatLoadForDisplay(0, 'kg')).toBe('0')
      expect(formatLoadForDisplay(2.5, 'kg')).toBe('2.5')
      expect(formatLoadForDisplay(22.5, 'kg')).toBe('22.5')
      expect(formatLoadForDisplay(100, 'kg')).toBe('100')
    })

    it('formats kg loads for display correctly in lb mode', () => {
      expect(formatLoadForDisplay(null, 'lb')).toBe('')
      expect(formatLoadForDisplay(0, 'lb')).toBe('0')
      // 100 lb canonical kg: 100 / LB_PER_KG
      const kgFor100Lb = lbToKg(100)
      expect(formatLoadForDisplay(kgFor100Lb, 'lb')).toBe('100')

      // 5.5 lb canonical kg
      const kgFor5Pt5Lb = lbToKg(5.5)
      expect(formatLoadForDisplay(kgFor5Pt5Lb, 'lb')).toBe('5.5')

      // 100 kg displayed in lb -> 220.46 lb
      expect(formatLoadForDisplay(100, 'lb')).toBe('220.46')
    })

    it('round-trips common imperial weights stably', () => {
      const testPounds = [0.5, 1.25, 2.5, 5, 5.5, 10, 25, 45, 100, 135, 185, 225, 315, 405]
      for (const lb of testPounds) {
        const canonicalKg = lbToKg(lb)
        const displayLb = formatLoadForDisplay(canonicalKg, 'lb')
        expect(Number(displayLb)).toBeCloseTo(lb, 2)
      }
    })

    it('canonicalizes field values correctly for kg vs lb', () => {
      // In kg mode, user inputs 100 -> stored as 100 kg
      const kgResult = canonicalizeFieldValue('load_kg', '100', 'kg')
      expect(kgResult.valid).toBe(true)
      expect(kgResult.value).toBe(100)

      // In lb mode, user inputs 100 -> stored as ~45.3592 kg
      const lbResult = canonicalizeFieldValue('load_kg', '100', 'lb')
      expect(lbResult.valid).toBe(true)
      expect(lbResult.value).toBeCloseTo(45.359237, 5)

      // Assistance in lb
      const assistResult = canonicalizeFieldValue('assistance_kg', '20', 'lb')
      expect(assistResult.valid).toBe(true)
      expect(assistResult.value).toBeCloseTo(20 / LB_PER_KG, 5)

      // Reps are never converted
      const repsResult = canonicalizeFieldValue('reps', '12', 'lb')
      expect(repsResult.valid).toBe(true)
      expect(repsResult.value).toBe(12)

      // Empty string becomes null
      const emptyResult = canonicalizeFieldValue('load_kg', '', 'lb')
      expect(emptyResult.valid).toBe(true)
      expect(emptyResult.value).toBeNull()

      // Invalid number is rejected
      const invalidResult = canonicalizeFieldValue('load_kg', 'abc', 'lb')
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.value).toBeNull()
    })

    it('formats set description according to preferred unit', () => {
      const set = {
        load_kg: 50,
        reps: 10,
        duration_s: null,
        distance_m: null,
        assistance_kg: null,
        rir: null,
        rpe: null,
        tempo: null,
      }
      expect(describeSet(set, 'kg')).toBe('50 Load (kg) · 10 Reps')
      expect(describeSet(set, 'lb')).toBe('110.23 Load (lb) · 10 Reps')

      const assistedSet = {
        load_kg: null,
        reps: 8,
        duration_s: null,
        distance_m: null,
        assistance_kg: 10,
        rir: null,
        rpe: null,
        tempo: null,
      }
      expect(describeSet(assistedSet, 'kg')).toBe('8 Reps · 10 Assistance (kg)')
      expect(describeSet(assistedSet, 'lb')).toBe('8 Reps · 22.05 Assistance (lb)')
    })
  })

  describe('end-to-end database lifecycle and safety', () => {
    it('stores canonical kg in DB when entered in lb mode and reloads as lb', async () => {
      // Set user preference to lb
      await writeWeightUnit(db, 'lb')
      expect(await readWeightUnit(db)).toBe('lb')

      const ex = (await listExercises(db))[0]!
      const workoutId = await startWorkout(db, '2026-09-20', 'Push Day', 1000)
      const exerciseRelId = await addExercise(db, workoutId, ex.id, 1100)

      // User enters 135 lb and 8 reps in UI
      const userEnteredLb = '135'
      const { value: canonicalLoadKg } = canonicalizeFieldValue('load_kg', userEnteredLb, 'lb')
      expect(canonicalLoadKg).toBeCloseTo(61.23497, 4)

      // Save set to database
      const setId = await saveSet(
        db,
        exerciseRelId,
        { load_kg: canonicalLoadKg as number, reps: 8 },
        { completed: true }
      )

      // Direct DB verification: load_kg column MUST be in kg
      const rawRow = await db.get<{ load_kg: number; reps: number }>(
        'SELECT load_kg, reps FROM workout_sets WHERE id = ?',
        [setId]
      )
      expect(rawRow?.load_kg).toBeCloseTo(61.23497, 4)
      expect(rawRow?.reps).toBe(8)

      // Reload workout detail and format for UI in lb mode
      const detail = await workoutDetail(db, workoutId)
      const savedSet = detail.exercises[0]?.sets[0]!
      expect(savedSet).toBeDefined()

      const displayValues = setValuesToDisplay(savedSet, 'lb')
      expect(displayValues.load_kg).toBe('135')
      expect(displayValues.reps).toBe('8')
    })

    it('preserves canonical data when user switches unit preference back and forth', async () => {
      const ex = (await listExercises(db))[0]!
      const workoutId = await startWorkout(db, '2026-09-20', 'Leg Day', 1000)
      const exId = await addExercise(db, workoutId, ex.id, 1100)

      // Saved originally in kg mode as 100 kg
      const setId = await saveSet(db, exId, { load_kg: 100, reps: 5 }, { completed: true })

      // Initial check in kg mode
      let unit = await readWeightUnit(db)
      expect(unit).toBe('kg')
      let detail = await workoutDetail(db, workoutId)
      let display = setValuesToDisplay(detail.exercises[0]?.sets[0]!, unit)
      expect(display.load_kg).toBe('100')

      // Switch preference to lb
      await writeWeightUnit(db, 'lb')
      unit = await readWeightUnit(db)
      expect(unit).toBe('lb')

      // In lb mode, display is 220.46 lb
      detail = await workoutDetail(db, workoutId)
      display = setValuesToDisplay(detail.exercises[0]?.sets[0]!, unit)
      expect(display.load_kg).toBe('220.46')

      // Crucial: canonical DB record is UNCHANGED
      const rawRow = await db.get<{ load_kg: number }>('SELECT load_kg FROM workout_sets WHERE id = ?', [setId])
      expect(rawRow?.load_kg).toBe(100)

      // Switch back to kg
      await writeWeightUnit(db, 'kg')
      unit = await readWeightUnit(db)
      expect(unit).toBe('kg')

      detail = await workoutDetail(db, workoutId)
      display = setValuesToDisplay(detail.exercises[0]?.sets[0]!, unit)
      expect(display.load_kg).toBe('100')
    })

    it('handles editing an existing set while in lb mode', async () => {
      await writeWeightUnit(db, 'lb')
      const ex = (await listExercises(db))[0]!
      const workoutId = await startWorkout(db, '2026-09-20', 'Pull Day', 1000)
      const exId = await addExercise(db, workoutId, ex.id, 1100)

      // Initially saved at 60 kg (e.g. from previous workout)
      const setId = await saveSet(db, exId, { load_kg: 60, reps: 5 }, { completed: false })

      // User reopens and types 185 lb
      const { value: newLoadKg } = canonicalizeFieldValue('load_kg', '185', 'lb')
      await saveSet(db, exId, { load_kg: newLoadKg as number, reps: 5 }, { id: setId, completed: true })

      // Check DB
      const updatedRow = await db.get<{ load_kg: number }>('SELECT load_kg FROM workout_sets WHERE id = ?', [setId])
      expect(updatedRow?.load_kg).toBeCloseTo(185 / LB_PER_KG, 4)

      // Check display
      const detail = await workoutDetail(db, workoutId)
      const display = setValuesToDisplay(detail.exercises[0]?.sets[0]!, 'lb')
      expect(display.load_kg).toBe('185')
    })
  })
})
