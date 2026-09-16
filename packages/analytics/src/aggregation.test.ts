import { describe, expect, it } from 'vitest'
import {
  aggregateNutritionDay,
  aggregateNutritionPeriod,
  aggregateTrainingPeriod,
  calculateMovingAverage,
  exerciseTrends,
  generateMonthlyReport,
  generateWeeklyReport,
  kgToLb,
  lbToKg,
  normalizeBodyWeightPoints,
  type NutritionDayAggregation,
  type TrainingSession,
  type TrainingSet,
} from './index.js'

const targets = { kcal: 2_000, protein_g: 120, fat_g: 65, carbs_g: 240 }

function nutritionDay(
  date: string,
  status: NutritionDayAggregation['status'],
  kcal: number | null,
  protein = kcal === null ? null : 120,
): NutritionDayAggregation {
  return {
    date,
    status,
    pending: false,
    kcal,
    protein_g: protein,
    fat_g: kcal === null ? null : 60,
    carbs_g: kcal === null ? null : 230,
    targets,
  }
}

describe('nutrition aggregation', () => {
  it('aggregates one complete day and preserves unknown nutrients', () => {
    const result = aggregateNutritionDay([
      { date: '2026-09-01', kcal: 500, protein_g: 30, fat_g: 20, carbs_g: 50 },
      { date: '2026-09-01', kcal: 600, protein_g: null, fat_g: 15, carbs_g: 70 },
    ], 'complete')
    expect(result.kcal).toBe(1_100)
    expect(result.protein_g).toBeNull()
    expect(result.fat_g).toBe(35)
  })

  it('represents an explicit empty fasting day as intentional zero', () => {
    const result = aggregateNutritionDay([], 'fasting', { date: '2026-09-02' })
    expect(result.kcal).toBe(0)
    expect(result.protein_g).toBe(0)
  })

  it('excludes a fasting day that conflicts with logged food', () => {
    const result = aggregateNutritionDay([
      { date: '2026-09-02', kcal: 500, protein_g: 20, fat_g: 10, carbs_g: 60 },
    ], 'fasting')
    expect(result.kcal).toBeNull()
    expect(aggregateNutritionPeriod([result]).excluded_days[0]?.reason).toBe('nutrition_unavailable')
  })

  it('excludes partial, unknown, pending, and unavailable finalized days', () => {
    const pending = { ...nutritionDay('2026-09-04', 'complete', 900), pending: true }
    const period = aggregateNutritionPeriod([
      nutritionDay('2026-09-01', 'complete', 2_000),
      nutritionDay('2026-09-02', 'partial', 500),
      nutritionDay('2026-09-03', 'unknown', 800),
      pending,
      nutritionDay('2026-09-05', 'complete', null),
      nutritionDay('2026-09-06', 'fasting', 0, 0),
    ])
    expect(period.days_included).toBe(2)
    expect(period.avg_kcal).toBe(1_000)
    expect(period.excluded_days.map((day) => day.reason)).toEqual([
      'partial', 'unknown', 'analysis_pending', 'nutrition_unavailable',
    ])
  })

  it('reports transparent target denominators instead of a health score', () => {
    const period = aggregateNutritionPeriod([
      nutritionDay('2026-09-01', 'complete', 2_050, 125),
      nutritionDay('2026-09-02', 'complete', 1_500, 100),
    ])
    expect(period.adherence.calorie_within_target_rate).toBe(0.5)
    expect(period.adherence.protein_target_rate).toBe(0.5)
    expect('adherence_score' in period.adherence).toBe(false)
  })

  it('rejects duplicate dates so averages cannot double count a day', () => {
    expect(() => aggregateNutritionPeriod([
      nutritionDay('2026-09-01', 'complete', 2_000),
      nutritionDay('2026-09-01', 'complete', 2_000),
    ])).toThrow(/Duplicate/)
  })
})

const sessions: TrainingSession[] = [
  { id: 1, date: '2026-09-01', started_at: 1_000, finished_at: 3_601_000, status: 'completed' },
  { id: 2, date: '2026-09-03', started_at: 4_000, finished_at: 1_804_000, status: 'completed' },
]

function set(overrides: Partial<TrainingSet> = {}): TrainingSet {
  return {
    id: 1,
    session_id: 1,
    exercise_id: 10,
    exercise_name: 'Bench press',
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps'],
    kind: 'normal',
    completed_at: Date.parse('2026-09-01T10:00:00Z'),
    tracking_type: 'weight_reps',
    load_kg: 80,
    reps: 5,
    duration_s: null,
    distance_m: null,
    ...overrides,
  }
}

describe('training aggregation', () => {
  it('excludes warmups from working analytics, e1RM, and muscle sets', () => {
    const result = aggregateTrainingPeriod(sessions, [
      set(),
      set({ id: 2, kind: 'warmup', load_kg: 120 }),
      set({ id: 3, session_id: 2, completed_at: Date.parse('2026-09-03T10:00:00Z'), load_kg: 82.5 }),
    ], 7)
    expect(result.session_count).toBe(2)
    expect(result.working_sets).toBe(2)
    expect(result.muscle_group_sets).toEqual({ chest: 2, triceps: 1 })
    expect(result.exercise_trends[0]?.points.at(-1)?.heaviest_working_set_kg).toBe(82.5)
  })

  it('derives per-exercise e1RM, heaviest set, rep PR, frequency and volume', () => {
    const trends = exerciseTrends([
      set(),
      set({ id: 2, load_kg: 85, reps: 3 }),
      set({ id: 3, session_id: 2, completed_at: Date.parse('2026-09-03T10:00:00Z'), load_kg: 90, reps: 3 }),
    ])
    expect(trends[0]?.frequency).toBe(2)
    expect(trends[0]?.rep_prs).toContainEqual({ reps: 3, load_kg: 90, date: '2026-09-03' })
    expect(trends[0]?.points[0]?.session_volume).toBe(655)
    expect(trends[0]?.points[0]?.e1rm_kg).toBeCloseTo(93.5, 6)
  })
})

describe('body aggregation and weight units', () => {
  it('uses exact kg/lb conversion without changing canonical kg', () => {
    const canonicalKg = 73.456789
    const displayLb = kgToLb(canonicalKg)
    expect(displayLb).toBeCloseTo(161.9444987541894, 10)
    expect(lbToKg(displayLb)).toBeCloseTo(canonicalKg, 12)
  })

  it('drops invalid points and keeps the newest duplicate date', () => {
    expect(normalizeBodyWeightPoints([
      { date: '2026-09-01', weight_kg: 80, logged_at: 1 },
      { date: '2026-09-01', weight_kg: 79.5, logged_at: 2 },
      { date: '2026-09-02', weight_kg: Number.NaN },
      { date: '2026-09-03', weight_kg: Number.POSITIVE_INFINITY },
    ])).toEqual([{ date: '2026-09-01', weight_kg: 79.5, logged_at: 2 }])
  })

  it('handles zero, one, and sparse moving-average points', () => {
    expect(calculateMovingAverage([])).toEqual([])
    expect(calculateMovingAverage([{ date: '2026-09-01', weight_kg: 80 }])[0]?.trend_kg).toBe(80)
    const sparse = calculateMovingAverage([
      { date: '2026-09-01', weight_kg: 80 },
      { date: '2026-09-20', weight_kg: 79 },
    ])
    expect(sparse[1]?.trend_kg).toBe(79)
  })
})

describe('weekly and monthly reports', () => {
  const days = Array.from({ length: 7 }, (_, index) =>
    nutritionDay(`2026-09-${String(index + 1).padStart(2, '0')}`, index === 2 ? 'partial' : 'complete', 2_000),
  )
  const weights = [
    { date: '2026-09-01', weight_kg: 80 },
    { date: '2026-09-04', weight_kg: 79.8 },
    { date: '2026-09-08', weight_kg: 79.5 },
  ]

  it('generates a deterministic weekly payload with data-quality evidence', () => {
    const report = generateWeeklyReport({
      start_date: '2026-09-01',
      end_date: '2026-09-08',
      nutrition_days: days,
      body_weights: weights,
      training_sessions: sessions,
      training_sets: [set()],
      current_target_kcal: 2_000,
      desired_weight_change_kg_week: -0.25,
    })
    expect(report.nutrition.days_included).toBe(6)
    expect(report.data_quality.incomplete_nutrition_days).toBe(1)
    expect(report.training.working_sets).toBe(1)
    expect(report.adaptive.estimated_expenditure_kcal).not.toBeNull()
    expect(report.adaptive.requires_acceptance).toBe(true)
  })

  it('returns neutral unavailable states for a sparse month', () => {
    const report = generateMonthlyReport({
      start_date: '2026-08-01',
      end_date: '2026-08-31',
      nutrition_days: [],
      body_weights: [],
      training_sessions: [],
      training_sets: [],
    })
    expect(report.body.average_weight_kg).toBeNull()
    expect(report.nutrition.avg_kcal).toBeNull()
    expect(report.training.session_count).toBe(0)
    expect(report.data_quality.warnings.length).toBeGreaterThan(0)
  })
})
