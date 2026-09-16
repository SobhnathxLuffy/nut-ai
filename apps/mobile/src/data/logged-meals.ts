import { recordOperation, type DbAdapter } from '@nutai/db-adapter'
import { emitFoodMutation } from './food-mutations'

export interface LoggedMealItem { id: number; name: string; grams: number; kcalPer100g: number | null }
export interface LoggedMealDetail { id: number; date: string; slot: string; items: LoggedMealItem[] }

async function aggregate(db: DbAdapter, mealId: number): Promise<Record<string, unknown>> {
  const meal = await db.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
  if (!meal) throw new Error('Meal not found')
  const items = await db.all<Record<string, unknown>>('SELECT * FROM log_items WHERE meal_id = ? ORDER BY sort_order, id', [mealId])
  const ledger = await db.all<Record<string, unknown>>('SELECT * FROM scan_cost_ledger WHERE meal_id = ? ORDER BY id', [mealId])
  return { meal, items, ledger }
}

export async function getLoggedMeal(db: DbAdapter, mealId: number): Promise<LoggedMealDetail | null> {
  const meal = await db.get<{ id:number; local_date:string; meal_slot:string | null }>('SELECT id, local_date, meal_slot FROM meals WHERE id = ?', [mealId])
  if (!meal) return null
  const items = await db.all<{id:number;display_name:string;grams:number;snap_energy_kcal:number|null}>('SELECT id, display_name, grams, snap_energy_kcal FROM log_items WHERE meal_id = ? ORDER BY sort_order, id', [mealId])
  return { id: meal.id, date: meal.local_date, slot: meal.meal_slot ?? 'snack', items: items.map(item=>({id:item.id,name:item.display_name,grams:item.grams,kcalPer100g:item.snap_energy_kcal})) }
}

export async function updateLoggedMeal(db: DbAdapter, detail: LoggedMealDetail, now: number): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(detail.date)) throw new Error('Choose a valid date')
  if (detail.items.some(item=>!item.name.trim() || !Number.isFinite(item.grams) || item.grams <= 0)) throw new Error('Each food needs a name and grams greater than zero')
  const operation = await db.transaction(async tx=>{
    const previous = await aggregate(tx,detail.id)
    await tx.run("UPDATE meals SET local_date=?, meal_slot=?, updated_at=?, revision=revision+1, sync_state='local' WHERE id=?",[detail.date,detail.slot,now,detail.id])
    for(const item of detail.items) await tx.run("UPDATE log_items SET display_name=?, grams=?, updated_at=?, revision=revision+1, sync_state='local' WHERE id=? AND meal_id=?",[item.name.trim(),item.grams,now,item.id,detail.id])
    const next=await aggregate(tx,detail.id)
    return recordOperation(tx,{entityType:'meals',entityId:detail.id,opType:'update',prevJson:previous,newJson:next,actor:'user',createdAt:now})
  })
  emitFoodMutation({kind:'meal',operationUuid:operation.uuid})
  return operation.uuid
}
