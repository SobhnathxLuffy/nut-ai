import {
  aggregateNutritionDay,
  generateReport,
  LB_PER_KG,
  type BodyWeightPoint,
  type DayStatus,
  type PeriodReport,
  type ReportPeriod,
  type TrainingSession,
  type TrainingSet,
} from '@nutai/analytics'
import type { DbAdapter } from '@nutai/db-adapter'
import { deriveRecords, performanceHistory, type Exercise } from '@nutai/training'

interface NutritionRow {
  date: string
  kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  missing_kcal: number
  missing_protein: number
  missing_fat: number
  missing_carbs: number
  item_count: number
}

interface GoalRow {
  effective_from: number
  target_kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  rate_lb_per_week: number | null
  goal_type: string
}

function dateMs(date: string): number {
  return Date.parse(`${date}T12:00:00Z`)
}

export function datesBetween(start: string, end: string): string[] {
  const first = dateMs(start)
  const last = dateMs(end)
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) throw new Error('Invalid analytics date range')
  const dates: string[] = []
  for (let cursor = first; cursor <= last; cursor += 86_400_000) dates.push(new Date(cursor).toISOString().slice(0, 10))
  return dates
}

function goalForDate(goals: readonly GoalRow[], date: string): GoalRow | null {
  const endOfDay = dateMs(date) + 43_200_000
  return [...goals].reverse().find((goal) => goal.effective_from <= endOfDay) ?? null
}

export async function loadReport(
  db: DbAdapter,
  period: ReportPeriod,
  start: string,
  end: string,
): Promise<PeriodReport> {
  const dates = datesBetween(start, end)
  const [nutritionRows, pendingRows, statuses, goals, body, sessions, rawSets, exercises, performances] = await Promise.all([
    db.all<NutritionRow>(
      `SELECT m.local_date AS date,
              SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal,
              SUM(li.snap_protein_g * li.grams / 100.0 * m.portion_eaten_fraction) AS protein_g,
              SUM(li.snap_fat_g * li.grams / 100.0 * m.portion_eaten_fraction) AS fat_g,
              SUM(li.snap_carb_g * li.grams / 100.0 * m.portion_eaten_fraction) AS carbs_g,
              SUM(CASE WHEN li.snap_energy_kcal IS NULL THEN 1 ELSE 0 END) AS missing_kcal,
              SUM(CASE WHEN li.snap_protein_g IS NULL THEN 1 ELSE 0 END) AS missing_protein,
              SUM(CASE WHEN li.snap_fat_g IS NULL THEN 1 ELSE 0 END) AS missing_fat,
              SUM(CASE WHEN li.snap_carb_g IS NULL THEN 1 ELSE 0 END) AS missing_carbs,
              COUNT(li.id) AS item_count
       FROM meals m
       JOIN log_items li ON li.meal_id = m.id AND li.deleted_at IS NULL
       WHERE m.local_date BETWEEN ? AND ? AND m.deleted_at IS NULL
         AND m.analysis_status IN ('complete', 'manual')
       GROUP BY m.local_date`,
      [start, end],
    ),
    db.all<{ date: string; count: number }>(
      `SELECT local_date AS date, COUNT(*) AS count
       FROM meals
       WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL
         AND analysis_status IN ('captured', 'queued', 'analyzing')
       GROUP BY local_date`,
      [start, end],
    ),
    db.all<{ local_date: string; completion: DayStatus }>(
      'SELECT local_date, completion FROM day_status WHERE local_date BETWEEN ? AND ?',
      [start, end],
    ),
    db.all<GoalRow>('SELECT effective_from, target_kcal, protein_g, fat_g, carbs_g, rate_lb_per_week, goal_type FROM goals WHERE deleted_at IS NULL ORDER BY effective_from, id'),
    db.all<BodyWeightPoint & { logged_at: number }>(
      `SELECT local_date AS date, weight_kg, logged_at
       FROM weight_entries WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY local_date, logged_at`,
      [start, end],
    ),
    db.all<TrainingSession>(
      `SELECT id, local_date AS date, started_at, finished_at, status, routine_id
       FROM workouts WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY local_date, started_at`,
      [start, end],
    ),
    db.all<Record<string, unknown>>(
      `SELECT s.id, w.id AS session_id, w.local_date AS date, e.id AS exercise_id, e.name AS exercise_name,
              e.primary_muscles_json, e.secondary_muscles_json,
              s.kind, s.completed_at, we.tracking_type, s.load_kg, s.reps, s.duration_s, s.distance_m
       FROM workout_sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE w.local_date BETWEEN ? AND ? AND w.deleted_at IS NULL AND we.deleted_at IS NULL
         AND s.deleted_at IS NULL AND e.deleted_at IS NULL
       ORDER BY w.local_date, w.started_at, s.id`,
      [start, end],
    ),
    db.all<Exercise>('SELECT * FROM exercises WHERE deleted_at IS NULL'),
    performanceHistory(db),
  ])

  const nutritionByDate = new Map(nutritionRows.map((row) => [row.date, row]))
  const pendingByDate = new Map(pendingRows.map((row) => [row.date, row.count]))
  const statusByDate = new Map(statuses.map((row) => [row.local_date, row.completion]))
  const nutritionDays = dates.map((date) => {
    const row = nutritionByDate.get(date)
    const goal = goalForDate(goals, date)
    return aggregateNutritionDay(
      row
        ? [{
            date,
            kcal: row.missing_kcal > 0 || row.item_count === 0 ? null : row.kcal,
            protein_g: row.missing_protein > 0 || row.item_count === 0 ? null : row.protein_g,
            fat_g: row.missing_fat > 0 || row.item_count === 0 ? null : row.fat_g,
            carbs_g: row.missing_carbs > 0 || row.item_count === 0 ? null : row.carbs_g,
          }]
        : [],
      statusByDate.get(date) ?? 'unknown',
      {
        date,
        pending: (pendingByDate.get(date) ?? 0) > 0,
        targets: goal
          ? { kcal: goal.target_kcal, protein_g: goal.protein_g, fat_g: goal.fat_g, carbs_g: goal.carbs_g }
          : null,
      },
    )
  })

  const sets: TrainingSet[] = rawSets.map((row) => ({
    id: Number(row['id']),
    session_id: Number(row['session_id']),
    exercise_id: Number(row['exercise_id']),
    exercise_name: String(row['exercise_name']),
    date: String(row['date']),
    primary_muscles: JSON.parse(String(row['primary_muscles_json'] ?? '[]')) as string[],
    secondary_muscles: JSON.parse(String(row['secondary_muscles_json'] ?? '[]')) as string[],
    kind: String(row['kind']),
    completed_at: row['completed_at'] == null ? null : Number(row['completed_at']),
    tracking_type: String(row['tracking_type']),
    load_kg: row['load_kg'] == null ? null : Number(row['load_kg']),
    reps: row['reps'] == null ? null : Number(row['reps']),
    duration_s: row['duration_s'] == null ? null : Number(row['duration_s']),
    distance_m: row['distance_m'] == null ? null : Number(row['distance_m']),
  }))
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise.name]))
  const prs = deriveRecords(performances)
    .filter((record) => record.local_date >= start && record.local_date <= end)
    .map((record) => ({
      exercise_name: exerciseById.get(record.exercise_id) ?? `Exercise ${record.exercise_id}`,
      kind: record.kind,
      value: record.value,
      unit: record.unit,
      date: record.local_date,
    }))
  const latestGoal = goalForDate(goals, end)
  const direction = latestGoal?.goal_type === 'lose' ? -1 : latestGoal?.goal_type === 'gain' ? 1 : 0

  return generateReport({
    period,
    start_date: start,
    end_date: end,
    nutrition_days: nutritionDays,
    body_weights: body,
    training_sessions: sessions,
    training_sets: sets,
    recent_prs: prs,
    desired_weight_change_kg_week:
      latestGoal?.rate_lb_per_week == null ? null : direction * Math.abs(latestGoal.rate_lb_per_week) / LB_PER_KG,
    current_target_kcal: latestGoal?.target_kcal ?? null,
  })
}

export async function analyticsStartDate(db: DbAdapter, fallback: string): Promise<string> {
  const rows = await Promise.all([
    db.get<{ date: string | null }>('SELECT MIN(local_date) AS date FROM meals WHERE deleted_at IS NULL'),
    db.get<{ date: string | null }>('SELECT MIN(local_date) AS date FROM weight_entries WHERE deleted_at IS NULL'),
    db.get<{ date: string | null }>('SELECT MIN(local_date) AS date FROM workouts WHERE deleted_at IS NULL'),
    db.get<{ date: string | null }>('SELECT MIN(local_date) AS date FROM day_status'),
  ])
  return rows.map((row) => row?.date).filter((date): date is string => Boolean(date)).sort()[0] ?? fallback
}
