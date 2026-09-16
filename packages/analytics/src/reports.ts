import { aggregateBodyWeight, type BodyAggregation, type BodyWeightPoint } from './body.js'
import {
  aggregateNutritionPeriod,
  type NutritionDayAggregation,
  type NutritionPeriodAggregation,
} from './nutrition.js'
import {
  aggregateTrainingPeriod,
  type TrainingAggregation,
  type TrainingSession,
  type TrainingSet,
} from './training.js'

export type ReportPeriod = 'week' | 'month'

export interface ReportInput {
  period: ReportPeriod
  start_date: string
  end_date: string
  nutrition_days: NutritionDayAggregation[]
  body_weights: BodyWeightPoint[]
  training_sessions: TrainingSession[]
  training_sets: TrainingSet[]
  recent_prs?: Array<{ exercise_name: string; kind: string; value: number; unit: string; date: string }>
  desired_weight_change_kg_week?: number | null
  current_target_kcal?: number | null
}

export interface AdaptiveReportSection {
  estimated_expenditure_kcal: number | null
  recommended_calorie_adjustment: number | null
  requires_acceptance: boolean
  evidence: string | null
}

export interface PeriodReport {
  period: ReportPeriod
  start_date: string
  end_date: string
  period_days: number
  body: BodyAggregation
  nutrition: NutritionPeriodAggregation
  nutrition_days: NutritionDayAggregation[]
  training: TrainingAggregation
  prs: NonNullable<ReportInput['recent_prs']>
  adaptive: AdaptiveReportSection
  data_quality: {
    weigh_ins: number
    complete_nutrition_days: number
    incomplete_nutrition_days: number
    pending_nutrition_days: number
    warnings: string[]
  }
}

function periodDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T12:00:00Z`)
  const endMs = Date.parse(`${end}T12:00:00Z`)
  const days = Math.round((endMs - startMs) / 86_400_000) + 1
  if (!Number.isFinite(days) || days <= 0) throw new Error('Invalid report date range')
  return days
}

function adaptiveSection(
  nutrition: NutritionPeriodAggregation,
  body: BodyAggregation,
  days: number,
  desiredWeightChange: number | null,
  currentTarget: number | null,
): AdaptiveReportSection {
  const firstDate = body.points[0]?.date
  const lastDate = body.points.at(-1)?.date
  const weightSpan = firstDate && lastDate
    ? Math.round((Date.parse(`${lastDate}T12:00:00Z`) - Date.parse(`${firstDate}T12:00:00Z`)) / 86_400_000)
    : 0
  const sufficient =
    nutrition.days_included >= 5 &&
    nutrition.avg_kcal !== null &&
    body.points.length >= 3 &&
    body.change_kg !== null &&
    weightSpan >= 7
  if (!sufficient) {
    return {
      estimated_expenditure_kcal: null,
      recommended_calorie_adjustment: null,
      requires_acceptance: true,
      evidence: null,
    }
  }

  const expenditure = nutrition.avg_kcal! - (body.change_kg! * 7_700) / Math.max(weightSpan, days - 1)
  let adjustment: number | null = null
  if (
    desiredWeightChange !== null &&
    Number.isFinite(desiredWeightChange) &&
    currentTarget !== null &&
    Number.isFinite(currentTarget)
  ) {
    const suggested = expenditure + (desiredWeightChange * 7_700) / 7
    const delta = Math.max(-150, Math.min(150, suggested - currentTarget))
    adjustment = Math.abs(delta) >= 25 ? Math.round(delta / 25) * 25 : null
  }

  return {
    estimated_expenditure_kcal: Math.round(expenditure),
    recommended_calorie_adjustment: adjustment,
    requires_acceptance: true,
    evidence: `${nutrition.days_included} valid intake days and ${body.points.length} weigh-ins across ${weightSpan} days.`,
  }
}

export function generateReport(input: ReportInput): PeriodReport {
  const days = periodDays(input.start_date, input.end_date)
  const nutrition = aggregateNutritionPeriod(input.nutrition_days)
  const body = aggregateBodyWeight(input.body_weights)
  const training = aggregateTrainingPeriod(input.training_sessions, input.training_sets, days)
  const incomplete = nutrition.partial_days + nutrition.unknown_days
  const warnings: string[] = []
  if (body.points.length === 0) warnings.push('No weigh-ins in this period.')
  else if (body.points.length < 3) warnings.push('Weight trend is sparse; more weigh-ins are needed for a stable trend.')
  if (nutrition.days_included === 0) warnings.push('No complete or intentional fasting days with usable nutrition data.')
  if (incomplete > 0) warnings.push(`${incomplete} nutrition day${incomplete === 1 ? '' : 's'} excluded as partial or unknown.`)
  const pending = input.nutrition_days.filter((day) => day.pending).length
  if (pending > 0) warnings.push(`${pending} day${pending === 1 ? '' : 's'} contain pending food analysis.`)
  if (training.session_count === 0) warnings.push('No completed training sessions in this period.')

  return {
    period: input.period,
    start_date: input.start_date,
    end_date: input.end_date,
    period_days: days,
    body,
    nutrition,
    nutrition_days: [...input.nutrition_days],
    training,
    prs: input.recent_prs ?? [],
    adaptive: adaptiveSection(
      nutrition,
      body,
      days,
      input.desired_weight_change_kg_week ?? null,
      input.current_target_kcal ?? null,
    ),
    data_quality: {
      weigh_ins: body.points.length,
      complete_nutrition_days: nutrition.complete_days,
      incomplete_nutrition_days: incomplete,
      pending_nutrition_days: pending,
      warnings,
    },
  }
}

export function generateWeeklyReport(input: Omit<ReportInput, 'period'>): PeriodReport {
  return generateReport({ ...input, period: 'week' })
}

export function generateMonthlyReport(input: Omit<ReportInput, 'period'>): PeriodReport {
  return generateReport({ ...input, period: 'month' })
}
