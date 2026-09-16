export interface TrainingSession {
  id: number
  date: string
  started_at: number
  finished_at: number | null
  status: 'active' | 'completed' | 'discarded'
  routine_id?: number | null
}

export interface TrainingSet {
  id: number
  session_id: number
  exercise_id: number
  exercise_name: string
  date?: string
  primary_muscles: string[]
  secondary_muscles: string[]
  kind: string
  completed_at: number | null
  tracking_type: string
  load_kg: number | null
  reps: number | null
  duration_s: number | null
  distance_m: number | null
}

export interface ExerciseTrendPoint {
  date: string
  session_id: number
  e1rm_kg: number | null
  heaviest_working_set_kg: number | null
  session_volume: number | null
}

export interface ExerciseTrend {
  exercise_id: number
  exercise_name: string
  frequency: number
  rep_prs: Array<{ reps: number; load_kg: number; date: string }>
  points: ExerciseTrendPoint[]
}

export interface TrainingAggregation {
  session_count: number
  sessions_per_week: number
  working_sets: number
  working_sets_per_week: number
  total_duration_min: number | null
  average_session_duration_min: number | null
  muscle_group_sets: Record<string, number>
  exercise_trends: ExerciseTrend[]
}

export function isWorkingSet(set: TrainingSet): boolean {
  return set.completed_at !== null && set.kind !== 'warmup' && set.kind !== 'cooldown'
}

function finiteNonNegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

export function estimatedOneRepMax(set: TrainingSet): number | null {
  if (
    !isWorkingSet(set) ||
    set.tracking_type !== 'weight_reps' ||
    !finiteNonNegative(set.load_kg) ||
    !Number.isInteger(set.reps) ||
    set.reps === null ||
    set.reps < 1 ||
    set.reps > 12
  ) return null
  return set.reps === 1 ? set.load_kg : set.load_kg * (1 + set.reps / 30)
}

export function calculateMuscleSets(sets: readonly TrainingSet[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const set of sets.filter(isWorkingSet)) {
    for (const muscle of set.primary_muscles) result[muscle] = (result[muscle] ?? 0) + 1
    for (const muscle of set.secondary_muscles) result[muscle] = (result[muscle] ?? 0) + 0.5
  }
  return result
}

export function exerciseTrends(sets: readonly TrainingSet[]): ExerciseTrend[] {
  const groups = new Map<number, TrainingSet[]>()
  for (const set of sets.filter(isWorkingSet)) {
    groups.set(set.exercise_id, [...(groups.get(set.exercise_id) ?? []), set])
  }

  return [...groups.entries()].map(([exerciseId, exerciseSets]) => {
    const bySession = new Map<number, TrainingSet[]>()
    for (const set of exerciseSets) bySession.set(set.session_id, [...(bySession.get(set.session_id) ?? []), set])
    const points = [...bySession.entries()].map(([sessionId, sessionSets]) => {
      const e1rms = sessionSets.map(estimatedOneRepMax).filter((value): value is number => value !== null)
      const loads = sessionSets.map((set) => set.load_kg).filter(finiteNonNegative)
      const volumeSets = sessionSets.filter(
        (set) => finiteNonNegative(set.load_kg) && Number.isInteger(set.reps) && (set.reps ?? 0) > 0,
      )
      return {
        date: sessionSets[0]?.date ?? new Date(Math.max(...sessionSets.map((set) => set.completed_at ?? 0))).toISOString().slice(0, 10),
        session_id: sessionId,
        e1rm_kg: e1rms.length > 0 ? Math.max(...e1rms) : null,
        heaviest_working_set_kg: loads.length > 0 ? Math.max(...loads) : null,
        session_volume:
          volumeSets.length > 0
            ? volumeSets.reduce((sum, set) => sum + set.load_kg! * set.reps!, 0)
            : null,
      }
    }).sort((a, b) => a.date.localeCompare(b.date) || a.session_id - b.session_id)

    const repBests = new Map<number, { reps: number; load_kg: number; date: string }>()
    for (const set of exerciseSets) {
      if (!finiteNonNegative(set.load_kg) || !Number.isInteger(set.reps) || (set.reps ?? 0) < 1) continue
      const reps = set.reps!
      const previous = repBests.get(reps)
      const date = set.date ?? new Date(set.completed_at!).toISOString().slice(0, 10)
      if (!previous || set.load_kg > previous.load_kg) repBests.set(reps, { reps, load_kg: set.load_kg, date })
    }

    return {
      exercise_id: exerciseId,
      exercise_name: exerciseSets[0]?.exercise_name ?? `Exercise ${exerciseId}`,
      frequency: bySession.size,
      rep_prs: [...repBests.values()].sort((a, b) => a.reps - b.reps),
      points,
    }
  }).sort((a, b) => b.frequency - a.frequency || a.exercise_name.localeCompare(b.exercise_name))
}

export function aggregateTrainingPeriod(
  sessions: readonly TrainingSession[],
  sets: readonly TrainingSet[],
  periodDays: number,
): TrainingAggregation {
  if (!Number.isFinite(periodDays) || periodDays <= 0) throw new Error('periodDays must be positive')
  const completed = sessions.filter((session) => session.status === 'completed' && session.finished_at !== null)
  const sessionIds = new Set(completed.map((session) => session.id))
  const working = sets.filter((set) => sessionIds.has(set.session_id) && isWorkingSet(set))
  const durations = completed
    .map((session) => session.finished_at! - session.started_at)
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
  const weeks = periodDays / 7

  return {
    session_count: completed.length,
    sessions_per_week: completed.length / weeks,
    working_sets: working.length,
    working_sets_per_week: working.length / weeks,
    total_duration_min: durations.length > 0 ? durations.reduce((sum, duration) => sum + duration, 0) / 60_000 : null,
    average_session_duration_min:
      durations.length > 0
        ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 60_000
        : null,
    muscle_group_sets: calculateMuscleSets(working),
    exercise_trends: exerciseTrends(working),
  }
}

export const aggregateTrainingWeek = aggregateTrainingPeriod
export const aggregateTrainingMonth = aggregateTrainingPeriod

export function calculateTrainingFrequency(sessions: readonly TrainingSession[], periodDays: number): number {
  return aggregateTrainingPeriod(sessions, [], periodDays).sessions_per_week
}
