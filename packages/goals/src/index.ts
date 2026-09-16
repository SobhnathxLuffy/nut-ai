/**
 * Goals — BMR, TDEE, targets, macro splits, weight-trend smoothing, adaptive TDEE.
 *
 * SPEC-product.md goals math, steps 1-8. Pure arithmetic, unit-testable in Node.
 *
 * Two principles run through all of it:
 *
 * 1. NOTHING IS SILENTLY SUBSTITUTED. When the safety floor raises a target, the
 *    result carries the raw value and the reason, so the UI can say "your target
 *    would have been 1,050 kcal, but we don't go below 1,200 — here's why." Same
 *    reconciliation-first principle that makes the macro-edit bug impossible.
 *
 * 2. NO MORALIZING. These functions produce numbers and explanations, never
 *    judgments. Nothing here returns a "you're behind" or a pass/fail day.
 */

export * from './checkin.js'
export type Sex = 'male' | 'female' | 'unspecified'
export type Goal = 'lose' | 'maintain' | 'gain'

/** kcal per pound of body mass. The industry-standard simplification. */
export const KCAL_PER_LB = 3500

export const LB_PER_KG = 2.2046226218

export interface BodyInputs {
  sex: Sex
  weightKg: number
  heightCm: number
  ageYears: number
  /** Optional body-fat fraction 0-1. NEVER estimated from a photo. */
  bodyFatFraction?: number | undefined
}

/**
 * Step 1 — BMR, Mifflin-St Jeor by default.
 *
 * The `unspecified` constant is the mean of male (+5) and female (-161) = -78.
 * This is flagged ASSUMPTION in the spec and stays flagged here, because it
 * directly moves a real person's calorie target and no literature supports the
 * average as a neutral default. Sex is asked FOR THIS EQUATION ONLY, which the UI
 * states inline at the point of asking.
 */
export function mifflinStJeor(b: BodyInputs): number {
  const base = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.ageYears
  switch (b.sex) {
    case 'male':
      return base + 5
    case 'female':
      return base - 161
    case 'unspecified':
      return base - 78
  }
}

/**
 * Katch-McArdle. Better at the lean and muscular extremes because it works from
 * lean mass rather than total mass. Offered when body fat is supplied, never
 * defaulted, and body fat is never inferred from anything.
 */
export function katchMcArdle(weightKg: number, bodyFatFraction: number): number {
  return 370 + 21.6 * (weightKg * (1 - bodyFatFraction))
}

/** Harris-Benedict, 1984 revision. Offered for familiarity only. */
export function harrisBenedict(b: BodyInputs): number {
  return b.sex === 'female'
    ? 447.593 + 9.247 * b.weightKg + 3.098 * b.heightCm - 4.33 * b.ageYears
    : 88.362 + 13.397 * b.weightKg + 4.799 * b.heightCm - 5.677 * b.ageYears
}

export type BmrEquation = 'mifflin' | 'katch' | 'harris'

export function computeBmr(b: BodyInputs, equation: BmrEquation = 'mifflin'): number {
  if (equation === 'katch') {
    if (b.bodyFatFraction == null) {
      throw new Error('Katch-McArdle requires a body-fat fraction; it is never inferred.')
    }
    return katchMcArdle(b.weightKg, b.bodyFatFraction)
  }
  if (equation === 'harris') return harrisBenedict(b)
  return mifflinStJeor(b)
}

/** Step 2 — activity multipliers. */
export const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const

export type ActivityLevel = keyof typeof ACTIVITY_MULTIPLIERS

export function computeTdee(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activity]
}

/**
 * Step 4 — the safe floor. A HARD CLAMP, not a suggestion.
 *
 * The unspecified flat floor is 1200, the conservative choice. ASSUMPTION, and it
 * matters: picking 1500 instead would raise the floor for every user who declined
 * to state a sex.
 */
export const FLAT_FLOOR_KCAL: Record<Sex, number> = {
  female: 1200,
  male: 1500,
  unspecified: 1200,
}

export function safeFloor(sex: Sex, bmr: number): number {
  return Math.max(FLAT_FLOOR_KCAL[sex], 1.2 * bmr)
}

export interface TargetInputs extends BodyInputs {
  activity: ActivityLevel
  goal: Goal
  /** Target rate in lb/week, unsigned. Direction comes from `goal`. */
  rateLbPerWeek: number
  equation?: BmrEquation | undefined
}

export interface CalorieTarget {
  bmr: number
  tdee: number
  dailyDelta: number
  /** What the arithmetic produced, before the floor. */
  targetRaw: number
  /** What the user actually gets. */
  target: number
  floor: number
  /** True when the floor raised the number — the UI MUST explain this. */
  floorApplied: boolean
  floorExplanation: string | null
  /** Non-blocking. Never silently suppressed, never blocking. */
  warnings: string[]
}

/** Steps 2-5. */
export function computeCalorieTarget(input: TargetInputs): CalorieTarget {
  const bmr = computeBmr(input, input.equation ?? 'mifflin')
  const tdee = computeTdee(bmr, input.activity)

  const dailyDelta = (input.rateLbPerWeek * KCAL_PER_LB) / 7
  const targetRaw =
    input.goal === 'lose' ? tdee - dailyDelta : input.goal === 'gain' ? tdee + dailyDelta : tdee

  const floor = safeFloor(input.sex, bmr)
  const target = Math.max(targetRaw, floor)
  const floorApplied = target > targetRaw

  const warnings: string[] = []
  if (dailyDelta > 1000) {
    warnings.push(
      `A rate of ${input.rateLbPerWeek} lb/week implies a ${Math.round(dailyDelta)} kcal daily gap, which is more aggressive than is usually sustainable.`,
    )
  }
  const onePercentLb = input.weightKg * LB_PER_KG * 0.01
  if (input.rateLbPerWeek > onePercentLb) {
    warnings.push(
      `That is faster than 1% of your bodyweight per week (${onePercentLb.toFixed(1)} lb).`,
    )
  }

  return {
    bmr,
    tdee,
    dailyDelta,
    targetRaw,
    target,
    floor,
    floorApplied,
    floorExplanation: floorApplied
      ? `Your target would have been ${Math.round(targetRaw)} kcal, but we don't go below ${Math.round(floor)} kcal.`
      : null,
    warnings,
  }
}

/** Step 5 — implied goal BMI, for the non-blocking note. */
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100
  return weightKg / (m * m)
}

export const UNDERWEIGHT_BMI = 18.5

/**
 * Step 6 — macro split, in grams per kg rather than percent of calories.
 *
 * Percent-of-calories silently breaks at extreme calorie levels, because it scales
 * protein with the budget instead of with the body: 25% of a 1,200 kcal cut is
 * 75 g of protein for someone who needs 130 g. Grams per kg tracks the person.
 *
 * Computation order is protein -> fat -> CARBS AS THE REMAINDER. That ordering is
 * exactly what prevents the "edit one macro and the others don't reconcile" bug:
 * there is always precisely one derived variable, and it always absorbs the change.
 */
export const MACRO_RULES = {
  lose: { proteinPerKg: 2.2, fatPctOfCalories: 0.25, fatFloorPerKg: 0.6 },
  maintain: { proteinPerKg: 1.9, fatPctOfCalories: 0.275, fatFloorPerKg: 0.6 },
  gain: { proteinPerKg: 1.9, fatPctOfCalories: 0.25, fatFloorPerKg: 0.8 },
} as const

export interface MacroTargets {
  protein_g: number
  fat_g: number
  carbs_g: number
  /** True when the carb remainder went negative and had to be floored at zero. */
  carbsFloored: boolean
}

export function computeMacros(targetKcal: number, weightKg: number, goal: Goal): MacroTargets {
  const rule = MACRO_RULES[goal]
  const protein_g = rule.proteinPerKg * weightKg
  const fat_g = Math.max((rule.fatPctOfCalories * targetKcal) / 9, rule.fatFloorPerKg * weightKg)
  const rawCarbs = (targetKcal - 4 * protein_g - 9 * fat_g) / 4

  // At a very low target with a heavy user, protein plus fat can exceed the whole
  // budget. Floor carbs at zero rather than rendering a negative gram value, and
  // signal it so the UI explains instead of showing nonsense.
  return {
    protein_g,
    fat_g,
    carbs_g: Math.max(0, rawCarbs),
    carbsFloored: rawCarbs < 0,
  }
}

// ---------------------------------------------------------------------------
// Step 7 — weight-trend smoothing
// ---------------------------------------------------------------------------

/** Hacker's-Diet style EWMA. Low alpha because scale weight is mostly noise. */
export const TREND_ALPHA = 0.1

export interface WeightPoint {
  /** Integer day index — days since epoch, or any consistent scheme. */
  day: number
  weightKg: number
}

export interface TrendPoint {
  day: number
  /** Null on days with no measurement. We never synthesize a raw value. */
  rawKg: number | null
  trendKg: number
}

/**
 * EWMA trend over a date range.
 *
 * MISSING DAYS HOLD THE PREVIOUS TREND. They never synthesize a raw value and
 * never interpolate. A synthesized value would flow straight into the
 * adaptive-TDEE loop and move someone's calorie target based on a measurement
 * that never happened.
 */
export function computeTrend(points: readonly WeightPoint[]): TrendPoint[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.day - b.day)
  const byDay = new Map(sorted.map((p) => [p.day, p.weightKg]))

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return []

  const out: TrendPoint[] = []
  let trend = first.weightKg

  for (let day = first.day; day <= last.day; day++) {
    const raw = byDay.get(day)
    if (raw !== undefined) {
      trend = day === first.day ? raw : TREND_ALPHA * raw + (1 - TREND_ALPHA) * trend
      out.push({ day, rawKg: raw, trendKg: trend })
    } else {
      out.push({ day, rawKg: null, trendKg: trend })
    }
  }
  return out
}

/** OLS slope over a rolling window of trend values, returned as lb/week. */
export function trendSlopeLbPerWeek(trend: readonly TrendPoint[], windowDays = 21): number | null {
  if (trend.length < 2) return null
  const window = trend.slice(-windowDays)
  const n = window.length
  if (n < 2) return null

  const meanX = window.reduce((s, p) => s + p.day, 0) / n
  const meanY = window.reduce((s, p) => s + p.trendKg, 0) / n

  let num = 0
  let den = 0
  for (const p of window) {
    num += (p.day - meanX) * (p.trendKg - meanY)
    den += (p.day - meanX) ** 2
  }
  if (den === 0) return null

  const kgPerDay = num / den
  return kgPerDay * LB_PER_KG * 7
}

// ---------------------------------------------------------------------------
// Step 8 — adaptive TDEE
// ---------------------------------------------------------------------------

/** k in gain(n) = 1/(n+k). Higher k means slower, calmer adaptation. */
export const ADAPTIVE_GAIN_K = 4

/** Minimum change before a new target is SURFACED, to avoid goal whiplash. */
export const TARGET_CHANGE_THRESHOLD_KCAL = 75

export interface AdaptiveTdeeInput {
  /** Current estimate — the static Mifflin value on the first run. */
  currentTdee: number
  /** Mean daily intake over the admitted days only. */
  avgDailyIntakeKcal: number
  trendSlopeLbPerWeek: number
  /** How many times the estimator has updated. Drives the decreasing gain. */
  updateCount: number
}

export interface AdaptiveTdeeResult {
  observedTdee: number
  newTdee: number
  /** True only when the change is large enough to show the user. */
  shouldSurface: boolean
  explanation: string
}

/**
 * Observed-TDEE estimator with decreasing gain.
 *
 *   implied_gap = -trend_lb_per_week x 3500 / 7
 *   observed    = avg_daily_intake + implied_gap
 *   new         = old + gain(n) x (observed - old),   gain(n) = 1/(n + k)
 *
 * Recomputed daily internally, but SURFACED only weekly or on a >= 75 kcal change.
 * A target that moves every day teaches people to ignore it, and a target that
 * jumps after one salty dinner teaches them to distrust it.
 */
export function updateAdaptiveTdee(input: AdaptiveTdeeInput): AdaptiveTdeeResult {
  // Losing weight (negative slope) means intake sat BELOW expenditure, so observed
  // expenditure is higher than intake by the implied gap.
  const impliedGap = (-input.trendSlopeLbPerWeek * KCAL_PER_LB) / 7
  const observedTdee = input.avgDailyIntakeKcal + impliedGap

  const gain = 1 / (input.updateCount + ADAPTIVE_GAIN_K)
  const newTdee = input.currentTdee + gain * (observedTdee - input.currentTdee)

  const delta = newTdee - input.currentTdee
  const shouldSurface = Math.abs(delta) >= TARGET_CHANGE_THRESHOLD_KCAL

  const direction =
    input.trendSlopeLbPerWeek < 0
      ? 'losing'
      : input.trendSlopeLbPerWeek > 0
        ? 'gaining'
        : 'holding steady'

  return {
    observedTdee,
    newTdee,
    shouldSurface,
    explanation: `Over the last few weeks you've been ${direction} at about ${Math.abs(input.trendSlopeLbPerWeek).toFixed(2)} lb/week while averaging ${Math.round(input.avgDailyIntakeKcal)} kcal a day.`,
  }
}

/**
 * Whether a day is complete enough to enter the intake average.
 *
 * ASSUMPTION, and a load-bearing one: this constant moves people's calorie
 * targets. Admitting half-logged days biases the intake average downward, which
 * inflates observed TDEE, which raises the target — a silent feedback loop that
 * rewards under-logging.
 */
export const DAY_COMPLETENESS = {
  minMeals: 1,
  minDistinctSlots: 2,
} as const

export function isDayCompleteEnough(input: {
  mealCount: number
  distinctSlotCount: number
  hasQueuedEntries: boolean
}): boolean {
  return (
    input.mealCount >= DAY_COMPLETENESS.minMeals &&
    input.distinctSlotCount >= DAY_COMPLETENESS.minDistinctSlots &&
    !input.hasQueuedEntries
  )
}

// ---------------------------------------------------------------------------
// Day Completeness Status
// ---------------------------------------------------------------------------

export const DAY_COMPLETION_STATUSES = ['complete', 'partial', 'unknown', 'fasting'] as const
export type DayCompletion = (typeof DAY_COMPLETION_STATUSES)[number]
export type DayStatusActor = 'user' | 'system' | 'auto'

export function isValidDayCompletion(value: unknown): value is DayCompletion {
  if (typeof value !== 'string') return false
  return (DAY_COMPLETION_STATUSES as readonly string[]).includes(value.toLowerCase().trim())
}

export function normalizeDayCompletion(value: string): DayCompletion {
  const lower = value.toLowerCase().trim()
  if ((DAY_COMPLETION_STATUSES as readonly string[]).includes(lower)) {
    return lower as DayCompletion
  }
  throw new Error(
    `Invalid day completion status: "${value}". Must be one of: ${DAY_COMPLETION_STATUSES.join(', ')}`,
  )
}
