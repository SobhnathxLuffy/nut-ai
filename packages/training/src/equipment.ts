import { EquipmentInput } from '@nutai/core-schema'
export interface Plate { weight_kg: number; count: number }
export interface Loading { load_kg: number; per_side: Plate[]; total_plates: number; delta_kg: number }
/** Bounded knapsack, not greedy: fractional plates and limited counts can defeat greedy loading. */
export function calculatePlates(target: number, bar: { weight_kg: number; count: number }, plates: readonly Plate[], implementsCount = 1, reserved: readonly Plate[] = []): { lower: Loading | null; upper: Loading | null; exact: Loading | null } {
  if (!Number.isFinite(target) || target < 0 || !Number.isInteger(implementsCount) || implementsCount < 1 || implementsCount > 2 || bar.count < implementsCount || !Number.isFinite(bar.weight_kg) || bar.weight_kg < 0) throw new Error('Invalid load, bar, or number of handles')
  const pool = new Map<number, number>()
  for (const p of plates) {
    EquipmentInput.parse({ name: 'Plate', kind: 'plate', ...p })
    if (p.weight_kg <= 0) throw new Error('Plate weight must be positive')
    const grams = Math.round(p.weight_kg * 1000)
    pool.set(grams, (pool.get(grams) ?? 0) + p.count)
  }
  for (const p of reserved) {
    if (!Number.isInteger(p.count) || p.count < 0 || !Number.isFinite(p.weight_kg)) throw new Error('Invalid reserved plates')
    const grams = Math.round(p.weight_kg * 1000)
    const remaining = (pool.get(grams) ?? 0) - p.count
    if (remaining < 0) throw new Error('Reserved plates exceed inventory')
    pool.set(grams, remaining)
  }
  let states = new Map<number, Plate[]>([[0, []]])
  for (const [grams, count] of [...pool].sort((a,b) => b[0]-a[0])) {
    const next = new Map(states)
    for (const [sum, config] of states) for (let n = 1; n <= Math.floor(count / (2*implementsCount)); n++) {
      const key = sum + n * grams
      const candidate = [...config, { weight_kg: grams/1000, count: n }]
      const previous = next.get(key)
      if (!previous || candidate.reduce((s,p) => s+p.count,0) < previous.reduce((s,p) => s+p.count,0)) next.set(key,candidate)
    }
    if (next.size > 100000) throw new Error('Inventory has too many distinct combinations; simplify plate sizes')
    states = next
  }
  const loads = [...states].map(([grams, per_side]) => ({ load_kg: Math.round(bar.weight_kg*1000 + 2*grams)/1000, per_side, total_plates: per_side.reduce((s,p)=>s+p.count,0)*2*implementsCount, delta_kg: Math.round((bar.weight_kg+2*grams/1000-target)*1000)/1000 })).sort((a,b)=>a.load_kg-b.load_kg)
  return { lower: loads.filter(l=>l.delta_kg<=0).at(-1) ?? null, upper: loads.find(l=>l.delta_kg>=0) ?? null, exact: loads.find(l=>l.delta_kg===0) ?? null }
}
export const toKg = (value: number, unit: 'kg'|'lb'): number => unit === 'lb' ? value * 0.45359237 : value
