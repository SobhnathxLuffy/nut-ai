import { ProgressionRule, type SetValues, type TrackingType } from '@nutai/core-schema'
import { calculatePlates, type Plate } from './equipment.js'
export interface Performance extends SetValues { id: number; exercise_id: number; workout_id: number; at: number; local_date: string; tracking_type: TrackingType; kind: string }
export interface PersonalRecord { id: string; exercise_id: number; workout_id: number; at: number; local_date: string; kind: string; value: number; unit: string }
export function deriveRecords(sets: readonly Performance[]): PersonalRecord[] {
  const best = new Map<string, number>(); const records: PersonalRecord[] = []
  const ordered = [...sets].filter(s=>s.kind!=='warmup' && s.kind!=='cooldown').sort((a,b)=>a.at-b.at || a.id-b.id)
  function consider(s: Performance, kind: string, value: number | null, unit: string, lower = false) {
    if (value === null || !Number.isFinite(value)) return
    const key = `${s.exercise_id}:${kind}`; const prev = best.get(key)
    if (prev === undefined || (lower ? value<prev : value>prev)) {
      best.set(key,value); records.push({ id: `${s.id}:${kind}`, exercise_id:s.exercise_id, workout_id:s.workout_id, at:s.at, local_date:s.local_date, kind, value, unit })
    }
  }
  const volumes = new Map<string,{set:Performance;volume:number}>()
  for (const s of ordered) {
    consider(s,'heaviest load',s.load_kg,'kg')
    consider(s,'most reps',s.reps,'reps')
    consider(s,'longest duration',s.duration_s,'s')
    consider(s,'longest distance',s.distance_m,'m')
    if (s.assistance_kg !== null && s.reps !== null) consider(s,`least assistance for ${s.reps} reps`,s.assistance_kg,'kg assistance',true)
    if (s.load_kg !== null && s.reps !== null) {
      consider(s,`best ${s.reps}-rep load`,s.load_kg,'kg')
      const volume = s.load_kg*s.reps
      consider(s,'set volume',volume,'kg·reps')
      // Bodyweight is not guessed. Epley is displayed only for external-load lifts and 1–12 reps.
      if (s.tracking_type==='weight_reps' && s.reps>0 && s.reps<=12) consider(s,'estimated 1RM',s.reps===1 ? s.load_kg : s.load_kg*(1+s.reps/30),'kg (Epley)')
      const key = `${s.workout_id}:${s.exercise_id}`
      volumes.set(key,{set:s,volume:(volumes.get(key)?.volume ?? 0)+volume})
    }
  }
  for (const {set,volume} of volumes.values()) consider(set,'session volume',volume,'kg·reps')
  return records.sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id))
}
export function nextProgression(input: { previous: SetValues; rule: ProgressionRule; inventory?: { bar: {weight_kg:number;count:number}; plates: Plate[]; handles?: number } }): { values: SetValues; explanation: string } {
  const rule = ProgressionRule.parse(input.rule); const p = input.previous
  let load = p.load_kg; let reps = p.reps
  let reason = 'Keep the planned values; change them manually if needed.'
  if (load !== null && rule.kind !== 'manual' && rule.kind !== 'program') {
    const increase = rule.kind==='fixed' || rule.kind==='percentage' || (rule.kind==='double' && (reps ?? 0)>=rule.max_reps) || (rule.kind==='rir' && (p.rir ?? -1)>=rule.target_rir)
    if (increase) { load += rule.kind==='percentage' ? load*rule.increment/100 : rule.increment; reason = `${rule.kind} progression from the last completed performance.`; if(rule.kind==='double') reps=rule.min_reps }
    else if(rule.kind==='double' && reps!==null) { reps=Math.min(rule.max_reps,reps+1); reason='Add one rep before increasing load.' }
    if (input.inventory && load!==p.load_kg) {
      const result=calculatePlates(load,input.inventory.bar,input.inventory.plates,input.inventory.handles ?? 1)
      if (!result.exact) { load=p.load_kg; reps=p.reps===null?null:p.reps+1; reason='The next load cannot be assembled from your inventory. Keep the load and add one rep.' }
    }
  }
  return { values:{...p,load_kg:load,reps}, explanation:reason }
}
