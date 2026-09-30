import { describe, expect, it } from 'vitest'
import type { ScanResult } from '@nutai/pipeline'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { SelectedQuestion } from '@nutai/repair'
import { isQuickEligible, QUICK_MAX_MEAL_BAND } from './quick-mode'

function ingredientRow(overrides: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'row-1',
    displayName: 'Cooked rice',
    sourceFoodId: '42',
    grams: 200,
    nutrientSnapshot: {
      kcal: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28,
      fiber_g: 0.4, sugar_g: 0.1, sodium_mg: 1,
    },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
    ...overrides,
  }
}

function scanResult(overrides: {
  rows?: IngredientRow[]
  mealBandHalfPct?: number
  questions?: SelectedQuestion[]
} = {}): ScanResult {
  const rows = overrides.rows ?? [ingredientRow()]
  const meal: LoggedMeal = {
    id: 'meal-1', loggedAt: '2026-01-01T12:00:00.000Z', ingredients: rows,
    portionEatenFraction: 1, engineId: 'test', promptVersion: null, schemaVersion: null,
    clampFlags: [],
  }
  const questions = overrides.questions ?? []
  return {
    isFood: true,
    refusalReason: null,
    items: rows.map((row) => ({
      row,
      band: { halfPct: 0.2, tier: 'moderate' as const, reasons: [] },
      resolution: 'auto_accept' as const,
      gramPathway: row.gramPathway,
    })),
    meal,
    totals: { kcal: 260, protein_g: 5.4, fat_g: 0.6, carbs_g: 56, fiber_g: 0.8, sugar_g: 0.2, sodium_mg: 2 },
    mealBand: { halfPct: overrides.mealBandHalfPct ?? 0.1, tier: 'tight', reasons: [] },
    questions,
    clampFlags: [],
    zeroHitCount: 0,
  }
}

describe('quick-mode eligibility', () => {
  it('a tight-band, DB-backed scan with no questions is quick-eligible', () => {
    expect(isQuickEligible(scanResult())).toBe(true)
  })

  it('a highlighted clarifying question always demands the full review', () => {
    const q = {
      question: { id: 'cooking_oil', options: [] },
      state: 'highlighted',
      text: 'Was this cooked with oil?',
    } as unknown as SelectedQuestion
    expect(isQuickEligible(scanResult({ questions: [q] }))).toBe(false)
  })

  it('a bare AI estimate (corpus miss) is never quick-logged', () => {
    expect(isQuickEligible(scanResult({
      rows: [ingredientRow({ isEstimate: true, origin: 'vision_model' })],
    }))).toBe(false)
  })

  it('a wide meal band drops to the full review', () => {
    expect(isQuickEligible(scanResult({ mealBandHalfPct: 0.2 }))).toBe(false)
    expect(isQuickEligible(scanResult({ mealBandHalfPct: QUICK_MAX_MEAL_BAND }))).toBe(true)
  })

  it('an empty ingredient list has nothing to log quickly', () => {
    expect(isQuickEligible(scanResult({ rows: [] }))).toBe(false)
  })
})
