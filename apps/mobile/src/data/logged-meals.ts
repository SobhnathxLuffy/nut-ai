import { createSyncMetadata, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import { insertCopy } from './shortcuts'
import { emitFoodMutation } from './food-mutations'
import { parseMealHonesty, type MealHonestySnapshot } from './meal-honesty'

export interface LoggedMealItem {
  id: number
  name: string
  grams: number
  kcalPer100g: number | null
  // Task 11-b: the item's remaining per-100g snapshot macros, read back so
  // meal-detail can show each item's macros and the meal totals. All optional
  // so edit/save round trips and pre-existing callers compile unchanged; NULL
  // means the log row never reported that nutrient (never invented as zero).
  proteinPer100g?: number | null
  fatPer100g?: number | null
  carbPer100g?: number | null
  fiberPer100g?: number | null
  sugarPer100g?: number | null
  sodiumPer100Mg?: number | null
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
  const items = await db.all<{id:number;display_name:string;grams:number;snap_energy_kcal:number|null;snap_protein_g:number|null;snap_fat_g:number|null;snap_carb_g:number|null;snap_fiber_g:number|null;snap_sugar_g:number|null;snap_sodium_mg:number|null;visibility:string | null;band_half_pct:number | null}>('SELECT id, display_name, grams, snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg, visibility, band_half_pct FROM log_items WHERE meal_id = ? AND deleted_at IS NULL ORDER BY sort_order, id', [mealId])
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
      proteinPer100g: item.snap_protein_g,
      fatPer100g: item.snap_fat_g,
      carbPer100g: item.snap_carb_g,
      fiberPer100g: item.snap_fiber_g,
      sugarPer100g: item.snap_sugar_g,
      sodiumPer100Mg: item.snap_sodium_mg,
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
    // Task 11-b: grams edits deliberately touch ONLY display_name/grams. The
    // snap_* columns are PER-100G snapshots, so every displayed macro (snap ×
    // grams / 100) rescales itself from the new grams — no rewrite, no drift.
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
