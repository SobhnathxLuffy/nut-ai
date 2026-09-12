import { validateLocalDate, type DbAdapter } from '@nutai/db-adapter'
import { deriveRecords, performanceHistory } from '@nutai/training'
export type TimelineType='meal'|'weight'|'workout'|'exercise'|'checkin'|'pr'|'operation'|'day_status'
export interface TimelineEvent {id:string;type:TimelineType;entity_id:number;at:number;local_date:string;label:string;detail:string;deleted:boolean}
const priority:Record<TimelineType,number>={meal:0,weight:1,exercise:2,workout:3,pr:4,day_status:5,checkin:6,operation:7}
export const orderTimeline=(events:TimelineEvent[]):TimelineEvent[]=>[...events].sort((a,b)=>a.at-b.at||priority[a.type]-priority[b.type]||a.id.localeCompare(b.id,'en'))
export async function timeline(db:DbAdapter,start:string,end=start,includeUndo=false):Promise<TimelineEvent[]> {
  validateLocalDate(start);validateLocalDate(end);if(end<start)throw new Error('Invalid date range')
  // local_date is the captured day, not a recalculation in the viewer's timezone.
  const rows=await db.all<TimelineEvent>(`
   SELECT 'meal:'||m.uuid id,'meal' type,m.id entity_id,m.logged_at at,m.local_date,
     COALESCE(m.meal_slot,'Meal') label,COALESCE((SELECT group_concat(display_name,', ') FROM log_items WHERE meal_id=m.id AND deleted_at IS NULL),'Analysis pending') detail,m.deleted_at IS NOT NULL deleted FROM meals m
   UNION ALL SELECT 'weight:'||uuid,'weight',id,logged_at,local_date,'Bodyweight',weight_kg||' kg',deleted_at IS NOT NULL FROM weight_entries
   UNION ALL SELECT 'workout:'||uuid,'workout',id,COALESCE(finished_at,started_at),local_date,name,status,deleted_at IS NOT NULL FROM workouts
   UNION ALL SELECT 'exercise:'||uuid,'exercise',id,logged_at,local_date,name,kcal||' kcal activity (separate from food targets)',deleted_at IS NOT NULL FROM exercise_entries
   UNION ALL SELECT 'day:'||local_date,'day_status',CAST(replace(local_date,'-','') AS INTEGER),updated_at,local_date,'Day status',completion,0 FROM day_status
  `)
  const events=rows.filter(r=>r.local_date>=start&&r.local_date<=end&&(includeUndo||!r.deleted)).map(r=>({...r,deleted:Boolean(r.deleted)}))
  for(const pr of deriveRecords(await performanceHistory(db)))if(pr.local_date>=start&&pr.local_date<=end)events.push({id:`pr:${pr.id}`,type:'pr',entity_id:pr.workout_id,at:pr.at,local_date:pr.local_date,label:pr.kind,detail:`${Math.round(pr.value*10)/10} ${pr.unit}`,deleted:false})
  const ops=await db.all<{id:number;uuid:string;created_at:number;new_json:string|null;undone_at:number|null;entity_type:string}>('SELECT * FROM operations WHERE entity_type IN (\'goals\',\'batch\') ORDER BY created_at,id')
  for(const op of ops){
    if(op.entity_type!=='goals'&&!includeUndo)continue
    const payload=op.new_json?JSON.parse(op.new_json) as Record<string,unknown>:null
    const evidence=payload?.['adaptive_evidence_json'];let day:string|undefined
    if(typeof evidence==='string')day=(JSON.parse(evidence) as {local_date?:string}).local_date
    if(day&&day>=start&&day<=end&&(includeUndo||op.undone_at===null))events.push({id:`checkin:${op.uuid}`,type:'checkin',entity_id:op.id,at:op.created_at,local_date:day,label:'Weekly check-in accepted',detail:'Target change confirmed by you',deleted:op.undone_at!==null})
  }
  return orderTimeline(events)
}
