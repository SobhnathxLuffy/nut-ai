import { createSyncMetadata, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import { insertCopy } from './shortcuts'
import { emitFoodMutation } from './food-mutations'
import { parseMealHonesty, type MealHonestySnapshot } from './meal-honesty'

export interface LoggedMealItem {
  id: number
  name: string
  grams: number
  kcalPer100g: number | null
  /** Task 5-5: the model's scene-visibility claim, persisted since v12. Optional so edit/save round trips and pre-v12 callers compile unchanged. */
  visibility?: string | null
  /** Task 5-5: the row's persisted band half-width (fraction). Optional — manual/legacy rows carry NULL (no claim). */
  bandHalfPct?: number | null
}
export interface LoggedMealDetail {
  id: number
  date: string
  slot: string
  items: LoggedMealItem[]
  /** Task 5-5: the meal-level honesty snapshot parsed from meals.honesty_json; null on pre-v12/manual meals (no claim). */
  honesty?: MealHonestySnapshot | null
}

async function aggregate(db: DbAdapter, mealId: number): Promise<Record<string, unknown>> {
  const meal = await db.get<Record<string, unknown>>('SELECT * FROM meals WHERE id = ?', [mealId])
  if (!meal) throw new Error('Meal not found')
  const items = await db.all<Record<string, unknown>>('SELECT * FROM log_items WHERE meal_id = ? ORDER BY sort_order, id', [mealId])
  const ledger = await db.all<Record<string, unknown>>('SELECT * FROM scan_cost_ledger WHERE meal_id = ? ORDER BY id', [mealId])
  return { meal, items, ledger }
}

export async function getLoggedMeal(db: DbAdapter, mealId: number): Promise<LoggedMealDetail | null> {
  const meal = await db.get<{ id:number; local_date:string; meal_slot:string | null; honesty_json:string | null }>('SELECT id, local_date, meal_slot, honesty_json FROM meals WHERE id = ?', [mealId])
  if (!meal) return null
  const items = await db.all<{id:number;display_name:string;grams:number;snap_energy_kcal:number|null;visibility:string | null;band_half_pct:number | null}>('SELECT id, display_name, grams, snap_energy_kcal, visibility, band_half_pct FROM log_items WHERE meal_id = ? AND deleted_at IS NULL ORDER BY sort_order, id', [mealId])
  return {
    id: meal.id,
    date: meal.local_date,
    slot: meal.meal_slot ?? 'snack',
    // Task 5-5: the persisted honesty surfaces here for meal-detail to
    // render. NULL/absent/corrupt honesty_json parses to null — the honest
    // "no claim" a pre-v12 or manual meal carries, never an invented snapshot.
    honesty: parseMealHonesty(meal.honesty_json),
    items: items.map((item) => ({
      id: item.id,
      name: item.display_name,
      grams: item.grams,
      kcalPer100g: item.snap_energy_kcal,
      visibility: item.visibility ?? null,
      bandHalfPct: item.band_half_pct ?? null,
    })),
  }
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

// ---------------------------------------------------------------------------
// Row actions (UI/UX report Ch. 8.3, Wave 3): meal-detail's per-item
// duplicate/remove. Same operation shape updateLoggedMeal writes — meal
// 'update' with full { meal, items, ledger } prev/new aggregates — so the ONE
// undoOperation path reverses them like every other meal edit.
// ---------------------------------------------------------------------------

const TOUCHED_ITEM_UPDATE = `updated_at = ?, revision = revision + 1, sync_state = 'local'`

/**
 * Duplicate one logged item: a byte-identical nutrition snapshot (same food,
 * same grams, same per-100 g numbers) appended after the meal's last row with
 * fresh sync metadata. Undo removes the copy.
 */
export async function duplicateLoggedItem(db: DbAdapter, mealId: number, itemId: number, now: number): Promise<string> {
  const operation = await db.transaction(async tx=>{
    const previous = await aggregate(tx,mealId)
    const item = await tx.get<Record<string, unknown>>(
      'SELECT * FROM log_items WHERE id = ? AND meal_id = ? AND deleted_at IS NULL',
      [itemId,mealId],
    )
    if (!item) throw new Error('Item not found')
    const sort = await tx.get<{ next: number }>(
      'SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM log_items WHERE meal_id = ? AND deleted_at IS NULL',
      [mealId],
    )
    const row = { ...item, ...createSyncMetadata(now), meal_id: mealId, sort_order: sort!.next }
    const copyId = await insertCopy(tx,'log_items',row)
    if (!copyId) throw new Error('Could not duplicate the item')
    const next = await aggregate(tx,mealId)
    return recordOperation(tx,{entityType:'meals',entityId:mealId,opType:'update',prevJson:previous,newJson:next,actor:'user',createdAt:now})
  })
  emitFoodMutation({kind:'meal',operationUuid:operation.uuid})
  return operation.uuid
}

/**
 * Remove one logged item (soft delete — the row stays for Undo/redo and
 * backup). Undo restores it. Removing the LAST item of a meal is allowed:
 * the meal row stays with zero items, which the timeline renders honestly.
 */
export async function removeLoggedItem(db: DbAdapter, mealId: number, itemId: number, now: number): Promise<string> {
  const operation = await db.transaction(async tx=>{
    const previous = await aggregate(tx,mealId)
    const result = await tx.run(
      `UPDATE log_items SET deleted_at = ?, ${TOUCHED_ITEM_UPDATE} WHERE id = ? AND meal_id = ? AND deleted_at IS NULL`,
      [now,now,itemId,mealId],
    )
    if (!result.changes) throw new Error('Item not found')
    const next = await aggregate(tx,mealId)
    return recordOperation(tx,{entityType:'meals',entityId:mealId,opType:'update',prevJson:previous,newJson:next,actor:'user',createdAt:now})
  })
  emitFoodMutation({kind:'meal',operationUuid:operation.uuid})
  return operation.uuid
}
