import { computeTrend, trendSlopeLbPerWeek, LB_PER_KG, safeFloor, type Sex } from './index.js'
export interface CheckinDay {date:string;status:'complete'|'partial'|'unknown'|'fasting';kcal:number|null;protein_g:number|null;protein_target:number|null;weight_kg:number|null;completed_workouts:number;pending?:boolean}
export interface WeeklyMetrics {included_dates:string[];excluded_dates:{date:string;reason:string}[];fasting_dates:string[];average_kcal:number|null;average_protein_g:number|null;protein_compliance:number|null;protein_days:number;completed_workouts:number;weight_trend_kg:number|null;weight_change_kg_week:number|null;weigh_in_count:number;weight_span_days:number}
export function weeklyMetrics(days:readonly CheckinDay[],weightDays:readonly CheckinDay[]=days):WeeklyMetrics {
  const byDate=new Map(days.map(d=>[d.date,d]));if(byDate.size!==days.length)throw new Error('Duplicate check-in dates')
  const included=days.filter(d=>(d.status==='complete'||d.status==='fasting')&&!d.pending&&d.kcal!==null)
  const protein=included.filter(d=>d.protein_g!==null&&d.protein_target!==null&&d.protein_target>0)
  const weights=weightDays.filter(d=>(d.status==='complete'||d.status==='fasting')&&!d.pending&&d.weight_kg!==null&&d.weight_kg>0).sort((a,b)=>a.date.localeCompare(b.date))
  const trend=computeTrend(weights.map(d=>({day:Math.floor(Date.parse(`${d.date}T12:00:00Z`)/86400000),weightKg:d.weight_kg!})))
  const span=weights.length?Math.round((Date.parse(weights.at(-1)!.date)-Date.parse(weights[0]!.date))/86400000):0
  const slope=span>=7&&weights.length>=3?trendSlopeLbPerWeek(trend):null
  return {
    included_dates:included.map(d=>d.date),excluded_dates:days.filter(d=>!included.includes(d)).map(d=>({date:d.date,reason:d.pending?'Analysis pending':d.kcal===null&&(d.status==='complete'||d.status==='fasting')?'Nutrition unavailable':d.status})),
    fasting_dates:days.filter(d=>d.status==='fasting').map(d=>d.date),
    average_kcal:included.length?included.reduce((s,d)=>s+d.kcal!,0)/included.length:null,
    average_protein_g:included.some(d=>d.protein_g!==null)?included.filter(d=>d.protein_g!==null).reduce((s,d)=>s+d.protein_g!,0)/included.filter(d=>d.protein_g!==null).length:null,
    protein_compliance:protein.length?protein.filter(d=>d.protein_g!>=d.protein_target!).length/protein.length:null,protein_days:protein.length,
    completed_workouts:days.reduce((s,d)=>s+d.completed_workouts,0),weight_trend_kg:trend.at(-1)?.trendKg??null,weight_change_kg_week:slope===null?null:slope/LB_PER_KG,weigh_in_count:weights.length,weight_span_days:span,
  }
}
export interface SafetyProfile {age:number|null;pregnant:boolean;lactating:boolean;eating_disorder_risk:boolean;reviewed:boolean;sex:Sex;bmr:number;weight_kg:number|null;height_cm:number|null}
export function safetyFlags(p:SafetyProfile):string[] {
  const flags:string[]=[]
  if(!p.reviewed||p.age===null||!Number.isFinite(p.age))flags.push('Please review your safety information first.')
  else if(p.age<18)flags.push('Adaptive changes are unavailable for people under 18.')
  if(p.pregnant||p.lactating)flags.push('Pregnancy or lactation needs individual professional guidance.')
  if(p.eating_disorder_risk)flags.push('Use targets agreed with a qualified professional when eating or weight tracking is a concern.')
  if(!Number.isFinite(p.bmr)||p.bmr<=0)flags.push('A valid baseline is needed before suggesting changes.')
  if(p.weight_kg!==null&&p.height_cm!==null&&p.weight_kg/(p.height_cm/100)**2<18.5)flags.push('Adaptive changes are unavailable at a low body weight; seek individual guidance.')
  return flags
}
export interface AdaptiveTarget {kcal:number;protein_g:number;fat_g:number;carbs_g:number}
export interface AdaptiveSuggestion {old:AdaptiveTarget;proposed:AdaptiveTarget;reason:string;confidence:'limited'|'moderate';safety_flags:string[];delta_kcal:number}
export const MAX_WEEKLY_KCAL_CHANGE=150
export function suggestTargets(metrics:WeeklyMetrics,current:AdaptiveTarget,safety:SafetyProfile,goalRateKgWeek:number,locks:{kcal:boolean;protein:boolean;fat:boolean;carbs:boolean}):AdaptiveSuggestion|null {
  if(safetyFlags(safety).length||locks.kcal||metrics.included_dates.length<5||metrics.average_kcal===null||metrics.weight_change_kg_week===null||metrics.weigh_in_count<3||metrics.weight_span_days<7)return null
  if(!Number.isFinite(goalRateKgWeek)||Math.abs(goalRateKgWeek)>0.5)return null
  // Feedback gain 0.25, bounded at 150 kcal/week. Exercise kcal are intentionally absent.
  const observedMaintenance=metrics.average_kcal-metrics.weight_change_kg_week*7700/7
  const desired=observedMaintenance+goalRateKgWeek*7700/7
  let delta=Math.round(Math.max(-MAX_WEEKLY_KCAL_CHANGE,Math.min(MAX_WEEKLY_KCAL_CHANGE,(desired-current.kcal)*0.25))/25)*25
  const floor=safeFloor(safety.sex,safety.bmr)
  const kcal=Math.max(floor,current.kcal+delta);delta=kcal-current.kcal
  if(Math.abs(delta)>MAX_WEEKLY_KCAL_CHANGE||Math.abs(delta)<25||kcal>5000)return null
  const proposed={...current,kcal}
  if(!locks.protein&&safety.weight_kg!==null)proposed.protein_g=Math.round(safety.weight_kg*1.6)
  if(!locks.fat)proposed.fat_g=Math.round(kcal*0.25/9)
  if(!locks.carbs)proposed.carbs_g=Math.round((kcal-proposed.protein_g*4-proposed.fat_g*9)/4)
  if(proposed.carbs_g<0)return null
  return {old:current,proposed,delta_kcal:delta,confidence:metrics.included_dates.length===7?'moderate':'limited',safety_flags:[],reason:`${metrics.included_dates.length} finalized days; ${metrics.weigh_in_count} weigh-ins across ${metrics.weight_span_days} days. EWMA trend ${metrics.weight_change_kg_week.toFixed(2)} kg/week. Adjustment limited to ${MAX_WEEKLY_KCAL_CHANGE} kcal/week. Exercise calories stay separate.`}
}
