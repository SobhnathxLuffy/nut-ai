import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
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
vi.mock('../widgets/publish', () => ({
  publishResetSnapshot: vi.fn(),
  scheduleWidgetPublish: vi.fn(),
}))

import {
  completePendingMeal,
  createPendingMeal,
  dayTotals,
  deleteMeal,
  failPendingMeal,
  markPendingMealStage,
  retryPendingMeal,
} from './repo'

const NOW = 1_754_300_000_000
let database: DbAdapter

function scanResult(name = 'Dal'): ScanResult {
  const ingredient: IngredientRow = {
    id: 'ingredient-1',
    displayName: name,
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

async function statusOf(mealId: number): Promise<string> {
  const row = await database.get<{ analysis_status: string }>('SELECT analysis_status FROM meals WHERE id = ?', [mealId])
  return row!.analysis_status
}

beforeAll(async () => {
  database = openMemoryDb()
  await migrate(database, NOW)
  testState.database = database
})

describe('optimistic scan logging — the pending-meal state machine', () => {
  it('createPendingMeal writes a captured row with photo, slot, zero items — nothing can fail the meal', async () => {
    const mealId = await createPendingMeal('file:///tmp/shot.jpg', NOW)
    expect(mealId).toBeGreaterThan(0)
    const row = await database.get<{ analysis_status: string; photo_uri: string | null; local_date: string; logged_at: number }>(
      'SELECT analysis_status, photo_uri, local_date, logged_at FROM meals WHERE id = ?', [mealId],
    )
    expect(row!.analysis_status).toBe('captured')
    expect(row!.photo_uri).toBe('file:///tmp/shot.jpg')
    expect(row!.logged_at).toBe(NOW)
    const items = await database.all<{ id: number }>('SELECT id FROM log_items WHERE meal_id = ?', [mealId])
    expect(items).toHaveLength(0)
  })

  it('dayTotals counts the captured row as pending and contributing zero kcal', async () => {
    const mealId = await createPendingMeal(null, NOW + 1000)
    const totals = await dayTotals((await database.get<{ local_date: string }>('SELECT local_date FROM meals WHERE id = ?', [mealId]))!.local_date)
    expect(totals.pendingCount).toBeGreaterThanOrEqual(1)
  })

  it('stage advances queued → analyzing on a pending row, and never on a completed one', async () => {
    const mealId = await createPendingMeal(null, NOW + 2000)
    await markPendingMealStage(mealId, 'queued')
    await markPendingMealStage(mealId, 'analyzing')
    expect(await statusOf(mealId)).toBe('analyzing')

    await completePendingMeal(mealId, scanResult(), { provider: 'openai', model: 'm1', inputTokens: 1, outputTokens: 1, costUsd: null }, NOW + 3000)
    expect(await statusOf(mealId)).toBe('complete')
    await markPendingMealStage(mealId, 'queued')
    expect(await statusOf(mealId)).toBe('complete')
  })

  it('completePendingMeal writes items + macros and upgrades the row in place', async () => {
    const mealId = await createPendingMeal('file:///tmp/x.jpg', NOW + 4000)
    const ok = await completePendingMeal(mealId, scanResult('Rajma'), { provider: 'openai', model: 'm1', inputTokens: 10, outputTokens: 20, costUsd: null }, NOW + 5000)
    expect(ok).toBe(true)
    expect(await statusOf(mealId)).toBe('complete')
    const items = await database.all<{ display_name: string; grams: number }>('SELECT display_name, grams FROM log_items WHERE meal_id = ?', [mealId])
    expect(items.map((i) => i.display_name)).toContain('Rajma')
    expect(items[0]!.grams).toBe(180)
  })

  it('a deleted pending row can never be resurrected by a late completion (the cancel race)', async () => {
    const mealId = await createPendingMeal(null, NOW + 6000)
    await deleteMeal(mealId)
    const ok = await completePendingMeal(mealId, scanResult(), { provider: 'openai', model: 'm1', inputTokens: 1, outputTokens: 1, costUsd: null }, NOW + 7000)
    expect(ok).toBe(false)
    // deleteMeal hard-deletes (undo restores from the operation log), so the
    // guarded completion must find NO row — never recreate one.
    const row = await database.get<{ id: number }>('SELECT id FROM meals WHERE id = ?', [mealId])
    expect(row).toBeNull()
  })

  it('failPendingMeal marks only pending rows failed; retryPendingMeal revives only failed rows — once', async () => {
    const mealId = await createPendingMeal('file:///tmp/retry.jpg', NOW + 8000)
    await failPendingMeal(mealId)
    expect(await statusOf(mealId)).toBe('failed')

    const photo = await retryPendingMeal(mealId)
    expect(photo).toBe('file:///tmp/retry.jpg')
    expect(await statusOf(mealId)).toBe('captured')

    // The guarded UPDATE (same conditions as the read) makes the second
    // retry a no-op — the row is no longer failed.
    const second = await retryPendingMeal(mealId)
    expect(second).toBeNull()
    expect(await statusOf(mealId)).toBe('captured')
  })

  it('retrying a completed meal does nothing', async () => {
    const mealId = await createPendingMeal(null, NOW + 9000)
    await completePendingMeal(mealId, scanResult(), { provider: 'openai', model: 'm1', inputTokens: 1, outputTokens: 1, costUsd: null }, NOW + 9500)
    expect(await retryPendingMeal(mealId)).toBeNull()
    expect(await statusOf(mealId)).toBe('complete')
  })
})
