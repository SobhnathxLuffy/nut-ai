import { ExerciseInput, EquipmentInput, RoutineInput, ProgramInput, ProgressionRule, SetKind, SetValues, validateSet, type TrackingType } from '@nutai/core-schema'
import { createSyncMetadata, deterministicUuidV7, generateUuidV7, recordOperation, validateLocalDate, type BatchChange, type DbAdapter, type SqlValue } from '@nutai/db-adapter'
import { EXERCISE_LIBRARY } from './library.js'
import { nextProgression, type Performance } from './progression.js'

export interface Exercise extends ExerciseInput { id:number; uuid:string; is_custom:number; source:string }
export interface Workout { id:number; uuid:string; name:string; local_date:string; started_at:number; finished_at:number|null; status:'active'|'completed'|'discarded'; notes:string; location:string; routine_id:number|null; rest_until:number|null }
export interface WorkoutExercise { id:number; exercise_id:number; workout_id:number; name:string; tracking_type:TrackingType; sort_order:number; superset_group_id:string|null; notes:string; sets:WorkoutSet[]; previous:WorkoutSet|null }
export interface WorkoutSet extends SetValues { id:number; workout_exercise_id:number; sort_order:number; kind:string; planned_json:string|null; completed_at:number|null }
export interface Equipment extends EquipmentInput {id:number}
export interface Routine {id:number; name:string; definition_json:string}
export type Program = Routine
type Row = Record<string, SqlValue>
const WRITE_TABLES = new Set(['exercises','equipment_inventory','routines','programs','workouts','workout_exercises','workout_sets','logging_shortcuts'])
/** Every write and its undo snapshot share a transaction. Keys are checked against actual schema metadata. */
export async function writeRow(tx:DbAdapter, table:string, values:Row, now:number, changes:BatchChange[], id?:number):Promise<number> {
  if(!WRITE_TABLES.has(table)) throw new Error('Unsupported training table')
  const allowed=new Set((await tx.all<{name:string}>(`PRAGMA table_info(${table})`)).map(c=>c.name))
  if(Object.keys(values).some(k=>!allowed.has(k) || ['id','uuid','created_at','revision'].includes(k))) throw new Error('Unsupported training field')
  const before=id===undefined ? null : await tx.get<Row>(`SELECT * FROM ${table} WHERE id=?`,[id])
  if(id!==undefined && !before) throw new Error('Record no longer exists')
  const row:Row=before ? {...values,updated_at:now,revision:Number(before['revision'])+1,sync_state:'local'} : {...values,...createSyncMetadata(now)}
  const keys=Object.keys(row)
  if(before) await tx.run(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`,[...keys.map(k=>row[k]!),id!])
  else id=Number((await tx.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]!))).lastInsertRowId)
  const next=await tx.get<Row>(`SELECT * FROM ${table} WHERE id=?`,[id!])
  changes.push({entityType:table,entityId:id!,opType:before?'update':'insert',prev:before,next})
  return id!
}
async function mutate<T>(db:DbAdapter,now:number,fn:(tx:DbAdapter,changes:BatchChange[])=>Promise<T>):Promise<T> {
  return db.transaction(async tx=>{
    const changes:BatchChange[]=[];const result=await fn(tx,changes)
    if(changes.length) await recordOperation(tx,{entityType:'batch',entityId:0,opType:'update',newJson:{changes},createdAt:now})
    return result
  })
}
function exerciseRow(e:ExerciseInput):Row {
  return {name:e.name,tracking_type:e.tracking_type,aliases_json:JSON.stringify(e.aliases),primary_muscles_json:JSON.stringify(e.primary_muscles),secondary_muscles_json:JSON.stringify(e.secondary_muscles),antagonist_muscles_json:JSON.stringify(e.antagonist_muscles),equipment_json:JSON.stringify(e.equipment),notes:e.notes,media_uri:e.media_uri}
}
export async function seedExercises(db:DbAdapter):Promise<void> {
  await db.transaction(async tx=>{
    for(const [i,e] of EXERCISE_LIBRARY.entries()) {
      const uuid=deterministicUuidV7(0,`nutai.exercise.v1:${e.name}`)
      if(await tx.get('SELECT id FROM exercises WHERE uuid=?',[uuid])) continue
      const row:Row={...exerciseRow(e),...createSyncMetadata(0),uuid,is_custom:0,source:'Nut AI original taxonomy v1',id:i+1}
      const keys=Object.keys(row) as (keyof typeof row)[]
      await tx.run(`INSERT INTO exercises (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]!))
    }
  })
}
export async function listExercises(db:DbAdapter):Promise<Exercise[]> {
  const rows=await db.all<Row>('SELECT * FROM exercises WHERE deleted_at IS NULL ORDER BY name,id')
  return rows.map(r=>{
    const base = {name:r['name'],tracking_type:r['tracking_type'],aliases:JSON.parse(String(r['aliases_json'])),primary_muscles:JSON.parse(String(r['primary_muscles_json'])),secondary_muscles:JSON.parse(String(r['secondary_muscles_json'])),antagonist_muscles:JSON.parse(String(r['antagonist_muscles_json'])),equipment:JSON.parse(String(r['equipment_json'])),notes:r['notes'],media_uri:r['media_uri']};
    const parsed = Number(r['is_custom']) ? ExerciseInput.parse(base) : base as any;
    return {...parsed,id:Number(r['id']),uuid:String(r['uuid']),is_custom:Number(r['is_custom']),source:String(r['source'])}
  })
}
export async function getExercise(db:DbAdapter,id:number):Promise<Exercise|null> {
  const r=await db.get<Row>('SELECT * FROM exercises WHERE id=? AND deleted_at IS NULL',[id])
  if(!r) return null
  const base = {name:r['name'],tracking_type:r['tracking_type'],aliases:JSON.parse(String(r['aliases_json'])),primary_muscles:JSON.parse(String(r['primary_muscles_json'])),secondary_muscles:JSON.parse(String(r['secondary_muscles_json'])),antagonist_muscles:JSON.parse(String(r['antagonist_muscles_json'])),equipment:JSON.parse(String(r['equipment_json'])),notes:r['notes'],media_uri:r['media_uri']}
  const parsed = Number(r['is_custom']) ? ExerciseInput.parse(base) : base as any
  return {...parsed,id:Number(r['id']),uuid:String(r['uuid']),is_custom:Number(r['is_custom']),source:String(r['source'])}
}
export async function isExerciseInWorkout(db:DbAdapter,workoutId:number,exerciseId:number):Promise<boolean> {
  const row=await db.get<{id:number}>('SELECT id FROM workout_exercises WHERE workout_id=? AND exercise_id=? AND deleted_at IS NULL LIMIT 1',[workoutId,exerciseId])
  return !!row
}
export async function createExercise(db:DbAdapter,input:unknown,now=Date.now()):Promise<number> {
  const e=ExerciseInput.parse(input)
  return mutate(db,now,(tx,c)=>writeRow(tx,'exercises',{...exerciseRow(e),is_custom:1,source:'user'},now,c))
}
export async function addExerciseToRoutine(db:DbAdapter,routineId:number,exerciseId:number,now=Date.now()):Promise<void> {
  const ex=await getExercise(db,exerciseId)
  if(!ex) throw new Error('Exercise not found')
  const defaultSet: SetValues = {
    load_kg: ex.tracking_type === 'weight_reps' ? 20 : null,
    reps: ['weight_reps', 'bodyweight_reps', 'reps', 'assisted'].includes(ex.tracking_type) ? 10 : null,
    duration_s: ['distance_time', 'time', 'weight_time'].includes(ex.tracking_type) ? 60 : null,
    distance_m: ['distance_time', 'distance'].includes(ex.tracking_type) ? 1000 : null,
    assistance_kg: ex.tracking_type === 'assisted' ? 20 : null,
    rir: null,
    rpe: null,
    tempo: null,
  }
  const defaultRule: ProgressionRule = {
    kind: 'double',
    increment: 2.5,
    min_reps: 8,
    max_reps: 12,
    target_rir: 2,
  }
  await mutate(db,now,async(tx,c)=>{
    const row=await tx.get<Routine>('SELECT * FROM routines WHERE id=? AND deleted_at IS NULL',[routineId])
    if(!row) throw new Error('Routine not found')
    const routine=RoutineInput.parse(JSON.parse(row.definition_json))
    routine.exercises.push({
      exercise_id: exerciseId,
      group: null,
      sets: [defaultSet, { ...defaultSet }, { ...defaultSet }],
      rule: defaultRule,
    })
    RoutineInput.parse(routine)
    await writeRow(tx,'routines',{definition_json:JSON.stringify(routine)},now,c,routineId)
  })
}
export const activeWorkout=(db:DbAdapter):Promise<Workout|null>=>db.get("SELECT * FROM workouts WHERE status='active' AND deleted_at IS NULL")
export const workoutHistory=(db:DbAdapter):Promise<Workout[]>=>db.all("SELECT * FROM workouts WHERE status='completed' AND deleted_at IS NULL ORDER BY started_at DESC,id DESC")
export async function startWorkout(db:DbAdapter, date:string, name='Quick workout', now=Date.now()):Promise<number> {
  validateLocalDate(date)
  return mutate(db,now,async(tx,c)=>{
    const active=await activeWorkout(tx); if(active)return active.id
    return writeRow(tx,'workouts',{name:name.trim()||'Quick workout',local_date:date,started_at:now,status:'active'},now,c)
  })
}
async function requireActive(tx:DbAdapter,id:number):Promise<void> {
  if(!await tx.get("SELECT id FROM workouts WHERE id=? AND status='active' AND deleted_at IS NULL",[id])) throw new Error('Reopen this workout before editing it')
}
export async function workoutDetail(db:DbAdapter,id:number):Promise<{workout:Workout;exercises:WorkoutExercise[]}> {
  const workout=await db.get<Workout>('SELECT * FROM workouts WHERE id=? AND deleted_at IS NULL',[id]); if(!workout)throw new Error('Workout not found')
  const rows=await db.all<Omit<WorkoutExercise,'sets'|'previous'>>('SELECT we.*,e.name FROM workout_exercises we JOIN exercises e ON e.id=we.exercise_id WHERE we.workout_id=? AND we.deleted_at IS NULL ORDER BY we.sort_order,we.id',[id])
  const exercises:WorkoutExercise[]=[]
  for(const e of rows) exercises.push({...e,sets:await db.all<WorkoutSet>('SELECT * FROM workout_sets WHERE workout_exercise_id=? AND deleted_at IS NULL ORDER BY sort_order,id',[e.id]),previous:await db.get<WorkoutSet>(`SELECT s.* FROM workout_sets s JOIN workout_exercises we ON we.id=s.workout_exercise_id JOIN workouts w ON w.id=we.workout_id WHERE we.exercise_id=? AND w.id!=? AND w.status='completed' AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL AND we.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY w.finished_at DESC,s.sort_order DESC LIMIT 1`,[e.exercise_id,id])})
  return {workout,exercises}
}
async function addExerciseTx(tx:DbAdapter,c:BatchChange[],workoutId:number,exerciseId:number,now:number,group:string|null=null):Promise<number> {
  const e=await tx.get<{tracking_type:TrackingType}>('SELECT tracking_type FROM exercises WHERE id=? AND deleted_at IS NULL',[exerciseId]);if(!e)throw new Error('Exercise not found')
  const order=await tx.get<{n:number}>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM workout_exercises WHERE workout_id=?',[workoutId])
  return writeRow(tx,'workout_exercises',{workout_id:workoutId,exercise_id:exerciseId,sort_order:order!.n,tracking_type:e.tracking_type,superset_group_id:group},now,c)
}
export async function addExercise(db:DbAdapter,workoutId:number,exerciseId:number,now=Date.now()):Promise<number> {
  return mutate(db,now,async(tx,c)=>{await requireActive(tx,workoutId);return addExerciseTx(tx,c,workoutId,exerciseId,now)})
}
export async function saveSet(db:DbAdapter,exerciseId:number,input:unknown,options:{id?:number;completed?:boolean;kind?:string;planned?:SetValues;restSeconds?:number}={},now=Date.now()):Promise<number> {
  return mutate(db,now,async(tx,c)=>{
    const e=await tx.get<WorkoutExercise>('SELECT * FROM workout_exercises WHERE id=? AND deleted_at IS NULL',[exerciseId]);if(!e)throw new Error('Exercise not found');await requireActive(tx,e.workout_id)
    const previous=options.id===undefined?null:await tx.get<WorkoutSet>('SELECT * FROM workout_sets WHERE id=? AND workout_exercise_id=? AND deleted_at IS NULL',[options.id,exerciseId])
    if(options.id!==undefined&&!previous)throw new Error('Set not found')
    const completed=options.completed ?? (previous?.completed_at!==null && previous!==null)
    const values=validateSet(e.tracking_type,input,completed)
    const order=previous?.sort_order ?? (await tx.get<{n:number}>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM workout_sets WHERE workout_exercise_id=?',[exerciseId]))!.n
    const id=await writeRow(tx,'workout_sets',{...values,workout_exercise_id:exerciseId,sort_order:order,kind:SetKind.parse(options.kind??previous?.kind??'normal'),completed_at:completed?(previous?.completed_at??now):null,planned_json:options.planned?JSON.stringify(validateSet(e.tracking_type,options.planned)):previous?.planned_json??null},now,c,options.id)
    if(completed && !previous?.completed_at) {
      const later=e.superset_group_id ? await tx.get('SELECT id FROM workout_exercises WHERE workout_id=? AND superset_group_id=? AND sort_order>? AND deleted_at IS NULL',[e.workout_id,e.superset_group_id,e.sort_order]):null
      const rest=options.restSeconds??90;if(!Number.isFinite(rest)||rest<0||rest>3600)throw new Error('Invalid rest duration')
      if(!later)await writeRow(tx,'workouts',{rest_until:now+rest*1000},now,c,e.workout_id)
    }
    return id
  })
}
export async function updateWorkout(db:DbAdapter,id:number,values:{notes?:string;location?:string;rest_until?:number|null;name?:string},now=Date.now()):Promise<void> {
  if(Object.values(values).some(v=>typeof v==='string'&&v.length>4000)|| (values.rest_until!==undefined&&values.rest_until!==null&&(!Number.isFinite(values.rest_until)||values.rest_until<0)))throw new Error('Invalid workout details')
  await mutate(db,now,async(tx,c)=>{await requireActive(tx,id);await writeRow(tx,'workouts',values as Row,now,c,id)})
}
export async function finishWorkout(db:DbAdapter,id:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{await requireActive(tx,id)
    if(!await tx.get('SELECT s.id FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id WHERE e.workout_id=? AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL',[id]))throw new Error('Complete at least one set before finishing')
    await writeRow(tx,'workouts',{status:'completed',finished_at:now,rest_until:null},now,c,id)
  })
}
export async function reopenWorkout(db:DbAdapter,id:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{if(await activeWorkout(tx))throw new Error('Finish or discard the active workout first');await writeRow(tx,'workouts',{status:'active',finished_at:null},now,c,id)})
}
export async function discardWorkout(db:DbAdapter,id:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{await requireActive(tx,id);await writeRow(tx,'workouts',{status:'discarded',finished_at:null,rest_until:null,deleted_at:now},now,c,id)})
}
export async function editWorkoutExercise(db:DbAdapter,id:number,values:{notes?:string;sort_order?:number;superset_group_id?:string|null;deleted_at?:number|null},now=Date.now()):Promise<void> {
  if(values.notes&&values.notes.length>4000)throw new Error('Note is too long')
  if(values.sort_order!==undefined&&(!Number.isInteger(values.sort_order)||values.sort_order<0))throw new Error('Invalid exercise order')
  await mutate(db,now,async(tx,c)=>{const e=await tx.get<WorkoutExercise>('SELECT * FROM workout_exercises WHERE id=?',[id]);if(!e)throw new Error('Exercise not found');await requireActive(tx,e.workout_id);await writeRow(tx,'workout_exercises',values as Row,now,c,id)})
}
export async function replaceExercise(db:DbAdapter,id:number,replacement:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{const old=await tx.get<WorkoutExercise>('SELECT * FROM workout_exercises WHERE id=? AND deleted_at IS NULL',[id]);if(!old)throw new Error('Exercise not found');await requireActive(tx,old.workout_id)
    await writeRow(tx,'workout_exercises',{deleted_at:now},now,c,id)
    const next=await addExerciseTx(tx,c,old.workout_id,replacement,now,old.superset_group_id)
    await writeRow(tx,'workout_exercises',{sort_order:old.sort_order},now,c,next)
  })
}
export async function removeSet(db:DbAdapter,id:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{const row=await tx.get<{workout_id:number}>('SELECT e.workout_id FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id WHERE s.id=?',[id]);if(!row)throw new Error('Set not found');await requireActive(tx,row.workout_id);await writeRow(tx,'workout_sets',{deleted_at:now},now,c,id)})
}
export async function groupExercises(db:DbAdapter,workoutId:number,ids:number[],now=Date.now()):Promise<void> {
  if(new Set(ids).size!==ids.length||ids.length<2)throw new Error('Choose at least two different exercises')
  await mutate(db,now,async(tx,c)=>{await requireActive(tx,workoutId);const group=generateUuidV7(now)
    for(const id of ids){if(!await tx.get('SELECT id FROM workout_exercises WHERE id=? AND workout_id=? AND deleted_at IS NULL',[id,workoutId]))throw new Error('Exercise does not belong to workout');await writeRow(tx,'workout_exercises',{superset_group_id:group},now,c,id)}
  })
}
export const listEquipment=(db:DbAdapter):Promise<Equipment[]>=>db.all('SELECT * FROM equipment_inventory WHERE deleted_at IS NULL ORDER BY id')
export async function saveEquipment(db:DbAdapter,input:unknown,id?:number,now=Date.now()):Promise<number> {
  const value=EquipmentInput.parse(input);return mutate(db,now,(tx,c)=>writeRow(tx,'equipment_inventory',value,now,c,id))
}
export const listRoutines=(db:DbAdapter):Promise<Routine[]>=>db.all('SELECT * FROM routines WHERE deleted_at IS NULL ORDER BY name')
export const listPrograms=(db:DbAdapter):Promise<Program[]>=>db.all('SELECT * FROM programs WHERE deleted_at IS NULL ORDER BY name')
export async function saveRoutine(db:DbAdapter,input:unknown,id?:number,now=Date.now()):Promise<number> {
  const value=RoutineInput.parse(input)
  return mutate(db,now,async(tx,c)=>{
    for(const e of value.exercises){const row=await tx.get<{tracking_type:TrackingType}>('SELECT tracking_type FROM exercises WHERE id=? AND deleted_at IS NULL',[e.exercise_id]);if(!row)throw new Error('Exercise not found');for(const s of e.sets)validateSet(row.tracking_type,s,true)}
    return writeRow(tx,'routines',{name:value.name,definition_json:JSON.stringify(value)},now,c,id)
  })
}
export async function saveProgram(db:DbAdapter,input:unknown,id?:number,now=Date.now()):Promise<number> {
  const value=ProgramInput.parse(input);validateLocalDate(value.start_date)
  return mutate(db,now,async(tx,c)=>{for(const s of value.schedule)if(!await tx.get('SELECT id FROM routines WHERE id=? AND deleted_at IS NULL',[s.routine_id]))throw new Error('Routine not found');return writeRow(tx,'programs',{name:value.name,definition_json:JSON.stringify(value)},now,c,id)})
}
export function scheduledRoutine(program:ProgramInput,date:string):number|null {
  validateLocalDate(date);validateLocalDate(program.start_date)
  const days=Math.floor((Date.parse(date)-Date.parse(program.start_date))/86400000)
  return days<0||days>=program.weeks*7?null:program.schedule.find(s=>s.day===days%7)?.routine_id??null
}
export async function launchRoutine(db:DbAdapter,id:number,date:string,now=Date.now()):Promise<number> {
  validateLocalDate(date)
  return mutate(db,now,async(tx,c)=>{
    if(await activeWorkout(tx))throw new Error('Finish or discard the active workout first')
    const row=await tx.get<Routine>('SELECT * FROM routines WHERE id=? AND deleted_at IS NULL',[id]);if(!row)throw new Error('Routine not found')
    const routine=RoutineInput.parse(JSON.parse(row.definition_json))
    const workout=await writeRow(tx,'workouts',{name:row.name,local_date:date,started_at:now,routine_id:id},now,c)
    const equipment=await listEquipment(tx)
    for(const planned of routine.exercises){
      const e=await addExerciseTx(tx,c,workout,planned.exercise_id,now,planned.group)
      const history=await tx.all<WorkoutSet>(`SELECT s.* FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN workouts w ON w.id=e.workout_id WHERE e.exercise_id=? AND w.routine_id=? AND w.status='completed' AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL ORDER BY w.finished_at DESC,s.sort_order`,[planned.exercise_id,id])
      const ex=await tx.get<{equipment_json:string;tracking_type:TrackingType}>('SELECT equipment_json,tracking_type FROM exercises WHERE id=?',[planned.exercise_id])
      const requirements=JSON.parse(ex!.equipment_json) as string[]
      const bar=equipment.find(p=>requirements.includes(p.kind)&&['barbell','dumbbell','ez_bar','trap_bar'].includes(p.kind))
      for(const [order,target] of planned.sets.entries()){
        const previous=history.find(h=>h.sort_order===order)
        const values=previous?nextProgression({previous:SetValues.parse(previous),rule:planned.rule,...(bar?{inventory:{bar,plates:equipment.filter(p=>p.kind==='plate'),handles:bar.kind==='dumbbell'?2:1}}:{})}).values:target
        validateSet(ex!.tracking_type,values,true)
        await writeRow(tx,'workout_sets',{...values,workout_exercise_id:e,sort_order:order,planned_json:JSON.stringify(values)},now,c)
      }
    }
    return workout
  })
}
export async function performanceHistory(db:DbAdapter):Promise<Performance[]> {
  return db.all(`SELECT s.*,e.exercise_id,e.tracking_type,e.workout_id,w.finished_at AS at,w.local_date FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN workouts w ON w.id=e.workout_id WHERE w.status='completed' AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL ORDER BY w.finished_at,s.id`)
}
