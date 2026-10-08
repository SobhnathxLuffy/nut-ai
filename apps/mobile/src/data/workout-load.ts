import { kgToLb, lbToKg, type WeightUnit } from '@nutai/analytics'
import { SetKind, SetValues } from '@nutai/core-schema'
import type { WorkoutSet } from '@nutai/training'

/**
 * T-IMPL-B E2 (jargon education): plain-language explainers that travel to the
 * point of use — a Field hint or a caption under the chip that uses the term.
 * Never a glossary screen; every entry is one sentence a beginner can act on.
 */
export const JARGON_HINTS = {
  rir: 'RIR = Reps In Reserve — how many more reps you could have done.',
  rpe: 'RPE = Rate of Perceived Effort — 10 = nothing left in the tank.',
  tempo: 'Tempo 3-1-2-0: down seconds – pause – up seconds – pause.',
  amrap: 'AMRAP = As Many Reps As Possible.',
  e1rm: 'Estimated 1RM — the heaviest single you could likely do today (Epley formula).',
} as const

/** Set kinds in English (T-IMPL-B E2) — the raw engine enums never render alone. */
export const SET_KIND_LABELS: Record<SetKind, string> = {
  normal: 'Normal',
  warmup: 'Warm-up',
  drop: 'Drop set',
  failure: 'To failure',
  amrap: 'AMRAP',
  myo: 'Myo-reps',
  cluster: 'Cluster set',
  cooldown: 'Cooldown',
}

/** The plain-language effort picker (T-IMPL-B E1): three answers a beginner
 * already uses, mapped onto the internal RPE/RIR pair the progression engine
 * reads (RPE 8 ≈ 2 reps in reserve). This is the rir-rule input path for
 * anyone who never opens the advanced fields. */
export const EFFORT_PICKS = [
  { key: 'easy', label: 'Easy', rpe: 6, rir: 4 },
  { key: 'two_more', label: 'Could do 2 more', rpe: 8, rir: 2 },
  { key: 'barely', label: 'Barely finished', rpe: 9.5, rir: 0.5 },
] as const

/** The routine-editor progression kinds named by what they DO for the user
 * (T-IMPL-B A4): the engine taxonomy ("double/fixed/percentage") becomes an
 * outcome the user can choose on purpose. Keyed by the full schema union —
 * stored rows may still carry kind 'program' (the schema keeps it for
 * compatibility; the editor never offers it). */
export const PROGRESSION_KIND_LABELS: Record<string, string> = {
  double: 'Reps first, then weight',
  fixed: 'Add weight',
  percentage: 'Add weight',
  rir: 'RIR-based',
  manual: 'Manual',
  program: 'Program',
}

/** One plain sentence under the progression chips describing the SELECTED
 * kind (T-IMPL-B E2, point-of-use — not a glossary). */
export const PROGRESSION_KIND_HINTS: Record<string, string> = {
  double: 'Reps climb one at a time; once you hit max reps, the weight goes up and reps reset.',
  fixed: 'Adds the same amount of weight every session.',
  percentage: 'Adds a percentage of the current weight every session.',
  rir: 'Adds weight when you finish with the target reps to spare.',
  manual: 'Nothing changes by itself — you set every number.',
  program: 'The program decides the progression.',
}

export function getFieldLabels(unit: WeightUnit): Record<string, string> {
  return {
    load_kg: unit === 'lb' ? 'Load (lb)' : 'Load (kg)',
    reps: 'Reps',
    duration_s: 'Duration (seconds)',
    distance_m: 'Distance (metres)',
    assistance_kg: unit === 'lb' ? 'Assistance (lb)' : 'Assistance (kg)',
    rir: 'RIR',
    rpe: 'RPE',
    tempo: 'Tempo',
  }
}

export function formatLoadForDisplay(kg: number | null, unit: WeightUnit): string {
  if (kg === null || !Number.isFinite(kg)) return ''
  const val = unit === 'lb' ? kgToLb(kg) : kg
  return String(Math.round(val * 100) / 100)
}

export function describeSet(s: WorkoutSet | Record<string, unknown>, unit: WeightUnit = 'kg'): string {
  const labels = getFieldLabels(unit)
  return Object.entries(SetValues.parse(s))
    .filter(([, v]) => v !== null)
    .map(([k, v]) => {
      if ((k === 'load_kg' || k === 'assistance_kg') && typeof v === 'number') {
        return `${formatLoadForDisplay(v, unit)} ${labels[k] ?? k}`
      }
      return `${v} ${labels[k] ?? k}`
    })
    .join(' · ')
}

export function setValuesToDisplay(parsed: SetValues, unit: WeightUnit): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [
      k,
      v === null
        ? ''
        : (k === 'load_kg' || k === 'assistance_kg') && typeof v === 'number'
        ? formatLoadForDisplay(v, unit)
        : String(v),
    ])
  )
}

export function canonicalizeFieldValue(
  key: string,
  text: string,
  unit: WeightUnit
): { valid: boolean; value: number | string | null } {
  if (text === '') return { valid: true, value: null }
  if (key === 'tempo') {
    const valid = !text || /^(\d+|X)-(\d+|X)-(\d+|X)-(\d+|X)$/.test(text)
    return { valid, value: text }
  }
  const parsed = Number(text)
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    return { valid: false, value: null }
  }
  if (key === 'load_kg' || key === 'assistance_kg') {
    return { valid: true, value: unit === 'lb' ? lbToKg(parsed) : parsed }
  }
  return { valid: true, value: parsed }
}
