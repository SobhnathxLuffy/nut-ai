export const LB_PER_KG = 2.2046226218

export type WeightUnit = 'kg' | 'lb'

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG
}

export function weightValueFromKg(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kgToLb(kg) : kg
}

export function formatWeightKg(kg: number | null, unit: WeightUnit, fractionDigits = 1): string {
  if (kg === null || !Number.isFinite(kg)) return '—'
  return `${weightValueFromKg(kg, unit).toFixed(fractionDigits)} ${unit}`
}
