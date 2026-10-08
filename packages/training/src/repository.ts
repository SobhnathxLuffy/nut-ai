import { ExerciseInput, EquipmentInput, RoutineInput, ProgramInput, ProgressionRule, SetKind, SetValues, validateSet, type TrackingType } from '@nutai/core-schema'
import { createSyncMetadata, deterministicUuidV7, generateUuidV7, recordOperation, validateLocalDate, type BatchChange, type DbAdapter, type SqlValue } from '@nutai/db-adapter'
import { EXERCISE_LIBRARY } from './library.js'
import { nextProgression, type Performance } from './progression.js'

export interface Exercise extends ExerciseInput { id:number; uuid:string; is_custom:number; source:string }
export interface Workout { id:number; uuid:string; name:string; local_date:string; started_at:number; finished_at:number|null; status:'active'|'completed'|'discarded'; notes:string; location:string; routine_id:number|null; rest_until:number|null; progression_note:string|null }
export interface WorkoutExercise { id:number; exercise_id:number; workout_id:number; name:string; tracking_type:TrackingType; sort_order:number; superset_group_id:string|null; notes:string; sets:WorkoutSet[]; previous:WorkoutSet|null }
export interface WorkoutSet extends SetValues { id:number; workout_exercise_id:number; sort_order:number; kind:string; planned_json:string|null; completed_at:number|null }
export interface Equipment extends EquipmentInput {id:number}
export interface Routine {id:number; name:string; definition_json:string}
export type Program = Routine
type Row = Record<string, SqlValue>
const WRITE_TABLES = new Set(['exercises','equipment_inventory','routines','programs','workouts','workout_exercises','workout_sets','logging_shortcuts'])
/** Tables whose writes change what a workout read-model (active workout card,
 * history) shows. Writes to exercises/equipment/routines/programs do NOT fire
 * the workout-change event — the registry is scoped, not a global bus. */
const WORKOUT_WRITE_TABLES = new Set(['workouts','workout_exercises','workout_sets'])
const workoutChangeListeners = new WeakMap<DbAdapter, Set<() => void>>()
/**
 * O8 (Wave 5B, UI/UX report Table 12.1 "1s polling in ActiveWorkout — battery
 * cost for a static pill; event-driven"): subscribe to workout/workout-set
 * writes made through THIS repo instance (the DbAdapter you pass in). Every
 * write that goes through `mutate()` below notifies its listeners AFTER the
 * transaction committed, so a listener may immediately re-read fresh state.
 * Returns an unsubscribe function. No external event library — a WeakMap of
 * per-adapter listener sets, mirroring the app-side food-mutations bus.
 *
 * Not covered (honest limits): raw SQL writes that bypass this repository
 * (backup import, undo/redo of operations) emit nothing — callers that need
 * those cases keep their own foreground/path-change re-read. Listener errors
 * propagate after the write has already committed, same contract as
 * emitFoodMutation.
 */
export function onWorkoutsChanged(db: DbAdapter, listener: () => void): () => void {
  let listeners = workoutChangeListeners.get(db)
  if (!listeners) { listeners = new Set(); workoutChangeListeners.set(db, listeners) }
  listeners.add(listener)
  return () => { listeners!.delete(listener) }
}
function notifyWorkoutChange(db: DbAdapter, changes: readonly BatchChange[]): void {
  const listeners = workoutChangeListeners.get(db)
  if (!listeners?.size || !changes.some(c => WORKOUT_WRITE_TABLES.has(c.entityType))) return
  for (const listener of [...listeners]) listener()
}
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
  const changes:BatchChange[]=[]
  const result=await db.transaction(async tx=>{
    const result=await fn(tx,changes)
    if(changes.length) await recordOperation(tx,{entityType:'batch',entityId:0,opType:'update',newJson:{changes},createdAt:now})
    return result
  })
  // O8: notify AFTER the transaction committed (a rollback must stay silent).
  notifyWorkoutChange(db,changes)
  return result
}
function exerciseRow(e:ExerciseInput):Row {
  return {name:e.name,tracking_type:e.tracking_type,aliases_json:JSON.stringify(e.aliases),primary_muscles_json:JSON.stringify(e.primary_muscles),secondary_muscles_json:JSON.stringify(e.secondary_muscles),antagonist_muscles_json:JSON.stringify(e.antagonist_muscles),equipment_json:JSON.stringify(e.equipment),notes:e.notes,media_uri:e.media_uri}
}
export async function seedExercises(db:DbAdapter):Promise<void> {
  // P2-36 (QA Wave 4): short-circuit the per-launch reseed. The old loop ran
  // one SELECT per library exercise inside a transaction on EVERY boot — the
  // dominant first-paint cost on web-wasm. One COUNT answers "already seeded"
  // (user-created rows only ever push the count ABOVE the library size, and
  // uuid-deterministic ids mean re-inserts are no-ops anyway).
  if (EXERCISE_LIBRARY.length > 0) {
    const count = await db.get<{ c:number }>('SELECT COUNT(*) as c FROM exercises')
    if ((count?.c ?? 0) >= EXERCISE_LIBRARY.length) return
  }
  await db.transaction(async tx=>{
    // BUG-seed (Wave 5B, browser-reproduced in Task 5-1): a restored backup can
    // park rows on the library's hardcoded ids with NON-library uuids — the
    // COUNT check passes (count < library size) and the uuid de-dupe below
    // does not recognise them, so the old INSERT with hardcoded id=i+1 died
    // with SQLITE_CONSTRAINT_PRIMARYKEY (1555) on exercises.id and the workout
    // screen rendered the raw error. Seed only the MISSING library rows: each
    // insert takes its hardcoded id only when that id is FREE, otherwise the id
    // is omitted and SQLite assigns the next free rowid. User-restored rows are
    // never touched, and every library exercise still exists after boot.
    const existing=await tx.all<{id:number;uuid:string}>('SELECT id,uuid FROM exercises')
    const uuids=new Set(existing.map(r=>r.uuid))
    const takenIds=new Set(existing.map(r=>r.id))
    for(const [i,e] of EXERCISE_LIBRARY.entries()) {
      const uuid=deterministicUuidV7(0,`nutai.exercise.v1:${e.name}`)
      if(uuids.has(uuid)) continue
      const row:Row={...exerciseRow(e),...createSyncMetadata(0),uuid,is_custom:0,source:'Nut AI original taxonomy v1',id:i+1}
      if(takenIds.has(i+1)) delete row['id']
      const keys=Object.keys(row) as (keyof typeof row)[]
      const inserted=await tx.run(`INSERT INTO exercises (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]!))
      // Track the id this insert actually landed on: an auto-assigned rowid can
      // occupy a LATER library row's hardcoded id within this same loop.
      takenIds.add(Number(inserted.lastInsertRowId))
    }
  })
}
export async function listExercises(db:DbAdapter):Promise<Exercise[]> {
  const rows=await db.all<Row>('SELECT * FROM exercises WHERE deleted_at IS NULL ORDER BY name,id')
  return rows.map(rowToExercise)
}
/**
 * P2-42: library rows come back through the TYPED library, not an `as any`
 * cast. Library exercises are seeded with a deterministic uuid, so the uuid is
 * a lossless key back to the ExerciseInput the row was written from — zero
 * parsing, zero drift surface. Only user-created rows (and any row whose uuid
 * no longer matches the library, e.g. after a seed rename) go through the
 * zod parse, where a schema change fails loudly at the boundary instead of
 * flowing untyped into workouts.
 */
let libraryByUuidIndex: Map<string, ExerciseInput> | null = null
function libraryByUuid(uuid: string): ExerciseInput | null {
  if (!libraryByUuidIndex) {
    libraryByUuidIndex = new Map(
      EXERCISE_LIBRARY.map((e) => [deterministicUuidV7(0, `nutai.exercise.v1:${e.name}`), e]),
    )
  }
  return libraryByUuidIndex.get(uuid) ?? null
}
function rowToExercise(r:Row):Exercise {
  const id=Number(r['id'])
  const uuid=String(r['uuid'])
  const isCustom=Number(r['is_custom'])
  const source=String(r['source'])
  if (!isCustom) {
    const lib=libraryByUuid(uuid)
    if (lib) return {...lib,id,uuid,is_custom:0,source}
  }
  const base={name:r['name'],tracking_type:r['tracking_type'],aliases:JSON.parse(String(r['aliases_json'])),primary_muscles:JSON.parse(String(r['primary_muscles_json'])),secondary_muscles:JSON.parse(String(r['secondary_muscles_json'])),antagonist_muscles:JSON.parse(String(r['antagonist_muscles_json'])),equipment:JSON.parse(String(r['equipment_json'])),notes:r['notes'],media_uri:r['media_uri']}
  return {...ExerciseInput.parse(base),id,uuid,is_custom:isCustom,source}
}
export async function getExercise(db:DbAdapter,id:number):Promise<Exercise|null> {
  const r=await db.get<Row>('SELECT * FROM exercises WHERE id=? AND deleted_at IS NULL',[id])
  if(!r) return null
  return rowToExercise(r)
}
export async function isExerciseInWorkout(db:DbAdapter,workoutId:number,exerciseId:number):Promise<boolean> {
  const row=await db.get<{id:number}>('SELECT id FROM workout_exercises WHERE workout_id=? AND exercise_id=? AND deleted_at IS NULL LIMIT 1',[workoutId,exerciseId])
  return !!row
}
export async function createExercise(db:DbAdapter,input:unknown,now=Date.now()):Promise<number> {
  const e=ExerciseInput.parse(input)
  return mutate(db,now,(tx,c)=>writeRow(tx,'exercises',{...exerciseRow(e),is_custom:1,source:'user'},now,c))
}
/** The type-based planned-set fallback — the ONE place the 20 kg × 10-style
 * table lives (T-IMPL-B B2: the routines editor, the repository and the
 * log-exercise configure screen all share it; no third copy may appear). */
export function typeDefaultSets(trackingType:TrackingType):SetValues[] {
  const base: SetValues = {
    load_kg: trackingType === 'weight_reps' ? 20 : null,
    reps: ['weight_reps', 'bodyweight_reps', 'reps', 'assisted'].includes(trackingType) ? 10 : null,
    duration_s: ['distance_time', 'time', 'weight_time'].includes(trackingType) ? 60 : null,
    distance_m: ['distance_time', 'distance'].includes(trackingType) ? 1000 : null,
    assistance_kg: trackingType === 'assisted' ? 20 : null,
    rir: null,
    rpe: null,
    tempo: null,
  }
  return [base, { ...base }, { ...base }]
}

/** History-aware planned-set defaults (T-IMPL-B B2): seed a new routine block
 * (or the log-exercise configure card) from the user's LAST completed session
 * of the exercise — what they actually did, not a hard-coded default. History
 * is performanceHistory() order (finished_at ASC), so the last rows are the
 * newest session; its sets arrive in sort order. Falls back to
 * typeDefaultSets when the exercise has never been logged. */
export function defaultSetsFor(exercise:{ id:number; tracking_type:TrackingType },history:readonly (Performance & { sort_order?: number })[]):SetValues[] {
  const rows=history.filter(h=>h.exercise_id===exercise.id)
  const lastWorkoutId=rows.at(-1)?.workout_id
  if(lastWorkoutId!==undefined){
    const lastSets=rows.filter(h=>h.workout_id===lastWorkoutId)
      .sort((a,b)=>(a.sort_order??0)-(b.sort_order??0))
      .slice(0,100)
      .map(h=>({ load_kg:h.load_kg,reps:h.reps,duration_s:h.duration_s,distance_m:h.distance_m,assistance_kg:h.assistance_kg,rir:h.rir,rpe:h.rpe,tempo:h.tempo }))
    if(lastSets.length) return lastSets
  }
  return typeDefaultSets(exercise.tracking_type)
}

export async function addExerciseToRoutine(db:DbAdapter,routineId:number,exerciseId:number,now=Date.now()):Promise<void> {
  const ex=await getExercise(db,exerciseId)
  if(!ex) throw new Error('Exercise not found')
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
    const history=await performanceHistory(tx)
    routine.exercises.push({
      exercise_id: exerciseId,
      group: null,
      sets: defaultSetsFor(ex,history),
      rule: defaultRule,
      rest_seconds: null,
    })
    RoutineInput.parse(routine)
    await writeRow(tx,'routines',{definition_json:JSON.stringify(routine)},now,c,routineId)
  })
}
export const activeWorkout=(db:DbAdapter):Promise<Workout|null>=>db.get("SELECT * FROM workouts WHERE status='active' AND deleted_at IS NULL")
// P2-23 (QA Wave 4): this used to be unbounded — the Train tab mounted
// hundreds of cards after months of use and re-rendered the whole list on any
// action. 120 completed workouts is far beyond what a journal tab should
// render at once; the list is windowed in the screen as well.
export const workoutHistory=(db:DbAdapter):Promise<Workout[]>=>db.all("SELECT * FROM workouts WHERE status='completed' AND deleted_at IS NULL ORDER BY started_at DESC,id DESC LIMIT 120")
export async function startWorkout(db:DbAdapter, date:string, name='Empty workout', now=Date.now()):Promise<number> {
  validateLocalDate(date)
  return mutate(db,now,async(tx,c)=>{
    const active=await activeWorkout(tx); if(active)return active.id
    return writeRow(tx,'workouts',{name:name.trim()||'Empty workout',local_date:date,started_at:now,status:'active'},now,c)
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
/** Routine delete (T-IMPL-B D): soft-deletes the routine AND strips it from
 * every live program's schedule in the same transaction — the delete dialog
 * promises "removed from programs that schedule it", and a stripped reference
 * can no longer throw 'Routine not found' at launch. A program left with NO
 * scheduled routine is deleted too: an empty schedule is not a program
 * (ProgramInput requires at least one day), so keeping it would render the
 * corrupt-row card. Rides mutate() like every training write, so the whole
 * cascade is one undoable operation. */
export async function deleteRoutine(db:DbAdapter,id:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{
    if(!await tx.get('SELECT id FROM routines WHERE id=? AND deleted_at IS NULL',[id])) throw new Error('Routine not found')
    await writeRow(tx,'routines',{deleted_at:now},now,c,id)
    const programs=await tx.all<Row>('SELECT * FROM programs WHERE deleted_at IS NULL')
    for(const row of programs){
      let plan:ProgramInput
      try{ plan=ProgramInput.parse(JSON.parse(String(row['definition_json']))) }catch{ continue }
      if(!plan.schedule.some(s=>s.routine_id===id)) continue
      const remaining=plan.schedule.filter(s=>s.routine_id!==id)
      if(remaining.length===0) await writeRow(tx,'programs',{deleted_at:now},now,c,Number(row['id']))
      else { plan.schedule=remaining; await writeRow(tx,'programs',{definition_json:JSON.stringify(plan)},now,c,Number(row['id'])) }
    }
  })
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
/** Calendar weekday of a YYYY-MM-DD date: 0 = Sunday … 6 = Saturday.
 * Built from date parts — never `new Date(bareString)`, whose UTC reading of
 * an unstated timezone can shift the calendar day behind a UTC− offset. */
export function weekdayOfLocalDate(date:string):number {
  validateLocalDate(date)
  const [y,m,d]=date.split('-').map(Number)
  return new Date(y!,m!-1,d!).getDay()
}
/**
 * Programs speak TWO day languages and the UI must never mix them up (owner
 * QA 2026-10: "I scheduled Wed and nothing ever ran" — the editor stored
 * calendar weekday indexes while this engine reads cycle days, so the two
 * only agreed when a program started on a Sunday).
 *
 * Stored semantics: `schedule[].day` is a CYCLE day — 0 is the start date
 * itself, whatever weekday it falls on; `days_from_start % 7` selects the
 * session. User semantics: "Wednesday = leg day", a real calendar weekday.
 * Because `days_from_start % 7` is exactly the weekday difference between
 * the date and the start date, the two models interconvert losslessly:
 */
export function weekdayToCycleDay(weekday:number,startDate:string):number {
  return (weekday-weekdayOfLocalDate(startDate)+7)%7
}
export function cycleDayToWeekday(day:number,startDate:string):number {
  return (day+weekdayOfLocalDate(startDate))%7
}
export type ProgramDayStatus =
  | { kind:'scheduled';routineId:number }
  | { kind:'rest' }
  | { kind:'before';daysUntil:number }
  | { kind:'finished' }
/** Today's relationship to a program, for UI cards: a scheduled routine, a
 * rest day inside the block, a block that has not started yet, or one that
 * already ran out of weeks. Cards can stop calling a finished block a
 * "rest day". */
export function programDayStatus(program:ProgramInput,date:string):ProgramDayStatus {
  validateLocalDate(date);validateLocalDate(program.start_date)
  const days=Math.floor((Date.parse(date)-Date.parse(program.start_date))/86400000)
  if(days<0)return { kind:'before',daysUntil:-days }
  if(days>=program.weeks*7)return { kind:'finished' }
  const id=scheduledRoutine(program,date)
  return id===null?{ kind:'rest'}:{ kind:'scheduled',routineId:id }
}
/** Local-calendar date offset built from date parts — the same guard as
 * weekdayOfLocalDate (never `new Date(bareString)`). */
export function offsetLocalDate(date:string,days:number):string {
  validateLocalDate(date)
  const [y,m,d]=date.split('-').map(Number)
  const next=new Date(y!,m!-1,d!+days)
  return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`
}

/** "Week N of M" (T-IMPL-B F2): 1-based block week containing `date`, from the
 * SAME day math as scheduledRoutine (days from start ÷ 7). Null before the
 * start date and after the block runs out — callers show "starts in N days" /
 * "finished" there. */
export function programWeekOf(program:ProgramInput,date:string):number|null {
  validateLocalDate(date);validateLocalDate(program.start_date)
  const days=Math.floor((Date.parse(date)-Date.parse(program.start_date))/86400000)
  if(days<0||days>=program.weeks*7)return null
  return Math.floor(days/7)+1
}

export interface ProgramWeekAdherence { week:number|null; scheduledDates:string[]; completedDates:string[] }
/** Planned-vs-done for the block's CURRENT week (T-IMPL-B F3): the scheduled
 * session dates this week (any routine) and which of them already have a
 * completed workout. A completed workout on a scheduled date counts as done
 * even if the user swapped the routine — the honest, kind definition. */
export async function programWeekAdherence(db:DbAdapter,program:ProgramInput,date:string):Promise<ProgramWeekAdherence> {
  const week=programWeekOf(program,date)
  const scheduledDates:string[]=[]
  if(week!==null){
    for(let i=0;i<7;i++){
      const d=offsetLocalDate(program.start_date,(week-1)*7+i)
      if(scheduledRoutine(program,d)!==null) scheduledDates.push(d)
    }
  }
  const completedDates:string[]=[]
  for(const d of scheduledDates){
    const row=await db.get<{ id:number }>("SELECT id FROM workouts WHERE status='completed' AND deleted_at IS NULL AND local_date=? LIMIT 1",[d])
    if(row) completedDates.push(d)
  }
  return { week,scheduledDates,completedDates }
}

/** One training streak, kept simple and labeled (T-IMPL-B F3): consecutive
 * MONDAY-ALIGNED calendar weeks with at least one completed session, counting
 * the current week only once it already has one. */
export function computeTrainingStreak(dates:readonly string[],today:string):number {
  validateLocalDate(today)
  const weekIndex=(iso:string)=>{ const dayNumber=Math.floor(Date.parse(`${iso}T12:00:00Z`)/86400000); return Math.floor((dayNumber+3)/7) }
  const weeks=new Set(dates.map(weekIndex))
  const current=weekIndex(today)
  if(!weeks.has(current)) return 0
  let streak=0
  for(let w=current;weeks.has(w);w--) streak++
  return streak
}
export async function trainingStreak(db:DbAdapter,today:string):Promise<number> {
  const rows=await db.all<{ local_date:string }>("SELECT DISTINCT local_date FROM workouts WHERE status='completed' AND deleted_at IS NULL")
  return computeTrainingStreak(rows.map(r=>r.local_date),today)
}

export async function launchRoutine(db:DbAdapter,id:number,date:string,now=Date.now()):Promise<number> {
  validateLocalDate(date)
  return mutate(db,now,async(tx,c)=>{
    if(await activeWorkout(tx))throw new Error('Finish or discard the active workout first')
    const row=await tx.get<Routine>('SELECT * FROM routines WHERE id=? AND deleted_at IS NULL',[id]);if(!row)throw new Error('Routine not found')
    const routine=RoutineInput.parse(JSON.parse(row.definition_json))
    const workout=await writeRow(tx,'workouts',{name:row.name,local_date:date,started_at:now,routine_id:id},now,c)
    const equipment=await listEquipment(tx)
    const notes:string[]=[]
    for(const planned of routine.exercises){
      const e=await addExerciseTx(tx,c,workout,planned.exercise_id,now,planned.group)
      // T-IMPL-B A2: history spans ALL completed workouts (any routine), so
      // sessions logged outside this routine — e.g. live "empty workout"
      // sessions — still drive progression. Ordering keeps the newest session
      // first; the per-slot find() therefore reads the last time the user did
      // this exercise, wherever it was logged.
      const history=await tx.all<WorkoutSet>(`SELECT s.* FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN workouts w ON w.id=e.workout_id WHERE e.exercise_id=? AND w.status='completed' AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL ORDER BY w.finished_at DESC,s.sort_order`,[planned.exercise_id])
      const ex=await tx.get<{name:string;equipment_json:string;tracking_type:TrackingType}>('SELECT name,equipment_json,tracking_type FROM exercises WHERE id=?',[planned.exercise_id])
      const requirements=JSON.parse(ex!.equipment_json) as string[]
      const bar=equipment.find(p=>requirements.includes(p.kind)&&['barbell','dumbbell','ez_bar','trap_bar'].includes(p.kind))
      // T-IMPL-B H: planned_json keeps the ROUTINE's plan (what the user
      // authored); the progressed values live on the row itself, and the WHY
      // rides the workout's progression_note (A3) instead of mutating the plan.
      let noteForExercise: string | null = null
      let ceilingProgression: { values: SetValues } | null = null
      for(const [order,target] of planned.sets.entries()){
        const previous=history.find(h=>h.sort_order===order)
        const progression=previous?nextProgression({previous:SetValues.parse(previous),rule:planned.rule,tracking_type:ex!.tracking_type,...(bar?{inventory:{bar,plates:equipment.filter(p=>p.kind==='plate'),handles:bar.kind==='dumbbell'?2:1}}:{})}):null
        const values=progression?progression.values:target
        validateSet(ex!.tracking_type,values,true)
        await writeRow(tx,'workout_sets',{...values,workout_exercise_id:e,sort_order:order,planned_json:JSON.stringify(target)},now,c)
        if(progression&&noteForExercise===null) noteForExercise=progression.explanation
        // A1's "+1 set": the rep ladder topped out on this slot. Flag consumed
        // from the LAST slot only, so the extra set is granted once per
        // exercise per launch, never once per slot.
        if(progression?.addSet&&order===planned.sets.length-1) ceilingProgression=progression
      }
      if(ceilingProgression){
        const order=planned.sets.length
        // The appended set has no authored plan slot — its prescription IS the
        // plan for this session (the ladder-restart values), so planned_json
        // mirrors what the user should do, and the note says why.
        await writeRow(tx,'workout_sets',{...ceilingProgression.values,workout_exercise_id:e,sort_order:order,kind:'normal',completed_at:null,planned_json:JSON.stringify(ceilingProgression.values)},now,c)
        notes.push(`${ex!.name}: one more set added — you hit the rep ceiling last time.`)
      }
      if(noteForExercise!==null) notes.push(`${ex!.name}: ${noteForExercise}`)
    }
    // A3: the visible suggestion. Joined one line per progressing exercise;
    // the workout screen renders it as the "This week" banner and workout
    // detail keeps it for the record.
    if(notes.length) await writeRow(tx,'workouts',{progression_note:notes.join('\n')},now,c,workout)
    return workout
  })
}
/** Warm-up ramp (report 9.2 #12, T-IMPL-B I): inserts 40%×5, 70%×3, 90%×1 of
 * the first load-bearing set's load as warmup-kind rows JUST BEFORE it. Every
 * later set row shifts by three sort orders inside the same transaction, so
 * the ramp renders in place and the working sets keep their order. Warmups are
 * already excluded from analytics (packages/analytics isWorkingSet) and PRs
 * (deriveRecords). */
export async function insertWarmupRamp(db:DbAdapter,workoutExerciseId:number,now=Date.now()):Promise<void> {
  await mutate(db,now,async(tx,c)=>{
    const exercise=await tx.get<WorkoutExercise>('SELECT * FROM workout_exercises WHERE id=? AND deleted_at IS NULL',[workoutExerciseId]);if(!exercise)throw new Error('Exercise not found');await requireActive(tx,exercise.workout_id)
    const sets=await tx.all<WorkoutSet>('SELECT * FROM workout_sets WHERE workout_exercise_id=? AND deleted_at IS NULL ORDER BY sort_order,id',[workoutExerciseId])
    if(sets.some(s=>s.kind==='warmup'))throw new Error('This exercise already has a warm-up ramp')
    const firstWorking=sets.find(s=>s.load_kg!==null)
    if(!firstWorking?.load_kg)throw new Error('Add a load to the first working set first')
    for(const s of [...sets].reverse())await writeRow(tx,'workout_sets',{sort_order:s.sort_order+3},now,c,s.id)
    const ramp:[number,number][]=[[0.4,5],[0.7,3],[0.9,1]]
    let order=firstWorking.sort_order
    for(const [pct,reps] of ramp){
      await writeRow(tx,'workout_sets',{load_kg:Math.round(firstWorking.load_kg*pct*100)/100,reps,duration_s:null,distance_m:null,assistance_kg:null,rir:null,rpe:null,tempo:null,workout_exercise_id:workoutExerciseId,sort_order:order++,kind:'warmup',completed_at:null,planned_json:null},now,c)
    }
  })
}
export async function performanceHistory(db:DbAdapter):Promise<Performance[]> {
  return db.all(`SELECT s.*,e.exercise_id,e.tracking_type,e.workout_id,w.finished_at AS at,w.local_date FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN workouts w ON w.id=e.workout_id WHERE w.status='completed' AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL ORDER BY w.finished_at,s.id`)
}

/** Session PR detection (T-IMPL-B F4): for each load-bearing exercise in this
 * workout, the best Epley estimated 1RM across its completed WORKING sets
 * (weight_reps, 1–12 reps — the SAME window deriveRecords uses, so the
 * finish-summary banner and the Progress charts can never disagree), compared
 * against every previous completed session. No previous session counts as a
 * PR — a first performance is a record. */
export async function detectSessionPRs(db:DbAdapter,workoutId:number):Promise<Array<{name:string;e1rm_kg:number}>> {
  const rows=await db.all<{exercise_id:number;name:string;load_kg:number;reps:number}>(`SELECT e.exercise_id,x.name,s.load_kg,s.reps FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN exercises x ON x.id=e.exercise_id WHERE e.workout_id=? AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL AND s.kind NOT IN ('warmup','cooldown') AND e.tracking_type='weight_reps' AND s.load_kg IS NOT NULL AND s.reps IS NOT NULL AND s.reps>0 AND s.reps<=12`,[workoutId])
  const best=new Map<number,{name:string;e1rm:number}>()
  for(const r of rows){
    const value=r.reps===1?r.load_kg:r.load_kg*(1+r.reps/30)
    const current=best.get(r.exercise_id)
    if(!current||value>current.e1rm) best.set(r.exercise_id,{name:r.name,e1rm:value})
  }
  const prs:Array<{name:string;e1rm_kg:number}>=[]
  for(const [exerciseId,session] of best){
    // 30.0 on purpose: SQLite divides integers integrally (8/30 = 0), which
    // would silently shrink every multi-rep e1RM and mint false PRs.
    const previous=await db.get<{v:number|null}>(`SELECT MAX(CASE WHEN s.reps=1 THEN s.load_kg ELSE s.load_kg*(1.0+s.reps/30.0) END) v FROM workout_sets s JOIN workout_exercises e ON e.id=s.workout_exercise_id JOIN workouts w ON w.id=e.workout_id WHERE e.exercise_id=? AND w.id!=? AND w.status='completed' AND w.deleted_at IS NULL AND e.deleted_at IS NULL AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL AND s.kind NOT IN ('warmup','cooldown') AND e.tracking_type='weight_reps' AND s.reps>0 AND s.reps<=12`,[exerciseId,workoutId])
    if(previous?.v==null||session.e1rm>previous.v) prs.push({name:session.name,e1rm_kg:Math.round(session.e1rm*100)/100})
  }
  return prs.sort((a,b)=>a.name.localeCompare(b.name))
}
