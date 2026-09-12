import {
  createSyncMetadata,
  getOperationByIdempotencyKey,
  recordOperation,
  type DbAdapter,
  type OperationActor,
  type OperationRecord,
} from '@nutai/db-adapter'
import { computeRecipeServing, validateRecipeVersion, type RecipeVersion } from '@nutai/recipe-engine'
import { logManualFood } from './manual-food'

export type RecipePreparation = RecipeVersion['preparation']

export interface RecipeIngredientDraft {
  foodId: string
  displayName: string
  gramWeight: number
  energyKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sugarG: number
  sodiumMg: number
}

export interface RecipeDraft {
  name: string
  preparation: RecipePreparation
  addedOilG: number
  addedWaterG: number
  finalCookedWeightG: number
  servings: number
  ingredients: RecipeIngredientDraft[]
}

export interface RecipeListItem {
  id: number
  uuid: string
  name: string
  versionNumber: number
  servingSizeG: number
  energyKcal: number
}

export interface EditableRecipe extends RecipeDraft {
  id: number
  uuid: string
  versionNumber: number
}

interface RecipeAggregate extends Record<string, unknown> {
  recipe: Record<string, unknown>
  versions: Record<string, unknown>[]
  components: Record<string, unknown>[]
}

function normalizedDraft(draft: RecipeDraft): RecipeDraft {
  const name = draft.name.trim()
  if (!name) throw new RangeError('Recipe name is required')
  if (draft.ingredients.length === 0) throw new RangeError('At least one ingredient is required')
  const result = { ...draft, name, ingredients: draft.ingredients.map((ingredient) => ({
    ...ingredient,
    displayName: ingredient.displayName.trim(),
    foodId: ingredient.foodId.trim(),
  })) }
  if (result.ingredients.some((ingredient) => !ingredient.displayName || !ingredient.foodId)) {
    throw new RangeError('Every ingredient needs a name and source ID')
  }
  validateRecipeVersion(result)
  return result
}

async function aggregateFor(db: DbAdapter, recipeId: number): Promise<RecipeAggregate> {
  const recipe = await db.get<Record<string, unknown>>('SELECT * FROM recipes WHERE id = ?', [recipeId])
  if (!recipe) throw new Error(`Recipe ${recipeId} does not exist`)
  const versions = await db.all<Record<string, unknown>>(
    'SELECT * FROM recipe_versions WHERE recipe_id = ? ORDER BY version_number, id',
    [recipeId],
  )
  const components = await db.all<Record<string, unknown>>(
    `SELECT * FROM recipe_components
     WHERE recipe_version_id IN (SELECT id FROM recipe_versions WHERE recipe_id = ?)
     ORDER BY recipe_version_id, id`,
    [recipeId],
  )
  return { recipe, versions, components }
}

async function appendVersion(
  db: DbAdapter,
  recipeId: number,
  versionNumber: number,
  draft: RecipeDraft,
  now: number,
): Promise<number> {
  const versionSync = createSyncMetadata(now)
  const result = await db.run(
    `INSERT INTO recipe_versions
       (uuid, recipe_id, version_number, preparation, added_oil_g, added_water_g,
        final_cooked_weight_g, servings, created_at, sync_state, updated_at, revision, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      versionSync.uuid, recipeId, versionNumber, draft.preparation, draft.addedOilG,
      draft.addedWaterG, draft.finalCookedWeightG, draft.servings, now,
      versionSync.sync_state, versionSync.updated_at, versionSync.revision, versionSync.deleted_at,
    ],
  )
  const versionId = Number(result.lastInsertRowId)

  for (const ingredient of draft.ingredients) {
    const sync = createSyncMetadata(now)
    await db.run(
      `INSERT INTO recipe_components
         (uuid, recipe_version_id, food_id, gram_weight, created_at, sync_state,
          snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, snap_fiber_g,
          snap_sugar_g, snap_sodium_mg, updated_at, revision, deleted_at, display_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sync.uuid, versionId, ingredient.foodId, ingredient.gramWeight, now, sync.sync_state,
        ingredient.energyKcal, ingredient.proteinG, ingredient.fatG, ingredient.carbG,
        ingredient.fiberG, ingredient.sugarG, ingredient.sodiumMg, sync.updated_at,
        sync.revision, sync.deleted_at, ingredient.displayName,
      ],
    )
  }
  return versionId
}

export async function createRecipe(
  db: DbAdapter,
  input: RecipeDraft,
  now: number,
  options?: { actor?: OperationActor | string; idempotencyKey?: string },
): Promise<{ recipeId: number; operation: OperationRecord }> {
  const draft = normalizedDraft(input)
  return db.transaction(async (tx) => {
    if (options?.idempotencyKey) {
      const existing = await getOperationByIdempotencyKey(tx, options.idempotencyKey)
      if (existing) return { recipeId: existing.entity_id, operation: existing }
    }
    const sync = createSyncMetadata(now)
    const result = await tx.run(
      `INSERT INTO recipes (uuid, name, created_at, updated_at, deleted_at, sync_state, revision)
       VALUES (?,?,?,?,?,?,?)`,
      [sync.uuid, draft.name, now, now, sync.deleted_at, sync.sync_state, sync.revision],
    )
    const recipeId = Number(result.lastInsertRowId)
    await appendVersion(tx, recipeId, 1, draft, now)
    const aggregate = await aggregateFor(tx, recipeId)
    const operation = await recordOperation(tx, {
      entityType: 'recipes', entityId: recipeId, opType: 'insert', newJson: aggregate,
      actor: options?.actor ?? 'user', idempotencyKey: options?.idempotencyKey, createdAt: now,
    })
    return { recipeId, operation }
  })
}

export async function editRecipe(
  db: DbAdapter,
  recipeId: number,
  input: RecipeDraft,
  now: number,
  options?: { actor?: OperationActor | string; idempotencyKey?: string },
): Promise<{ recipeId: number; operation: OperationRecord }> {
  const draft = normalizedDraft(input)
  return db.transaction(async (tx) => {
    if (options?.idempotencyKey) {
      const existing = await getOperationByIdempotencyKey(tx, options.idempotencyKey)
      if (existing) return { recipeId: existing.entity_id, operation: existing }
    }
    const previous = await aggregateFor(tx, recipeId)
    const latest = await tx.get<{ version_number: number }>(
      'SELECT version_number FROM recipe_versions WHERE recipe_id = ? ORDER BY version_number DESC LIMIT 1',
      [recipeId],
    )
    await tx.run(
      `UPDATE recipes
       SET name = ?, updated_at = ?, revision = revision + 1, sync_state = 'local'
       WHERE id = ? AND deleted_at IS NULL`,
      [draft.name, now, recipeId],
    )
    await appendVersion(tx, recipeId, (latest?.version_number ?? 0) + 1, draft, now)
    const next = await aggregateFor(tx, recipeId)
    const operation = await recordOperation(tx, {
      entityType: 'recipes', entityId: recipeId, opType: 'update', prevJson: previous, newJson: next,
      actor: options?.actor ?? 'user', idempotencyKey: options?.idempotencyKey, createdAt: now,
    })
    return { recipeId, operation }
  })
}

export async function getEditableRecipe(db: DbAdapter, recipeId: number): Promise<EditableRecipe | null> {
  const recipe = await db.get<{ id: number; uuid: string; name: string }>(
    'SELECT id, uuid, name FROM recipes WHERE id = ? AND deleted_at IS NULL',
    [recipeId],
  )
  if (!recipe) return null
  const version = await db.get<{
    id: number
    version_number: number
    preparation: RecipePreparation
    added_oil_g: number
    added_water_g: number
    final_cooked_weight_g: number
    servings: number
  }>(
    `SELECT id, version_number, preparation, added_oil_g, added_water_g,
            final_cooked_weight_g, servings
     FROM recipe_versions
     WHERE recipe_id = ? AND deleted_at IS NULL
     ORDER BY version_number DESC LIMIT 1`,
    [recipeId],
  )
  if (!version) return null
  const components = await db.all<{
    food_id: string
    display_name: string | null
    gram_weight: number
    snap_energy_kcal: number
    snap_protein_g: number
    snap_fat_g: number
    snap_carb_g: number
    snap_fiber_g: number
    snap_sugar_g: number
    snap_sodium_mg: number
  }>('SELECT * FROM recipe_components WHERE recipe_version_id = ? AND deleted_at IS NULL ORDER BY id', [version.id])
  return {
    id: recipe.id,
    uuid: recipe.uuid,
    name: recipe.name,
    versionNumber: version.version_number,
    preparation: version.preparation,
    addedOilG: version.added_oil_g,
    addedWaterG: version.added_water_g,
    finalCookedWeightG: version.final_cooked_weight_g,
    servings: version.servings,
    ingredients: components.map((component) => ({
      foodId: component.food_id,
      displayName: component.display_name ?? component.food_id,
      gramWeight: component.gram_weight,
      energyKcal: component.snap_energy_kcal,
      proteinG: component.snap_protein_g,
      fatG: component.snap_fat_g,
      carbG: component.snap_carb_g,
      fiberG: component.snap_fiber_g,
      sugarG: component.snap_sugar_g,
      sodiumMg: component.snap_sodium_mg,
    })),
  }
}

export async function listRecipes(db: DbAdapter): Promise<RecipeListItem[]> {
  const rows = await db.all<{ id: number }>('SELECT id FROM recipes WHERE deleted_at IS NULL ORDER BY updated_at DESC')
  const items: RecipeListItem[] = []
  for (const row of rows) {
    const recipe = await getEditableRecipe(db, row.id)
    if (!recipe) continue
    const serving = computeRecipeServing(recipe)
    items.push({
      id: recipe.id,
      uuid: recipe.uuid,
      name: recipe.name,
      versionNumber: recipe.versionNumber,
      servingSizeG: serving.servingSizeG,
      energyKcal: serving.energyKcal,
    })
  }
  return items
}

export async function logRecipe(db: DbAdapter, recipeId: number, now: number): Promise<number> {
  const recipe = await getEditableRecipe(db, recipeId)
  if (!recipe) throw new Error(`Recipe ${recipeId} does not exist`)
  const serving = computeRecipeServing(recipe)
  const scaleTo100g = 100 / serving.servingSizeG
  return logManualFood(db, {
    foodId: null,
    matchedFoodSource: 'recipe',
    displayName: recipe.name,
    grams: serving.servingSizeG,
    gramPathway: 'recipe_yield',
    portionSource: `recipe:${recipe.uuid}:v${recipe.versionNumber}`,
    nutrientSnapshot: {
      kcal: serving.energyKcal * scaleTo100g,
      protein_g: serving.proteinG * scaleTo100g,
      fat_g: serving.fatG * scaleTo100g,
      carbs_g: serving.carbG * scaleTo100g,
      fiber_g: serving.fiberG * scaleTo100g,
      sugar_g: serving.sugarG * scaleTo100g,
      sodium_mg: serving.sodiumMg * scaleTo100g,
    },
  }, now)
}
