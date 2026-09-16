import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate } from '@nutai/db-adapter'
import { openNodeDb } from '@nutai/db-adapter/node'
import { UserFoodSource } from '@nutai/nutrition-sources'
import { logManualFood } from './manual-food'
import { createCustomFood, customFoodSelection, deleteCustomFood, getCustomFood, listCustomFoods, updateCustomFood, validateCustomFood } from './custom-foods'

const openHandles: Array<ReturnType<typeof openNodeDb>> = []

afterEach(async () => {
  await Promise.all(openHandles.splice(0).map((db) => db.close()))
})

const input = {
  name: 'Test Besan Ladoo',
  brand: 'Home',
  servingAmount: 1.5,
  servingUnit: 'oz' as const,
  calories: 210,
  protein_g: 5,
  carbs_g: 26,
  fat_g: 10,
  fiber_g: 2,
  barcode: '8901234567890',
}

describe('custom food domain flow', () => {
  it.each([
    [{ ...input, name: '' }, /name/i],
    [{ ...input, servingAmount: 0 }, /serving/i],
    [{ ...input, calories: Number.NaN }, /calories/i],
    [{ ...input, protein_g: Number.POSITIVE_INFINITY }, /protein/i],
    [{ ...input, carbs_g: -1 }, /carbs/i],
  ])('rejects invalid input without NaN/Infinity coercion', (value, error) => {
    expect(() => validateCustomFood(value)).toThrow(error)
  })

  it('creates, searches, logs, edits, restarts, and searches again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nutai-custom-food-'))
    const path = join(dir, 'user.db')
    const first = openNodeDb(path)
    openHandles.push(first)
    await migrate(first, Date.now())

    const created = await createCustomFood(first, input, Date.now())
    const source = new UserFoodSource(first)
    const results = await source.search('Besan Ladoo')
    expect(results[0]?.foodId).toBe(`userfood:${created.uuid}`)
    const resolved = await source.resolveById(`userfood:${created.uuid}`)
    expect(resolved?.servingSizeG).toBeCloseTo(42.5242846875, 8)
    expect(resolved?.energyKcal).toBeCloseTo(493.835, 2)

    await logManualFood(first, {
      foodId: null,
      matchedFoodSource: 'userfood',
      displayName: created.name,
      grams: created.servingSizeG,
      nutrientSnapshot: {
        kcal: resolved!.energyKcal!,
        protein_g: resolved!.proteinG!,
        carbs_g: resolved!.carbG!,
        fat_g: resolved!.fatG!,
        fiber_g: resolved!.fiberG,
        sugar_g: null,
        sodium_mg: null,
      },
    }, Date.now())
    const logged = await first.get<{ kcal: number }>('SELECT snap_energy_kcal * grams / 100 kcal FROM log_items')
    expect(logged?.kcal).toBeCloseTo(210, 8)

    await updateCustomFood(first, created.id, { ...input, name: 'Edited Besan Ladoo', calories: 220 }, Date.now())
    expect((await getCustomFood(first, created.id))?.calories).toBeCloseTo(220, 8)
    await first.close()
    openHandles.splice(openHandles.indexOf(first), 1)

    const reopened = openNodeDb(path)
    openHandles.push(reopened)
    const restartedResults = await new UserFoodSource(reopened).search('Edited Besan')
    expect(restartedResults).toHaveLength(1)
    expect(restartedResults[0]?.foodId).toBe(`userfood:${created.uuid}`)
    expect((await listCustomFoods(reopened))[0]?.name).toBe('Edited Besan Ladoo')
  })

  it('supports Save & Log through the shared reviewed selection and contextual delete undo', async () => {
    const database = openNodeDb(':memory:'); openHandles.push(database); await migrate(database, Date.now())
    const created = await createCustomFood(database, input, Date.now())
    const mealId = await logManualFood(database, customFoodSelection(created), Date.now(), { localDate: '2025-01-02', mealSlot: 'lunch' })
    expect(await database.get('SELECT local_date,meal_slot FROM meals WHERE id=?',[mealId])).toEqual({local_date:'2025-01-02',meal_slot:'lunch'})
    const operationUuid = await deleteCustomFood(database, created.id, Date.now())
    expect(await getCustomFood(database, created.id)).toBeNull()
    const { undoOperation } = await import('@nutai/db-adapter')
    expect((await undoOperation(database, operationUuid)).success).toBe(true)
    expect((await getCustomFood(database, created.id))?.name).toBe(input.name)
  })

  it('handles exact duplicate names case-insensitively', async () => {
    const database = openNodeDb(':memory:'); openHandles.push(database); await migrate(database, Date.now())
    await createCustomFood(database,input,Date.now())
    await expect(createCustomFood(database,{...input,name:`  ${input.name.toUpperCase()}  `},Date.now())).rejects.toThrow(/already exists/)
  })

  it('cleanly rounds floating point numbers for ounce-based custom food edits', async () => {
    const database = openNodeDb(':memory:'); openHandles.push(database); await migrate(database, Date.now())
    const created = await createCustomFood(database, {
      name: 'Almond Butter',
      brand: 'Nutty',
      servingAmount: 2,
      servingUnit: 'oz',
      calories: 190,
      protein_g: 7,
      carbs_g: 6,
      fat_g: 17,
      fiber_g: 3,
    }, Date.now())
    const retrieved = await getCustomFood(database, created.id)
    expect(retrieved?.calories).toBe(190)
    expect(retrieved?.protein_g).toBe(7)
    expect(retrieved?.carbs_g).toBe(6)
    expect(retrieved?.fat_g).toBe(17)
    expect(retrieved?.fiber_g).toBe(3)
    expect(retrieved?.servingAmount).toBe(2)
  })
})
