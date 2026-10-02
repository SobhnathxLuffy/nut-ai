import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Performance, WorkoutExercise } from '@nutai/training'
import {
  circuitMemberLabel,
  compactPrevious,
  exerciseBlocks,
  nextFocusIndex,
  previousBySetSlot,
  primaryFields,
  restClockLabel,
  shortFieldLabel,
} from './set-table'

/**
 * UI/UX report Ch. 8.5 (Wave 3) — the Hevy set table. The pure helpers are
 * exercised directly; the screen itself is source-swept below (the repo's
 * established pattern for RN screens that cannot mount in the node
 * environment — see PressableFX.test.ts / Empty.test.ts).
 */

const here = dirname(fileURLToPath(import.meta.url))
const workoutSource = readFileSync(join(here, '../../app/workout.tsx'), 'utf8')
const sheetSource = readFileSync(join(here, '../components/Sheet.tsx'), 'utf8')
const logExerciseSource = readFileSync(join(here, '../../app/log-exercise.tsx'), 'utf8')

describe('primaryFields — the set-table value columns', () => {
  it('weight_reps is load then reps (the Hevy weight × reps columns)', () => {
    expect(primaryFields('weight_reps')).toEqual(['load_kg', 'reps'])
  })

  it('every tracking type resolves to one or two columns', () => {
    const types = [
      'weight_reps',
      'bodyweight_reps',
      'distance_time',
      'time',
      'reps',
      'weight_time',
      'distance',
      'assisted',
    ] as const
    for (const t of types) {
      const fields = primaryFields(t)
      expect(fields.length).toBeGreaterThanOrEqual(1)
      expect(fields.length).toBeLessThanOrEqual(2)
    }
  })

  it('distance_time is distance then duration', () => {
    expect(primaryFields('distance_time')).toEqual(['distance_m', 'duration_s'])
  })
})

describe('compactPrevious — the muted mono previous cell', () => {
  it('weight × reps with bare numbers (units ride the column header)', () => {
    expect(compactPrevious({ load_kg: 60, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }, ['load_kg', 'reps'], 'kg')).toBe('60×8')
  })

  it('converts kg history to the user’s lb display', () => {
    expect(compactPrevious({ load_kg: 60, reps: 8, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }, ['load_kg', 'reps'], 'lb')).toBe('132.28×8')
  })

  it('time and distance render with their short units', () => {
    const distanceTime = { load_kg: null, reps: null, duration_s: 45, distance_m: 1000, assistance_kg: null, rir: null, rpe: null, tempo: null }
    expect(compactPrevious(distanceTime, ['distance_m', 'duration_s'], 'kg')).toBe('1000m×45s')
    const time = { load_kg: null, reps: null, duration_s: 60, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }
    expect(compactPrevious(time, ['duration_s'], 'kg')).toBe('60s')
  })

  it('null and empty history render the em dash', () => {
    expect(compactPrevious(null, ['load_kg', 'reps'], 'kg')).toBe('—')
    const empty = { load_kg: null, reps: null, duration_s: null, distance_m: null, assistance_kg: null, rir: null, rpe: null, tempo: null }
    expect(compactPrevious(empty, ['load_kg', 'reps'], 'kg')).toBe('—')
  })
})

describe('previousBySetSlot — per-row previous from performanceHistory', () => {
  const row = (over: Partial<Performance> & { exercise_id: number; sort_order: number }): Performance & { sort_order: number } => ({
    load_kg: null,
    reps: null,
    duration_s: null,
    distance_m: null,
    assistance_kg: null,
    rir: null,
    rpe: null,
    tempo: null,
    id: 1,
    workout_id: 1,
    at: 1,
    local_date: '2026-01-01',
    tracking_type: 'weight_reps',
    kind: 'normal',
    ...over,
  })

  it('the most recent session wins per exercise per set slot', () => {
    // Rows arrive ASC by finished_at: old workout first, newer second.
    const map = previousBySetSlot([
      row({ id: 1, exercise_id: 10, sort_order: 0, workout_id: 1, at: 100, load_kg: 40, reps: 8 }),
      row({ id: 2, exercise_id: 10, sort_order: 0, workout_id: 2, at: 200, load_kg: 50, reps: 10 }),
      row({ id: 3, exercise_id: 10, sort_order: 1, workout_id: 2, at: 200, load_kg: 50, reps: 8 }),
      row({ id: 4, exercise_id: 11, sort_order: 0, workout_id: 2, at: 200, load_kg: 20, reps: 12 }),
    ])
    expect(map.get(10)?.get(0)).toMatchObject({ load_kg: 50, reps: 10 })
    expect(map.get(10)?.get(1)).toMatchObject({ load_kg: 50, reps: 8 })
    expect(map.get(11)?.get(0)).toMatchObject({ load_kg: 20, reps: 12 })
  })

  it('rows without sort_order are skipped, not collapsed into slot 0', () => {
    const missing = { ...row({ exercise_id: 10, sort_order: 0 }) }
    delete (missing as { sort_order?: number }).sort_order
    const broken = previousBySetSlot([missing as unknown as Performance])
    expect(broken.get(10)).toBeUndefined()
  })
})

describe('exerciseBlocks — linked superset groups on one tinted token', () => {
  const ex = (id: number, superset: string | null, exerciseId = id): WorkoutExercise => ({
    id,
    exercise_id: exerciseId,
    workout_id: 1,
    name: `Exercise ${id}`,
    tracking_type: 'weight_reps',
    sort_order: id,
    superset_group_id: superset,
    notes: '',
    sets: [],
    previous: null,
  })

  it('consecutive members of one group collapse into a single tinted block', () => {
    const blocks = exerciseBlocks([ex(1, null), ex(2, 'g1'), ex(3, 'g1'), ex(4, null)])
    expect(blocks).toEqual([
      { kind: 'single', exercise: ex(1, null) },
      { kind: 'group', letter: 'A', exercises: [ex(2, 'g1'), ex(3, 'g1')] },
      { kind: 'single', exercise: ex(4, null) },
    ])
  })

  it('groups get letters by first appearance; members keep their positions', () => {
    const blocks = exerciseBlocks([ex(1, 'g1'), ex(2, 'g1'), ex(3, 'g2'), ex(4, 'g2')])
    expect(blocks[0]).toMatchObject({ kind: 'group', letter: 'A' })
    expect(blocks[1]).toMatchObject({ kind: 'group', letter: 'B' })
    expect(circuitMemberLabel('A', 0)).toBe('A1')
    expect(circuitMemberLabel('A', 1)).toBe('A2')
    expect(circuitMemberLabel('B', 0)).toBe('B1')
  })

  it('a group split by an outsider renders as two runs of the SAME letter (still linked)', () => {
    const blocks = exerciseBlocks([ex(1, 'g1'), ex(2, null), ex(3, 'g1')])
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ kind: 'group', letter: 'A' })
    expect(blocks[1]).toMatchObject({ kind: 'single' })
    expect(blocks[2]).toMatchObject({ kind: 'group', letter: 'A' })
  })
})

describe('restClockLabel — the chip countdown', () => {
  it('formats mm:ss with zero padding', () => {
    expect(restClockLabel(90)).toBe('1:30')
    expect(restClockLabel(5)).toBe('0:05')
    expect(restClockLabel(0)).toBe('0:00')
    expect(restClockLabel(600)).toBe('10:00')
  })

  it('never goes negative', () => {
    expect(restClockLabel(-3)).toBe('0:00')
  })
})

describe('nextFocusIndex — check auto-advance', () => {
  const set = (id: number, completed: boolean) => ({ id, completed_at: completed ? 1 : null })

  it('advances to the next open row, skipping already-completed rows', () => {
    const sets = [set(1, true), set(2, true), set(3, false), set(4, false)]
    expect(nextFocusIndex(sets, 0)).toBe(2)
    expect(nextFocusIndex(sets, 2)).toBe(3)
  })

  it('returns null at the end of the table (no phantom focus)', () => {
    expect(nextFocusIndex([set(1, false), set(2, false)], 1)).toBeNull()
  })
})

describe('shortFieldLabel — column headers', () => {
  it('routes loads through the unit, keeps the rest fixed', () => {
    expect(shortFieldLabel('load_kg', 'kg')).toBe('KG')
    expect(shortFieldLabel('load_kg', 'lb')).toBe('LB')
    expect(shortFieldLabel('assistance_kg', 'lb')).toBe('LB')
    expect(shortFieldLabel('reps', 'kg')).toBe('REPS')
    expect(shortFieldLabel('duration_s', 'kg')).toBe('SEC')
    expect(shortFieldLabel('distance_m', 'kg')).toBe('M')
  })
})

describe('workout.tsx source invariants (Ch. 8.5 contract)', () => {
  it('the check completes a set with the light-impact haptic then auto-advances', () => {
    // The haptic fires on completion only (Table 9.2), before the persist.
    expect(workoutSource).toContain('void hapticLightImpact()')
    const onCheck = workoutSource.slice(workoutSource.indexOf('const onCheck = () =>'))
    expect(onCheck.indexOf('hapticLightImpact()')).toBeLessThan(onCheck.indexOf('persist(draft.current, true'))
    // Auto-advance: the parent focuses the next open row.
    expect(workoutSource).toContain('onChecked(index)')
    expect(workoutSource).toContain('nextFocusIndex(e.sets, index)')
    expect(workoutSource).toContain('firstInputRefs.current[focus]?.focus()')
  })

  it('completed rows keep their data: affirm tint + strikethrough, never removal', () => {
    expect(workoutSource).toContain("completed ? t.affirmTint : 'transparent'")
    expect(workoutSource).toContain("textDecorationLine: completed ? 'line-through' : 'none'")
  })

  it('the context menu groups the twelve collapsed actions (Sets / Exercise / Superset / Tools)', () => {
    for (const caption of ['caption: \'Sets\'', 'caption: \'Exercise\'', 'caption: \'Superset\'', 'caption: \'Tools\'']) {
      expect(workoutSource).toContain(caption)
    }
    // Every audited action still routes somewhere.
    const actions = [
      'Add set',
      'Duplicate set',
      'Delete set',
      'Replace exercise',
      'Move up',
      'Remove exercise',
      'Select for circuit',
      'Remove from circuit',
      'Notes',
      'Skip rest',
      'Plate helper',
      'Save as routine',
    ]
    for (const label of actions) {
      expect(workoutSource).toContain(label)
    }
  })

  it('the exact domain calls survive the rebuild (UI-layer change only)', () => {
    for (const call of [
      'saveSet(await db(), e.id, next, { id: s.id, completed, kind: nextKind, restSeconds })',
      'await removeSet(await db(), lastSet.id)',
      'await editWorkoutExercise(h, e.id, { sort_order: previousExercise.sort_order })',
      'await editWorkoutExercise(await db(), e.id, { deleted_at: Date.now() })',
      'await editWorkoutExercise(await db(), e.id, { superset_group_id: null })',
      'await groupExercises(await db(), w.id, group)',
      'await saveRoutine(await db(), {',
      'finishWorkout(await db(), w.id)',
      'await discardWorkout(await db(), w.id)',
      'reopenWorkout(await db(), w.id)',
      'undoLastOperation()',
      'redoLastOperation()',
    ]) {
      expect(workoutSource).toContain(call)
    }
  })

  it('the rest chip is persistent, skips on tap, and pulses at zero', () => {
    expect(workoutSource).toContain('function RestChip(')
    expect(workoutSource).toContain('Animated.loop(')
    expect(workoutSource).toContain('restClockLabel(rest)')
    expect(workoutSource).toContain('onSkip={skipRest}')
    // ±15s tuning rides the chip (P2-8 capability preserved at the surface).
    expect(workoutSource).toContain('onAdjust(-15)')
    expect(workoutSource).toContain('onAdjust(15)')
  })

  it('supersets tint through ONE token — stateLayerFor selected, no ad-hoc alphas', () => {
    expect(workoutSource).toContain('stateLayerFor(t.isDark)')
    expect(workoutSource).toContain('layers.selected.backgroundColor')
    expect(workoutSource).not.toMatch(/10b981|emerald/i)
    expect(workoutSource).not.toMatch(/backgroundColor:\s*'#/)
  })

  it('the sheet primitive is the FAB pattern: radius.sheet, spring, no haptic on open', () => {
    expect(sheetSource).toContain('radius.sheet')
    expect(sheetSource).toContain('Animated.spring(')
    // Table 9.2: sheets stay silent — no haptics import at all.
    expect(sheetSource).not.toContain("from '../utils/haptics'")
    expect(sheetSource).toContain('SHEET_DISMISS_DY')
  })
})

describe('log-exercise wizard: four screens → two (Ch. 8.5)', () => {
  it('the pick screen carries search, the owned-equipment filter, recents, and the calorie paths', () => {
    expect(logExerciseSource).toContain('Search exercises')
    expect(logExerciseSource).toContain('Filter by owned equipment')
    expect(logExerciseSource).toContain('Recents: the exercises you actually performed')
    for (const title of ['Run', 'Weight lifting', 'Describe', 'Manual']) {
      expect(logExerciseSource).toContain(`title: '${title}'`)
    }
  })

  it('the configure screen is one sets card + Add to workout', () => {
    expect(logExerciseSource).toContain('>Sets</Text>')
    expect(logExerciseSource).toContain('Add set')
    expect(logExerciseSource).toContain('Add to workout')
    // Same table dialect as the live workout: tracked fields + mono numbers.
    expect(logExerciseSource).toContain('primaryFields(exercise.tracking_type)')
    expect(logExerciseSource).toContain('type.monoData')
  })

  it('the strength path writes through the exact workout domain calls', () => {
    expect(logExerciseSource).toContain('startWorkout(h, localDate(Date.now()))')
    expect(logExerciseSource).toContain('addExercise(h, workoutId, exercise.id)')
    expect(logExerciseSource).toContain('saveSet(h, workoutExerciseId, row.parsed!')
  })

  it('duplicate adds stay a toast with an action (§10.1), never a blocking alert', () => {
    expect(logExerciseSource).toContain('isExerciseInWorkout(h, workoutId, exercise.id)')
    expect(logExerciseSource).toContain('Add again')
    expect(logExerciseSource).not.toContain('Alert.alert')
  })

  it('the calorie paths survive the compression (deterministic MET, model describe, manual)', () => {
    expect(logExerciseSource).toContain('exerciseKcal(exercise, level, kg, mins)')
    expect(logExerciseSource).toContain('runExerciseEstimate(')
    expect(logExerciseSource).toContain('await logExercise(name, kcal, Date.now())')
  })
})
