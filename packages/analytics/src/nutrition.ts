export type DayStatus = 'complete' | 'partial' | 'unknown' | 'fasting'

export interface NutritionEntry {
  date: string
  kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
}

export interface NutritionTargets {
  kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
}

export interface NutritionDayAggregation {
  date: string
  status: DayStatus
  pending: boolean
  kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  targets: NutritionTargets | null
}

export interface ExcludedNutritionDay {
  date: string
  reason: 'partial' | 'unknown' | 'analysis_pending' | 'nutrition_unavailable'
}

export interface NutritionAdherence {
  calorie_comparable_days: number
  calorie_within_target_days: number
  calorie_within_target_rate: number | null
  protein_comparable_days: number
  protein_target_days: number
  protein_target_rate: number | null
}

export interface NutritionPeriodAggregation {
  avg_kcal: number | null
  avg_protein_g: number | null
  avg_fat_g: number | null
  avg_carbs_g: number | null
  days_in_period: number
  days_included: number
  complete_days: number
  fasting_days: number
  partial_days: number
  unknown_days: number
  included_dates: string[]
  excluded_days: ExcludedNutritionDay[]
  adherence: NutritionAdherence
}

function validMetric(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

function sumMetric(entries: readonly NutritionEntry[], key: keyof Omit<NutritionEntry, 'date'>): number | null {
  if (entries.length === 0) return null
  let total = 0
  for (const entry of entries) {
    const value = entry[key]
    if (!validMetric(value)) return null
    total += value
  }
  return Number.isFinite(total) ? total : null
}

/**
 * Aggregate one local calendar day. A finalized fasting day is an intentional
 * zero; every other empty or partly-known day remains unavailable, never zero.
 */
export function aggregateNutritionDay(
  entries: readonly NutritionEntry[],
  status: DayStatus,
  options: { date?: string; pending?: boolean; targets?: NutritionTargets | null } = {},
): NutritionDayAggregation {
  const date = options.date ?? entries[0]?.date ?? ''
  if (entries.some((entry) => entry.date !== date)) {
    throw new Error('Nutrition entries must belong to one local date')
  }

  const fasting = status === 'fasting' && entries.length === 0
  const fastingConflict = status === 'fasting' && entries.length > 0
  return {
    date,
    status,
    pending: options.pending ?? false,
    kcal: fasting ? 0 : fastingConflict ? null : sumMetric(entries, 'kcal'),
    protein_g: fasting ? 0 : fastingConflict ? null : sumMetric(entries, 'protein_g'),
    fat_g: fasting ? 0 : fastingConflict ? null : sumMetric(entries, 'fat_g'),
    carbs_g: fasting ? 0 : fastingConflict ? null : sumMetric(entries, 'carbs_g'),
    targets: options.targets ?? null,
  }
}

function average(days: readonly NutritionDayAggregation[], key: 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g'): number | null {
  const values = days.map((day) => day[key]).filter(validMetric)
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

/**
 * COMPLETE and explicit FASTING days may enter averages. PARTIAL, UNKNOWN,
 * pending, or nutrient-incomplete days are visible in the exclusion evidence.
 */
export function aggregateNutritionPeriod(
  dailyData: readonly NutritionDayAggregation[],
): NutritionPeriodAggregation {
  const dates = new Set<string>()
  for (const day of dailyData) {
    if (!day.date) throw new Error('Nutrition day requires a local date')
    if (dates.has(day.date)) throw new Error(`Duplicate nutrition day: ${day.date}`)
    dates.add(day.date)
  }

  const included = dailyData.filter(
    (day) =>
      (day.status === 'complete' || day.status === 'fasting') &&
      !day.pending &&
      validMetric(day.kcal),
  )
  const excluded = dailyData
    .filter((day) => !included.includes(day))
    .map<ExcludedNutritionDay>((day) => ({
      date: day.date,
      reason: day.pending
        ? 'analysis_pending'
        : day.status === 'partial'
          ? 'partial'
          : day.status === 'unknown'
            ? 'unknown'
            : 'nutrition_unavailable',
    }))

  const calorieComparable = included.filter(
    (day) => validMetric(day.targets?.kcal ?? null) && (day.targets?.kcal ?? 0) > 0,
  )
  const calorieWithin = calorieComparable.filter((day) => {
    const target = day.targets!.kcal!
    return Math.abs(day.kcal! - target) <= target * 0.1
  })
  const proteinComparable = included.filter(
    (day) => validMetric(day.protein_g) && validMetric(day.targets?.protein_g ?? null) && (day.targets?.protein_g ?? 0) > 0,
  )
  const proteinMet = proteinComparable.filter((day) => day.protein_g! >= day.targets!.protein_g!)

  return {
    avg_kcal: average(included, 'kcal'),
    avg_protein_g: average(included, 'protein_g'),
    avg_fat_g: average(included, 'fat_g'),
    avg_carbs_g: average(included, 'carbs_g'),
    days_in_period: dailyData.length,
    days_included: included.length,
    complete_days: dailyData.filter((day) => day.status === 'complete').length,
    fasting_days: dailyData.filter((day) => day.status === 'fasting').length,
    partial_days: dailyData.filter((day) => day.status === 'partial').length,
    unknown_days: dailyData.filter((day) => day.status === 'unknown').length,
    included_dates: included.map((day) => day.date),
    excluded_days: excluded,
    adherence: {
      calorie_comparable_days: calorieComparable.length,
      calorie_within_target_days: calorieWithin.length,
      calorie_within_target_rate:
        calorieComparable.length > 0 ? calorieWithin.length / calorieComparable.length : null,
      protein_comparable_days: proteinComparable.length,
      protein_target_days: proteinMet.length,
      protein_target_rate:
        proteinComparable.length > 0 ? proteinMet.length / proteinComparable.length : null,
    },
  }
}

export const aggregateNutritionWeek = aggregateNutritionPeriod
export const aggregateNutritionMonth = aggregateNutritionPeriod
