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

/** Which axis a progression can actually move, from the tracking type (or a
 * best-effort inference from the previous values when the caller has no type —
 * keeps old call sites and loose rows working). */
type ProgressionAxis = 'load' | 'reps' | 'duration' | 'distance' | 'distance_time' | 'assistance' | 'none'
function axisFor(tracking: TrackingType | undefined, p: SetValues): ProgressionAxis {
  switch (tracking) {
    case 'weight_reps': case 'weight_time': return 'load'
    case 'bodyweight_reps': case 'reps': return 'reps'
    case 'time': return 'duration'
    case 'distance': return 'distance'
    case 'distance_time': return 'distance_time'
    case 'assisted': return 'assistance'
    default: break
  }
  if (p.load_kg !== null) return 'load'
  if (p.assistance_kg !== null) return 'assistance'
  if (p.distance_m !== null && p.duration_s !== null) return 'distance_time'
  if (p.distance_m !== null) return 'distance'
  if (p.duration_s !== null) return 'duration'
  if (p.reps !== null) return 'reps'
  return 'none'
}

/**
 * Multi-axis progression (T-IMPL-B / report T1): every tracking type moves, not
 * just loaded lifts.
 *
 * Per axis, for any non-manual rule kind:
 *  - load (weight_reps / weight_time): as before — double adds a rep first,
 *    fixed/percentage/rir add load; the plate-inventory fallback keeps loads
 *    the user can actually assemble.
 *  - reps (bodyweight_reps / reps, and any lift whose last session has no
 *    load): +1 rep per session up to max_reps, then the ladder RESTARTS at
 *    min_reps and the returned `addSet` flag is true — a per-slot function
 *    cannot grant a set, so the launcher (launchRoutine) consumes the flag
 *    and appends ONE extra set to the session. Every load-oriented rule kind
 *    degrades to this stepping on a rep-only lift, so "Reps first, then
 *    weight" works standalone for bodyweight work.
 *  - time / distance / distance_time: +5% step (min +1 unit) on duration
 *    and/or distance.
 *  - assisted: reduce assistance by the rule's increment (the lift gets
 *    harder by unloading less).
 */
export function nextProgression(input: { previous: SetValues; rule: ProgressionRule; tracking_type?: TrackingType; inventory?: { bar: {weight_kg:number;count:number}; plates: Plate[]; handles?: number } }): { values: SetValues; explanation: string; addSet: boolean } {
  const rule = ProgressionRule.parse(input.rule); const p = input.previous
  const axis = axisFor(input.tracking_type, p)
  let { load_kg: load, reps } = p
  let duration = p.duration_s; let distance = p.distance_m; let assistance = p.assistance_kg
  let reason = 'Keep the planned values; change them manually if needed.'
  let addSet = false
  if (rule.kind === 'manual' || rule.kind === 'program' || axis === 'none') {
    return { values:{...p,load_kg:load,reps,duration_s:duration,distance_m:distance,assistance_kg:assistance}, explanation:reason, addSet }
  }
  if (axis === 'load' && load !== null) {
    const increase = rule.kind==='fixed' || rule.kind==='percentage' || (rule.kind==='double' && (reps ?? 0)>=rule.max_reps) || (rule.kind==='rir' && (p.rir ?? -1)>=rule.target_rir)
    if (increase) { load += rule.kind==='percentage' ? load*rule.increment/100 : rule.increment; reason = `${rule.kind} progression from the last completed performance.`; if(rule.kind==='double') reps=rule.min_reps }
    else if(rule.kind==='double' && reps!==null) { reps=Math.min(rule.max_reps,reps+1); reason='Add one rep before increasing load.' }
    if (input.inventory && load!==p.load_kg) {
      const result=calculatePlates(load,input.inventory.bar,input.inventory.plates,input.inventory.handles ?? 1)
      if (!result.exact) { load=p.load_kg; reps=p.reps===null?null:p.reps+1; reason='The next load cannot be assembled from your inventory. Keep the load and add one rep.' }
    }
  } else if (axis === 'reps') {
    const atCeiling = (reps ?? 0) >= rule.max_reps
    const heldByRir = rule.kind === 'rir' && (p.rir ?? -1) < rule.target_rir
    if (heldByRir || reps === null) {
      reason = rule.kind === 'rir' ? 'Hold these values until you can leave more reps in the tank.' : reason
    } else if (atCeiling) {
      reps = rule.min_reps
      addSet = true
      reason = `You hit ${rule.max_reps} reps — the ladder restarts at ${rule.min_reps} and one more set joins the plan.`
    } else {
      reps = (reps ?? 0) + 1
      reason = 'Add one rep — the rep ladder climbs before anything else moves.'
    }
  } else if (axis === 'duration' || axis === 'distance' || axis === 'distance_time') {
    if (axis !== 'distance' && duration !== null) { duration = Math.max(duration + 1, Math.round(duration * 1.05)); reason = 'Add about 5% to the time under tension.' }
    if (axis !== 'duration' && distance !== null) { distance = Math.max(distance + 1, Math.round(distance * 1.05)); reason = 'Add about 5% to the distance.' }
  } else if (axis === 'assistance' && assistance !== null) {
    assistance = Math.max(0, Math.round((assistance - rule.increment) * 100) / 100)
    reason = `Reduce the assistance by ${rule.increment} kg — you lifted more of your own bodyweight.`
  }
  return { values:{...p,load_kg:load,reps,duration_s:duration,distance_m:distance,assistance_kg:assistance}, explanation:reason, addSet }
}
