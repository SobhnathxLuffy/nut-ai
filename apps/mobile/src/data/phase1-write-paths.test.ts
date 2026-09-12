import { beforeAll, describe, expect, it, vi } from 'vitest'
import { isValidUuid, listOperations, migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { ScanResult } from '@nutai/pipeline'

const testState = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('../db/expo-adapter', () => ({
  openUserDb: async () => testState.database as DbAdapter,
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))
vi.mock('../inference/credentials', () => ({ clearCredential: vi.fn() }))

import { logExercise, logMeal, logWeight, overrideTargets } from './repo'

const NOW = 1_754_300_000_000
let database: DbAdapter

function scanResult(): ScanResult {
  const ingredient: IngredientRow = {
    id: 'ingredient-1',
    displayName: 'Dal',
    sourceFoodId: '42',
    grams: 180,
    nutrientSnapshot: {
      kcal: 120, protein_g: 7, fat_g: 3, carbs_g: 18,
      fiber_g: 5, sugar_g: 2, sodium_mg: 250,
    },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
  }
  const meal: LoggedMeal = {
    id: 'meal-1', loggedAt: new Date(NOW).toISOString(), ingredients: [ingredient],
    portionEatenFraction: 1, engineId: 'test', promptVersion: 'p1', schemaVersion: 's1',
    clampFlags: [],
  }
  return {
    isFood: true, refusalReason: null, meal,
    items: [{ row: ingredient, band: { halfPct: 0.2, tier: 'moderate', reasons: [] }, resolution: 'auto_accept', gramPathway: ingredient.gramPathway }],
    totals: { kcal: 216, protein_g: 12.6, fat_g: 5.4, carbs_g: 32.4, fiber_g: 9, sugar_g: 3.6, sodium_mg: 450 },
    mealBand: { halfPct: 0.2, tier: 'moderate', reasons: [] },
    questions: [], clampFlags: [], zeroHitCount: 0,
  }
}

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
  testState.database = database
})

describe('Phase 1 production write paths', () => {
  it('assigns UUID metadata and records complete meal snapshots', async () => {
    const mealId = await logMeal(
      scanResult(),
      { provider: 'openai', model: 'test', inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      'file:///tmp/meal.jpg',
      NOW,
      { idempotencyKey: 'scan-1' },
    )
    const meal = await database.get<{ uuid: string; revision: number }>('SELECT uuid, revision FROM meals WHERE id = ?', [mealId])
    const item = await database.get<{ uuid: string; revision: number }>('SELECT uuid, revision FROM log_items WHERE meal_id = ?', [mealId])
    expect(isValidUuid(meal?.uuid ?? '')).toBe(true)
    expect(isValidUuid(item?.uuid ?? '')).toBe(true)
    expect(meal?.revision).toBe(1)
    expect(item?.revision).toBe(1)

    const [operation] = await listOperations(database, { entityType: 'meals', entityId: mealId })
    const snapshot = JSON.parse(operation!.new_json!)
    expect(snapshot.ledger).toHaveLength(1)
  })

  it('preserves weight identity across updates and records both operations', async () => {
    await logWeight(80, NOW + 1, { idempotencyKey: 'weight-create' })
    const first = await database.get<{ id: number; uuid: string }>('SELECT id, uuid FROM weight_entries')
    await logWeight(79.5, NOW + 2, { idempotencyKey: 'weight-update' })
    const second = await database.get<{ id: number; uuid: string; revision: number; weight_kg: number }>('SELECT id, uuid, revision, weight_kg FROM weight_entries')
    expect(second?.id).toBe(first?.id)
    expect(second?.uuid).toBe(first?.uuid)
    expect(second?.revision).toBe(2)
    expect(second?.weight_kg).toBe(79.5)
    expect(await listOperations(database, { entityType: 'weight_entries' })).toHaveLength(2)
  })

  it('gives goal and exercise inserts UUID identity and operation records', async () => {
    await overrideTargets(
      { targetKcal: 2200, macros: { protein_g: 140, fat_g: 70, carbs_g: 252.5, carbsFloored: false } },
      {
        goalType: 'maintain', targetKcal: 2200, targetRawKcal: 2200,
        floorApplied: false, protein_g: 140, fat_g: 70, carbs_g: 252.5,
        bmr: 1700, tdee: 2200, adaptive: false, effectiveFrom: NOW,
      },
      NOW + 3,
    )
    await logExercise('Run', 300, NOW + 4)

    const goal = await database.get<{ uuid: string }>('SELECT uuid FROM goals ORDER BY id DESC LIMIT 1')
    const exercise = await database.get<{ uuid: string }>('SELECT uuid FROM exercise_entries ORDER BY id DESC LIMIT 1')
    expect(isValidUuid(goal?.uuid ?? '')).toBe(true)
    expect(isValidUuid(exercise?.uuid ?? '')).toBe(true)
    expect(await listOperations(database, { entityType: 'goals' })).toHaveLength(1)
    expect(await listOperations(database, { entityType: 'exercise_entries' })).toHaveLength(1)
  })
})
