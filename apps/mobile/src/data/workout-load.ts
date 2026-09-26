import { kgToLb, lbToKg, type WeightUnit } from '@nutai/analytics'
import { SetValues } from '@nutai/core-schema'
import type { WorkoutSet } from '@nutai/training'

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
