import { createSyncMetadata, recordOperation, isValidOperationPayload, validateLocalDate, getOperationByIdempotencyKey, type BatchChange, type DbAdapter, type SqlValue } from '@nutai/db-adapter'
import { writeRow } from '@nutai/training'
import { emitFoodMutation } from './food-mutations'
type Row=Record<string,SqlValue>
export interface MealSnapshot {meal:Row;items:Row[];ledger:Row[]}
export interface Shortcut {id:number;meal_id:number;name:string;kind:'favorite'|'usual'|'saved';snapshot_json:string}
export async function mealSnapshot(db:DbAdapter,id:number):Promise<MealSnapshot> {
  const meal=await db.get<Row>('SELECT * FROM meals WHERE id=? AND deleted_at IS NULL',[id]);if(!meal)throw new Error('Meal no longer exists')
  const items=await db.all<Row>('SELECT * FROM log_items WHERE meal_id=? AND deleted_at IS NULL ORDER BY sort_order,id',[id])
  return {meal:{...meal,photo_uri:null},items,ledger:[]}
}
export const listShortcuts=(db:DbAdapter):Promise<Shortcut[]>=>db.all('SELECT * FROM logging_shortcuts WHERE deleted_at IS NULL ORDER BY updated_at DESC,id DESC')
export async function saveShortcut(db:DbAdapter,mealId:number,kind:Shortcut['kind'],name:string,now=Date.now()):Promise<number> {
  if(!['favorite','usual','saved'].includes(kind)||!name.trim()||name.length>120)throw new Error('Enter a shortcut name')
  let opUuid: string | undefined
  const id = await db.transaction(async tx=>{
    const snapshot=await mealSnapshot(tx,mealId);const changes:BatchChange[]=[]
    const existing=await tx.get<{id:number}>('SELECT id FROM logging_shortcuts WHERE meal_id=? AND kind=? AND deleted_at IS NULL',[mealId,kind])
    const id=await writeRow(tx,'logging_shortcuts',{meal_id:mealId,kind,name:name.trim(),snapshot_json:JSON.stringify(snapshot)},now,changes,existing?.id)
    const op = await recordOperation(tx,{entityType:'batch',entityId:0,opType:'update',newJson:{changes},createdAt:now})
    opUuid = op.uuid
    return id
  })
  emitFoodMutation({ kind: 'shortcut', operationUuid: opUuid })
  return id
}
export async function removeShortcut(db:DbAdapter,id:number,now=Date.now()):Promise<void> {
  let opUuid: string | undefined
  await db.transaction(async tx=>{
    const changes:BatchChange[]=[]
    await writeRow(tx,'logging_shortcuts',{deleted_at:now},now,changes,id)
    const op = await recordOperation(tx,{entityType:'batch',entityId:0,opType:'update',newJson:{changes},createdAt:now})
    opUuid = op.uuid
  })
  emitFoodMutation({ kind: 'shortcut', operationUuid: opUuid })
}
export function dateOffset(date:string,days:number):string {validateLocalDate(date);return new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10)}
export function remapTimestamp(at:number,date:string):number {
  validateLocalDate(date);const old=new Date(at);const [y,m,d]=date.split('-').map(Number)
  return new Date(y!,m!-1,d!,old.getHours(),old.getMinutes(),old.getSeconds(),old.getMilliseconds()).getTime()
}
async function insertCopy(tx:DbAdapter,table:'meals'|'log_items',row:Row):Promise<number> {
  const allowed=new Set((await tx.all<{name:string}>(`PRAGMA table_info(${table})`)).map(c=>c.name))
  const keys=Object.keys(row).filter(k=>k!=='id')
  if(keys.some(k=>!allowed.has(k)))throw new Error('Invalid snapshot field')
  return Number((await tx.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]!))).lastInsertRowId)
}
export async function repeatSnapshots(db:DbAdapter,snapshots:MealSnapshot[],date:string,now=Date.now(),idempotencyKey?:string):Promise<number[]> {
  validateLocalDate(date)
  if(!snapshots.length)throw new Error('No meals to copy')
  if(snapshots.length>100)throw new Error('Copy at most 100 meals at a time')
  let opUuid: string | undefined
  const ids = await db.transaction(async tx=>{
    if(idempotencyKey){
      const prior=await getOperationByIdempotencyKey(tx,idempotencyKey)
      if(prior) {
        opUuid = prior.uuid
        return (JSON.parse(prior.new_json!) as {changes:BatchChange[]}).changes.map(c=>c.entityId)
      }
    }
    const changes:BatchChange[]=[];const ids:number[]=[]
    for(const snapshot of snapshots){
      if(!isValidOperationPayload('meals',JSON.stringify(snapshot))||!snapshot.items.length)throw new Error('Invalid meal snapshot')
      const at=remapTimestamp(Number(snapshot.meal['logged_at']),date)
      const meal={...snapshot.meal,...createSyncMetadata(now),logged_at:at,local_date:date,photo_uri:null}
      const id=await insertCopy(tx,'meals',meal)
      const items:Row[]=[]
      for(const item of snapshot.items){const row={...item,...createSyncMetadata(now),meal_id:id,logged_at:at};const itemId=await insertCopy(tx,'log_items',row);items.push({...row,id:itemId})}
      changes.push({entityType:'meals',entityId:id,opType:'insert',prev:null,next:{meal:{...meal,id},items,ledger:[]}});ids.push(id)
    }
    const op = await recordOperation(tx,{entityType:'batch',entityId:0,opType:'update',newJson:{changes},createdAt:now,...(idempotencyKey?{idempotencyKey}:{})})
    opUuid = op.uuid
    return ids
  })
  emitFoodMutation({ kind: 'meal', operationUuid: opUuid })
  return ids
}
export async function copyYesterday(db:DbAdapter,date:string,now=Date.now(),key?:string):Promise<number[]> {
  const rows=await db.all<{id:number}>("SELECT id FROM meals WHERE local_date=? AND deleted_at IS NULL AND analysis_status IN ('complete','manual') ORDER BY logged_at,id",[dateOffset(date,-1)])
  const snapshots:MealSnapshot[]=[];for(const row of rows)snapshots.push(await mealSnapshot(db,row.id))
  return repeatSnapshots(db,snapshots,date,now,key)
}
export interface RecentFood {id:number;name:string;last_used_at:number;frequency:number}
export async function recentFoods(db:DbAdapter,now:number):Promise<RecentFood[]> {
  return db.all(`SELECT MAX(m.id) id,li.display_name name,MAX(m.logged_at) last_used_at,COUNT(DISTINCT m.id) frequency
    FROM meals m JOIN log_items li ON li.meal_id=m.id WHERE m.deleted_at IS NULL AND li.deleted_at IS NULL AND m.logged_at BETWEEN ? AND ?
    AND m.analysis_status IN ('complete','manual') AND COALESCE(m.engine_id,'') NOT LIKE 'test%'
    GROUP BY li.matched_food_source,li.matched_food_id,li.display_name ORDER BY last_used_at DESC,id DESC LIMIT 50`,[now-30*86400000,now])
}
