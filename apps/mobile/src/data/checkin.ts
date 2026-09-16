import { createSyncMetadata, recordOperation, setDayStatus, getDayStatus, validateLocalDate, type DbAdapter, type SetDayStatusInput } from '@nutai/db-adapter'
import { weeklyMetrics, suggestTargets, safetyFlags, type CheckinDay, type SafetyProfile, type AdaptiveTarget } from '@nutai/goals'
import { dateOffset } from './shortcuts'
export async function changeDayStatus(db:DbAdapter,input:SetDayStatusInput):Promise<void> {
  await db.transaction(async tx=>{const before=await getDayStatus(tx,input.localDate);const next=await setDayStatus(tx,input)
    await recordOperation(tx,{entityType:'day_status',entityId:Number(input.localDate.replaceAll('-','')),opType:before?'update':'insert',prevJson:before?{...before}:null,newJson:{...next},createdAt:input.now??Date.now()})
  })
}
export async function checkinDays(db:DbAdapter,start:string,end:string):Promise<CheckinDay[]> {
  validateLocalDate(start);validateLocalDate(end);if(end<start||Date.parse(end)-Date.parse(start)>366*86400000)throw new Error('Invalid check-in range')
  const days:CheckinDay[]=[]
  for(let date=start;date<=end;date=dateOffset(date,1)){
    const status=await getDayStatus(db,date)
    const nutrition=await db.get<{kcal:number|null;protein:number|null;missing:number;count:number}>(`SELECT SUM(s.snap_energy_kcal*s.grams/100*m.portion_eaten_fraction) kcal,SUM(s.snap_protein_g*s.grams/100*m.portion_eaten_fraction) protein,SUM(CASE WHEN s.snap_energy_kcal IS NULL THEN 1 ELSE 0 END) missing,COUNT(*) count FROM meals m JOIN log_items s ON s.meal_id=m.id WHERE m.local_date=? AND m.deleted_at IS NULL AND s.deleted_at IS NULL AND m.analysis_status IN ('complete','manual')`,[date])
    const weight=await db.get<{weight_kg:number}>('SELECT weight_kg FROM weight_entries WHERE local_date=? AND deleted_at IS NULL ORDER BY logged_at DESC,id DESC LIMIT 1',[date])
    const training=await db.get<{n:number}>("SELECT COUNT(*) n FROM workouts WHERE local_date=? AND status='completed' AND deleted_at IS NULL",[date])
    const goal=await db.get<{protein_g:number}>('SELECT protein_g FROM goals WHERE effective_from<=? AND deleted_at IS NULL ORDER BY effective_from DESC,id DESC LIMIT 1',[new Date(`${date}T23:59:59`).getTime()])
    const pending=await db.get<{n:number}>("SELECT COUNT(*) n FROM meals WHERE local_date=? AND deleted_at IS NULL AND analysis_status NOT IN ('complete','manual')",[date])
    const intentional=status?.completion==='fasting'||status?.completion==='complete'
    days.push({date,status:status?.completion??'unknown',kcal:nutrition?.missing?null:nutrition?.kcal??(intentional?0:null),protein_g:nutrition?.protein??(intentional?0:null),protein_target:goal?.protein_g??null,weight_kg:weight?.weight_kg??null,completed_workouts:training?.n??0,pending:(pending?.n??0)>0})
  }
  return days
}
export interface SafetySettings {reviewed:boolean;pregnant:boolean;lactating:boolean;eating_disorder_risk:boolean;locks:{kcal:boolean;protein:boolean;fat:boolean;carbs:boolean}}
export const DEFAULT_SAFETY:SafetySettings={reviewed:false,pregnant:false,lactating:false,eating_disorder_risk:false,locks:{kcal:true,protein:true,fat:false,carbs:false}}
export async function readSafety(db:DbAdapter):Promise<SafetySettings> {
  const row=await db.get<{value:string}>("SELECT value FROM settings WHERE key='checkin.safety'")
  if(!row)return DEFAULT_SAFETY
  try{const value=JSON.parse(row.value) as SafetySettings
    if([value.reviewed,value.pregnant,value.lactating,value.eating_disorder_risk,...Object.values(value.locks)].some(v=>typeof v!=='boolean')||Object.keys(value.locks).length!==4)return DEFAULT_SAFETY
    return value
  }catch{return DEFAULT_SAFETY}
}
export async function saveSafety(db:DbAdapter,value:SafetySettings):Promise<void> {
  if([value.reviewed,value.pregnant,value.lactating,value.eating_disorder_risk,value.locks.kcal,value.locks.protein,value.locks.fat,value.locks.carbs].some(v=>typeof v!=='boolean'))throw new Error('Invalid safety settings')
  await db.run("INSERT INTO settings(key,value) VALUES('checkin.safety',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify(value)])
}
interface GoalRow {id:number;uuid:string;target_kcal:number;protein_g:number;fat_g:number;carbs_g:number;goal_type:string;rate_lb_per_week:number|null;bmr:number;tdee:number;effective_from:number}
export async function reviewCheckin(db:DbAdapter,end:string,now=Date.now()) {
  validateLocalDate(end)
  const all=await checkinDays(db,dateOffset(end,-20),end)
  const metrics=weeklyMetrics(all.slice(-7),all)
  const goal=await db.get<GoalRow>('SELECT * FROM goals WHERE deleted_at IS NULL ORDER BY effective_from DESC,id DESC LIMIT 1')
  const settings=await readSafety(db)
  const profile=await db.get<{birth_year:number|null;sex:SafetyProfile['sex'];height_cm:number|null}>('SELECT * FROM user_profile WHERE id=1')
  const safety:SafetyProfile={...settings,age:profile?.birth_year?new Date(now).getFullYear()-profile.birth_year-1:null,sex:profile?.sex??'unspecified',bmr:goal?.bmr??0,weight_kg:metrics.weight_trend_kg,height_cm:profile?.height_cm??null}
  const old:AdaptiveTarget=goal?{kcal:goal.target_kcal,protein_g:goal.protein_g,fat_g:goal.fat_g,carbs_g:goal.carbs_g}:{kcal:0,protein_g:0,fat_g:0,carbs_g:0}
  const signedRate=goal?.goal_type==='lose'?-Math.abs(goal.rate_lb_per_week??0.5)/2.2046226218:goal?.goal_type==='gain'?Math.abs(goal.rate_lb_per_week??0.5)/2.2046226218:0
  const last=await db.get<{effective_from:number}>('SELECT effective_from FROM goals WHERE adaptive_evidence_json IS NOT NULL AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1')
  const cooldown=last!==null&&now-last.effective_from<7*86400000
  const suggestion=goal&&!cooldown?suggestTargets(metrics,old,safety,signedRate,settings.locks):null
  const fingerprint=JSON.stringify({goal:goal?.uuid,metrics,settings,end})
  return {metrics,goal,settings,safety,flags:safetyFlags(safety),suggestion,fingerprint,cooldown,end}
}
export async function acceptCheckin(db:DbAdapter,end:string,fingerprint:string,confirmed:boolean,now=Date.now()):Promise<number> {
  if(confirmed!==true)throw new Error('Explicit confirmation is required')
  return db.transaction(async tx=>{
    const review=await reviewCheckin(tx,end,now)
    if(review.fingerprint!==fingerprint)throw new Error('Your data changed. Review the refreshed suggestion before accepting.')
    if(!review.suggestion||!review.goal||review.flags.length)throw new Error('No safe suggestion is available')
    const s=review.suggestion;const g=review.goal;const sync=createSyncMetadata(now)
    const result=await tx.run(`INSERT INTO goals(effective_from,goal_type,rate_lb_per_week,target_kcal,target_raw_kcal,floor_applied,protein_g,fat_g,carbs_g,bmr,tdee,adaptive,uuid,created_at,updated_at,revision,deleted_at,sync_state,adaptive_evidence_json) VALUES(?,?,?,?,?,0,?,?,?,?,?,1,?,?,?,?,?,?,?)`,[now,g.goal_type,g.rate_lb_per_week,s.proposed.kcal,s.proposed.kcal,s.proposed.protein_g,s.proposed.fat_g,s.proposed.carbs_g,g.bmr,g.tdee,sync.uuid,now,now,1,null,'local',JSON.stringify({local_date:end,metrics:review.metrics,suggestion:s,accepted_at:now})])
    const id=Number(result.lastInsertRowId);const row=await tx.get<Record<string,unknown>>('SELECT * FROM goals WHERE id=?',[id])
    await recordOperation(tx,{entityType:'goals',entityId:id,opType:'insert',newJson:row,actor:'user',createdAt:now,idempotencyKey:`checkin:${g.uuid}:${end}`})
    return id
  })
}
