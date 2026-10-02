import type { Performance, WorkoutExercise } from '@nutai/training'
import type { SetValues, TrackingType } from '@nutai/core-schema'
import { TRACKING_FIELDS } from '@nutai/core-schema'
import type { WeightUnit } from '@nutai/analytics'
import { formatLoadForDisplay } from './workout-load'

/**
 * Pure UI-layer helpers for the Hevy-style set table (UI/UX report Ch. 8.5,
 * Wave 3). Everything here is derived from the SAME domain calls the workout
 * screen already makes — `workoutDetail` + `performanceHistory` — no new
 * package code, no new data shape crossing a boundary.
 */

/**
 * The set-table columns. Hevy's table is number / previous / weight / reps /
 * check; Nut AI exercises track one or two numeric fields per set
 * (TRACKING_FIELDS), so the two value columns are simply the exercise's own
 * primary fields — "weight × reps" for the iron, "distance × duration" for
 * the clock work.
 */
export function primaryFields(trackingType: TrackingType): readonly (keyof SetValues)[] {
  return TRACKING_FIELDS[trackingType].slice(0, 2)
}

/**
 * Per-row previous values, derived from `performanceHistory` (an existing
 * @nutai/training call): for each exercise, the value of each set slot in the
 * most recent COMPLETED session that logged it. Rows arrive ordered by
 * finished_at ASC, so overwriting as we walk leaves the newest session's
 * values in the map. (`sort_order` rides the same SELECT (s.*) but is not
 * declared on the Performance interface, hence the optional widening.)
 */
export function previousBySetSlot(
  rows: readonly (Performance & { sort_order?: number })[],
): Map<number, Map<number, SetValues>> {
  const byExercise = new Map<number, Map<number, SetValues>>()
  for (const row of rows) {
    if (row.sort_order == null) continue
    let slots = byExercise.get(row.exercise_id)
    if (!slots) {
      slots = new Map<number, SetValues>()
      byExercise.set(row.exercise_id, slots)
    }
    slots.set(row.sort_order, {
      load_kg: row.load_kg,
      reps: row.reps,
      duration_s: row.duration_s,
      distance_m: row.distance_m,
      assistance_kg: row.assistance_kg,
      rir: row.rir,
      rpe: row.rpe,
      tempo: row.tempo,
    })
  }
  return byExercise
}

/** Compact previous summary for one table cell: "60×8", "45 s", "—". */
export function compactPrevious(
  values: SetValues | null,
  fields: readonly (keyof SetValues)[],
  unit: WeightUnit,
): string {
  if (!values) return '—'
  const parts: string[] = []
  for (const key of fields) {
    const value = values[key]
    if (value === null || value === undefined || value === '') continue
    if ((key === 'load_kg' || key === 'assistance_kg') && typeof value === 'number') {
      // Bare number — the unit rides the column header ("PREV" + "KG").
      parts.push(formatLoadForDisplay(value, unit))
    } else if (key === 'duration_s') {
      parts.push(`${value}s`)
    } else if (key === 'distance_m') {
      parts.push(`${value}m`)
    } else {
      parts.push(String(value))
    }
  }
  return parts.length ? parts.join('×') : '—'
}

/** Short column-header label for a tracked field ("KG", "REPS", "SEC", "M"). */
export function shortFieldLabel(key: keyof SetValues, unit: WeightUnit): string {
  switch (key) {
    case 'load_kg':
    case 'assistance_kg':
      return unit === 'lb' ? 'LB' : 'KG'
    case 'reps':
      return 'REPS'
    case 'duration_s':
      return 'SEC'
    case 'distance_m':
      return 'M'
    default:
      return key.replace('_', ' ').toUpperCase()
  }
}

/**
 * Superset rendering plan (report Ch. 8.5: "supersets show as linked
 * color-coded groups using ONE tinted token"). Exercises render in their
 * existing order; each MAXIMAL RUN of consecutive exercises sharing a
 * superset group becomes one tinted container. Group letters are assigned by
 * order of first appearance (A, B, C…), and each member renders "A1", "A2" —
 * the circuit position, which is what "alternate exercises each round"
 * actually asks the user to track.
 */
export type ExerciseBlock =
  | { kind: 'single'; exercise: WorkoutExercise }
  | { kind: 'group'; letter: string; exercises: WorkoutExercise[] }

export function exerciseBlocks(exercises: readonly WorkoutExercise[]): ExerciseBlock[] {
  const letters = new Map<string, string>()
  const letterFor = (groupId: string): string => {
    let letter = letters.get(groupId)
    if (!letter) {
      letter = String.fromCharCode(65 + letters.size)
      letters.set(groupId, letter)
    }
    return letter
  }
  const blocks: ExerciseBlock[] = []
  let i = 0
  while (i < exercises.length) {
    const groupId = exercises[i]!.superset_group_id
    if (!groupId) {
      blocks.push({ kind: 'single', exercise: exercises[i]! })
      i += 1
      continue
    }
    let j = i
    while (j < exercises.length && exercises[j]!.superset_group_id === groupId) j += 1
    blocks.push({ kind: 'group', letter: letterFor(groupId), exercises: exercises.slice(i, j) })
    i = j
  }
  return blocks
}

/** "A1"-style member label inside a superset group container. */
export function circuitMemberLabel(blockLetter: string, memberIndex: number): string {
  return `${blockLetter}${memberIndex + 1}`
}

/** Rest chip countdown text: 90 → "1:30", 5 → "0:05", 0 → "0:00". */
export function restClockLabel(secondsRemaining: number): string {
  const total = Math.max(0, Math.floor(secondsRemaining))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * The next set row to focus after completing set at `index` (Hevy's
 * auto-advance): the first LATER row that is not completed — skipping rows
 * the user already finished — or null at the end of the table.
 */
export function nextFocusIndex(
  sets: readonly { completed_at: number | null }[],
  completedIndex: number,
): number | null {
  for (let i = completedIndex + 1; i < sets.length; i += 1) {
    if (!sets[i]!.completed_at) return i
  }
  return null
}
