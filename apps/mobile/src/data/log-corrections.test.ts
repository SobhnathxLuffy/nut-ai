import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, undoOperation, listOperations, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { ManualFoodSelection } from './manual-food'

vi.mock('./food-mutations', () => ({ emitFoodMutation: vi.fn() }))

import { applyLoggedMealCorrections, loadCorrectionRows, type LoggedCorrectionWrite } from './log-corrections'
import { logManualMealWithItems } from './manual-food'
import { localDate } from './date-utils'

const NOW = 1_754_300_000_000
let database: DbAdapter

function selection(displayName: string, kcalPer100: number): ManualFoodSelection {
  return {
    foodId: 7,
    matchedFoodSource: 'usda',
    displayName,
    grams: 100,
    nutrientSnapshot: {
      kcal: kcalPer100, protein_g: 10, fat_g: 5, carbs_g: 20,
      fiber_g: 2, sugar_g: 1, sodium_mg: 50,
    },
  }
}

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
})

describe('AIP-004 logged-meal corrections', () => {
  it('loads today\'s items with stable m<meal>i<item> keys', async () => {
    await logManualMealWithItems(database, [selection('Roti', 300), selection('Dal', 120)], NOW)
    const rows = await loadCorrectionRows(database, localDate(NOW))
    expect(rows.length).toBe(2)
    expect(rows[0]!.displayName).toBe('Roti')
    expect(rows[0]!.key).toMatch(/^m\d+i\d+$/)
    expect(rows[0]!.kcalEach).toBe(300) // 100 g at 300 kcal/100 g
  })

  it('applies a confirmed quantity update and removal through the operation log', async () => {
    await logManualMealWithItems(database, [selection('Rice', 130), selection('Ghee', 900)], NOW)
    const rows = await loadCorrectionRows(database, localDate(NOW))
    const rice = rows.find((r) => r.displayName === 'Rice')!
    const ghee = rows.find((r) => r.displayName === 'Ghee')!

    const writes: LoggedCorrectionWrite[] = [
      { kind: 'update', key: rice.key, grams: 50 },
      { kind: 'remove', key: ghee.key },
    ]
    const applied = await applyLoggedMealCorrections(database, writes, NOW + 1000)
    expect(applied.ok).toBe(true)
    expect(applied.appliedMeals.length).toBe(1)
    expect(applied.unknownKeys).toEqual([])

    const after = await loadCorrectionRows(database, localDate(NOW))
    const riceAfter = after.find((r) => r.displayName === 'Rice')!
    expect(riceAfter.grams).toBe(50)
    expect(after.find((r) => r.displayName === 'Ghee')).toBeUndefined()

    const ops = await listOperations(database)
    const correctionOp = ops.filter((o) => o.op_type === 'update').sort((a, b) => a.id - b.id).pop()
    expect(correctionOp).toBeDefined()
    expect(correctionOp!.actor).toBe('user')
    const prev = JSON.parse(correctionOp!.prev_json!)
    expect(prev.meal).toBeDefined()
    expect(prev.items.length).toBe(2)
  })

  it('undo restores the exact previous meal state', async () => {
    await logManualMealWithItems(database, [selection('Paneer', 265)], NOW)
    const rows = await loadCorrectionRows(database, localDate(NOW))
    const paneer = rows.find((r) => r.displayName === 'Paneer')!

    const applied = await applyLoggedMealCorrections(database, [{ kind: 'update', key: paneer.key, grams: 30 }], NOW + 2000)
    expect(applied.ok).toBe(true)
    const op = (await listOperations(database)).filter((o) => o.op_type === 'update').sort((a, b) => a.id - b.id).pop()!

    const undo = await undoOperation(database, op.id, NOW + 3000)
    expect(undo.success).toBe(true)
    const restored = await loadCorrectionRows(database, localDate(NOW))
    expect(restored.find((r) => r.displayName === 'Paneer')!.grams).toBe(100)
  })

  it('appends a corpus-resolved item to an existing meal', async () => {
    await logManualMealWithItems(database, [selection('Dal', 120)], NOW)
    const rows = await loadCorrectionRows(database, localDate(NOW))
    const mealId = rows[0]!.mealId

    const applied = await applyLoggedMealCorrections(database, [
      { kind: 'add', mealId, selection: selection('Curd', 60) },
    ], NOW + 4000)
    expect(applied.ok).toBe(true)

    const after = await loadCorrectionRows(database, localDate(NOW))
    const curd = after.find((r) => r.displayName === 'Curd')
    expect(curd).toBeDefined()
    expect(curd!.mealId).toBe(mealId)
  })

  it('collects unknown keys instead of touching storage', async () => {
    await logManualMealWithItems(database, [selection('Roti', 300)], NOW)
    const applied = await applyLoggedMealCorrections(database, [
      { kind: 'remove', key: 'm999i999' },
    ], NOW + 5000)
    expect(applied.ok).toBe(false)
    expect(applied.unknownKeys).toEqual(['m999i999'])
    expect(applied.appliedMeals).toEqual([])
  })
})
