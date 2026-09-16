import { createSyncMetadata, recordOperation, type DbAdapter } from '@nutai/db-adapter'
import { emitFoodMutation } from './food-mutations'
import type { ManualFoodSelection } from './manual-food'

export type FoodServingUnit = 'g' | 'oz'

export interface CustomFoodInput {
  name: string
  brand?: string | null
  barcode?: string | null
  servingAmount: number
  servingUnit: FoodServingUnit
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g?: number | null
}

export interface CustomFood extends CustomFoodInput {
  id: number
  uuid: string
  servingSizeG: number
}

const GRAMS_PER_OUNCE = 28.349523125

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`)
  return value
}

export function servingGrams(amount: number, unit: FoodServingUnit): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Serving amount must be greater than zero')
  if (unit !== 'g' && unit !== 'oz') throw new Error('Serving unit must be g or oz')
  return unit === 'oz' ? amount * GRAMS_PER_OUNCE : amount
}

export function validateCustomFood(input: CustomFoodInput): CustomFoodInput {
  const name = input.name.trim()
  if (!name) throw new Error('Food name is required')
  servingGrams(input.servingAmount, input.servingUnit)
  finiteNonNegative(input.calories, 'Calories')
  finiteNonNegative(input.protein_g, 'Protein')
  finiteNonNegative(input.carbs_g, 'Carbs')
  finiteNonNegative(input.fat_g, 'Fat')
  if (input.fiber_g !== null && input.fiber_g !== undefined) finiteNonNegative(input.fiber_g, 'Fiber')
  return {
    ...input,
    name,
    brand: input.brand?.trim() || null,
    barcode: input.barcode?.trim() || null,
    fiber_g: input.fiber_g ?? null,
  }
}

function cleanFloat(value: number): number {
  return Math.round(value * 100) / 100
}

function rowToCustomFood(row: Record<string, unknown>): CustomFood {
  const grams = Number(row['serving_size_g'])
  const scale = grams / 100
  return {
    id: Number(row['id']),
    uuid: String(row['uuid']),
    name: String(row['name']),
    brand: row['brand'] == null ? null : String(row['brand']),
    barcode: row['barcode'] == null ? null : String(row['barcode']),
    servingAmount: cleanFloat(Number(row['serving_amount'] ?? grams)),
    servingUnit: row['serving_unit'] === 'oz' ? 'oz' : 'g',
    servingSizeG: grams,
    calories: cleanFloat(Number(row['energy_kcal']) * scale),
    protein_g: cleanFloat(Number(row['protein_g']) * scale),
    carbs_g: cleanFloat(Number(row['carb_g']) * scale),
    fat_g: cleanFloat(Number(row['fat_g']) * scale),
    fiber_g: row['fiber_g'] == null ? null : cleanFloat(Number(row['fiber_g']) * scale),
  }
}

export async function getCustomFood(db: DbAdapter, id: number): Promise<CustomFood | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const row = await db.get<Record<string, unknown>>(
    'SELECT * FROM user_foods WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  return row ? rowToCustomFood(row) : null
}

export async function listCustomFoods(db: DbAdapter): Promise<CustomFood[]> {
  const rows = await db.all<Record<string, unknown>>(
    'SELECT * FROM user_foods WHERE deleted_at IS NULL ORDER BY lower(name), id',
  )
  return rows.map(rowToCustomFood)
}

export async function createCustomFood(db: DbAdapter, raw: CustomFoodInput, now: number): Promise<CustomFood> {
  const input = validateCustomFood(raw)
  const grams = servingGrams(input.servingAmount, input.servingUnit)
  const scale = 100 / grams
  const sync = createSyncMetadata(now)

  const food = await db.transaction(async (tx) => {
    const duplicate = await tx.get<{ id: number }>(
      'SELECT id FROM user_foods WHERE lower(trim(name)) = lower(?) AND deleted_at IS NULL LIMIT 1', [input.name],
    )
    if (duplicate) throw new Error('A custom food with this name already exists')
    const result = await tx.run(
      `INSERT INTO user_foods
       (name, brand, barcode, basis, serving_size_g, serving_amount, serving_unit,
        energy_kcal, protein_g, fat_g, carb_g, fiber_g,
        created_at, uuid, updated_at, revision, deleted_at, sync_state)
       VALUES (?, ?, ?, 'per_100g', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.name,
        input.brand ?? null,
        input.barcode ?? null,
        grams,
        input.servingAmount,
        input.servingUnit,
        input.calories * scale,
        input.protein_g * scale,
        input.fat_g * scale,
        input.carbs_g * scale,
        input.fiber_g == null ? null : input.fiber_g * scale,
        now,
        sync.uuid,
        sync.updated_at,
        sync.revision,
        sync.deleted_at,
        sync.sync_state,
      ],
    )
    const id = Number(result.lastInsertRowId)
    const row = await tx.get<Record<string, unknown>>('SELECT * FROM user_foods WHERE id = ?', [id])
    if (!row) throw new Error('Custom food was not saved')
    await recordOperation(tx, {
      entityType: 'user_foods',
      entityId: id,
      opType: 'insert',
      newJson: row,
      actor: 'user',
      createdAt: now,
    })
    return rowToCustomFood(row)
  })
  emitFoodMutation({ kind: 'custom-food' })
  return food
}

export async function updateCustomFood(
  db: DbAdapter,
  id: number,
  raw: CustomFoodInput,
  now: number,
): Promise<CustomFood> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid custom food id')
  const input = validateCustomFood(raw)
  const grams = servingGrams(input.servingAmount, input.servingUnit)
  const scale = 100 / grams

  const food = await db.transaction(async (tx) => {
    const previous = await tx.get<Record<string, unknown>>(
      'SELECT * FROM user_foods WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    if (!previous) throw new Error('Custom food not found')
    await tx.run(
      `UPDATE user_foods
       SET name = ?, brand = ?, barcode = ?, serving_size_g = ?, serving_amount = ?, serving_unit = ?,
           energy_kcal = ?, protein_g = ?, fat_g = ?, carb_g = ?, fiber_g = ?,
           updated_at = ?, revision = revision + 1, sync_state = 'local'
       WHERE id = ?`,
      [
        input.name,
        input.brand ?? null,
        input.barcode ?? null,
        grams,
        input.servingAmount,
        input.servingUnit,
        input.calories * scale,
        input.protein_g * scale,
        input.fat_g * scale,
        input.carbs_g * scale,
        input.fiber_g == null ? null : input.fiber_g * scale,
        now,
        id,
      ],
    )
    const next = await tx.get<Record<string, unknown>>('SELECT * FROM user_foods WHERE id = ?', [id])
    if (!next) throw new Error('Custom food was not updated')
    await recordOperation(tx, {
      entityType: 'user_foods',
      entityId: id,
      opType: 'update',
      prevJson: previous,
      newJson: next,
      actor: 'user',
      createdAt: now,
    })
    return rowToCustomFood(next)
  })
  emitFoodMutation({ kind: 'custom-food' })
  return food
}

export async function deleteCustomFood(db: DbAdapter, id: number, now: number): Promise<string> {
  const operation = await db.transaction(async (tx) => {
    const previous = await tx.get<Record<string, unknown>>(
      'SELECT * FROM user_foods WHERE id = ? AND deleted_at IS NULL', [id],
    )
    if (!previous) throw new Error('Custom food not found')
    await tx.run(
      "UPDATE user_foods SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_state = 'local' WHERE id = ?",
      [now, now, id],
    )
    const next = await tx.get<Record<string, unknown>>('SELECT * FROM user_foods WHERE id = ?', [id])
    return recordOperation(tx, {
      entityType: 'user_foods', entityId: id, opType: 'update', prevJson: previous,
      newJson: next, actor: 'user', createdAt: now,
    })
  })
  emitFoodMutation({ kind: 'custom-food', operationUuid: operation.uuid })
  return operation.uuid
}

export function customFoodSelection(food: CustomFood): ManualFoodSelection {
  const scale = 100 / food.servingSizeG
  return {
    foodId: null,
    matchedFoodSource: 'userfood',
    displayName: food.name,
    grams: food.servingSizeG,
    gramPathway: 'user_serving',
    portionSource: `userfood:${food.uuid}`,
    nutrientSnapshot: {
      kcal: food.calories * scale,
      protein_g: food.protein_g * scale,
      carbs_g: food.carbs_g * scale,
      fat_g: food.fat_g * scale,
      fiber_g: food.fiber_g == null ? null : food.fiber_g * scale,
      sugar_g: null,
      sodium_mg: null,
    },
  }
}
