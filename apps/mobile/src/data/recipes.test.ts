import { beforeEach, describe, expect, it } from 'vitest'
import { getOperation, migrate, redoOperation, undoOperation, USER_SCHEMA_VERSION, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { createRecipe, editRecipe, getEditableRecipe, listRecipes, logRecipe, type RecipeDraft } from './recipes'
import { buildBackupPayload, importBackupPayload } from './backup-core'

const NOW = 1_760_000_000_000

const DAL: RecipeDraft = {
  name: 'Home dal',
  preparation: 'boiled',
  addedOilG: 10,
  addedWaterG: 200,
  finalCookedWeightG: 300,
  servings: 2,
  ingredients: [{
    foodId: 'ifct:B013',
    displayName: 'Lentil dal',
    gramWeight: 100,
    energyKcal: 340,
    proteinG: 22,
    fatG: 1,
    carbG: 60,
    fiberG: 10,
    sugarG: 2,
    sodiumMg: 15,
  }],
}

describe('recipe repository', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)
  })

  it('creates an immutable v1 recipe with component nutrition snapshots', async () => {
    const created = await createRecipe(db, DAL, NOW, { idempotencyKey: 'recipe-home-dal' })
    const replay = await createRecipe(db, DAL, NOW + 1, { idempotencyKey: 'recipe-home-dal' })
    expect(replay.recipeId).toBe(created.recipeId)

    const recipe = await getEditableRecipe(db, created.recipeId)
    expect(recipe?.versionNumber).toBe(1)
    expect(recipe?.ingredients[0]?.foodId).toBe('ifct:B013')
    expect(recipe?.ingredients[0]?.energyKcal).toBe(340)
    expect(await listRecipes(db)).toMatchObject([{ name: 'Home dal', versionNumber: 1, energyKcal: 215.1 }])
  })

  it('edits by appending v2 and undo/redo restores the whole aggregate', async () => {
    const created = await createRecipe(db, DAL, NOW)
    const edited = await editRecipe(db, created.recipeId, {
      ...DAL,
      name: 'Home dal, less oil',
      addedOilG: 5,
    }, NOW + 1000)

    expect((await getEditableRecipe(db, created.recipeId))?.versionNumber).toBe(2)
    expect(await db.get<{ c: number }>('SELECT COUNT(*) c FROM recipe_versions WHERE recipe_id = ?', [created.recipeId]))
      .toEqual({ c: 2 })

    expect((await undoOperation(db, edited.operation.uuid, NOW + 2000)).success).toBe(true)
    expect(await getEditableRecipe(db, created.recipeId)).toMatchObject({ name: 'Home dal', versionNumber: 1 })
    expect(await db.get<{ c: number }>('SELECT COUNT(*) c FROM recipe_versions WHERE recipe_id = ?', [created.recipeId]))
      .toEqual({ c: 1 })

    expect((await redoOperation(db, edited.operation.uuid)).success).toBe(true)
    expect(await getEditableRecipe(db, created.recipeId)).toMatchObject({ name: 'Home dal, less oil', versionNumber: 2 })
  })

  it('undoes and redoes recipe creation without orphaning child rows', async () => {
    const created = await createRecipe(db, DAL, NOW)
    expect((await undoOperation(db, created.operation.id, NOW + 1)).success).toBe(true)
    expect(await getEditableRecipe(db, created.recipeId)).toBeNull()
    expect((await db.get<{ c: number }>('SELECT COUNT(*) c FROM recipe_components'))?.c).toBe(0)

    expect((await redoOperation(db, created.operation.id)).success).toBe(true)
    expect(await getEditableRecipe(db, created.recipeId)).toMatchObject({ name: 'Home dal', versionNumber: 1 })
    expect((await getOperation(db, created.operation.id))?.undone_at).toBeNull()
  })

  it('logs one serving with immutable macros and recipe provenance', async () => {
    const created = await createRecipe(db, DAL, NOW)
    const mealId = await logRecipe(db, created.recipeId, NOW + 1000)
    const item = await db.get<{
      grams: number
      matched_food_source: string
      portion_source: string
      snap_energy_kcal: number
    }>('SELECT grams, matched_food_source, portion_source, snap_energy_kcal FROM log_items WHERE meal_id = ?', [mealId])
    expect(item?.grams).toBe(150)
    expect(item?.matched_food_source).toBe('recipe')
    expect(item?.portion_source).toContain(':v1')
    expect(item?.snap_energy_kcal).toBeCloseTo(215.1, 1)
  })

  it('rejects empty recipes before opening a transaction', async () => {
    await expect(createRecipe(db, { ...DAL, ingredients: [] }, NOW)).rejects.toThrow(/ingredient/)
  })

  it('round-trips every recipe version and component snapshot through backup v2', async () => {
    const created = await createRecipe(db, DAL, NOW)
    await editRecipe(db, created.recipeId, { ...DAL, addedOilG: 5 }, NOW + 1)
    const payload = await buildBackupPayload(db, {
      schemaVersion: USER_SCHEMA_VERSION,
      appVersion: 'test',
      now: NOW + 2,
    })
    const restored = openMemoryDb()
    await restored.exec('PRAGMA foreign_keys = ON')
    await migrate(restored, NOW)
    expect((await importBackupPayload(restored, payload, USER_SCHEMA_VERSION)).ok).toBe(true)
    expect((await restored.get<{ c: number }>('SELECT COUNT(*) c FROM recipe_versions'))?.c).toBe(2)
    expect((await restored.get<{ c: number }>('SELECT COUNT(*) c FROM recipe_components'))?.c).toBe(2)
    expect((await getEditableRecipe(restored, created.recipeId))?.ingredients[0]?.energyKcal).toBe(340)
  })
})

describe('recipe migration v9', () => {
  it('preserves existing operations and adds recipe support', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW, 8)
    await db.run(
      `INSERT INTO operations
       (uuid, entity_type, entity_id, op_type, actor, created_at)
       VALUES ('018f0000-0000-7000-8000-000000000001', 'meals', 9, 'insert', 'user', ?)`,
      [NOW],
    )
    const result = await migrate(db, NOW + 1)
    expect(result.to).toBe(USER_SCHEMA_VERSION)
    expect((await db.get<{ c: number }>('SELECT COUNT(*) c FROM operations'))?.c).toBe(1)
    const columns = await db.all<{ name: string }>('PRAGMA table_info(recipe_components)')
    expect(columns.map((column) => column.name)).toContain('display_name')
  })
})
