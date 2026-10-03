import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeRecipeServing } from '@nutai/recipe-engine'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { createRecipe, listRecipes, type RecipeDraft } from './recipes'
import {
  formatIngredientContribution,
  ingredientContributions,
  sumIngredientContributions,
} from './recipes-contributions'

/**
 * Wave 5A (item O3, AGENTS.md §0.2): per-ingredient contributed macros.
 *
 * The contract under test: contributions use the recipe engine's own factor
 * math (per-100g × grams/100) and serving multiplier, so they sit in the same
 * one-serving frame as the totals the recipes screen displays — the sum of the
 * captions plus the oil share reconciles with `computeRecipeServing` (locked
 * here against the engine, never re-derived). Missing macros null-propagate
 * exactly like the engine's totals ("unknown is not zero", AGENTS.md §5.2).
 */

const NOW = 1_760_000_000_000

// Same shape as recipes.test.ts's DAL, so the 215.1 kcal serving number this
// file reconciles against is the one the repository test already locks.
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

const MULTI: RecipeDraft = {
  name: 'Khichdi',
  preparation: 'boiled',
  addedOilG: 14,
  addedWaterG: 400,
  finalCookedWeightG: 610,
  servings: 3,
  ingredients: [
    { foodId: 'ifct:A015', displayName: 'White rice, raw', gramWeight: 150, energyKcal: 346, proteinG: 6.8, fatG: 0.6, carbG: 76.2, fiberG: 1.2, sugarG: 0.1, sodiumMg: 5 },
    { foodId: 'ifct:B021', displayName: 'Toor dal', gramWeight: 80.5, energyKcal: 335, proteinG: 22.3, fatG: 1.4, carbG: 57.5, fiberG: 15.0, sugarG: null, sodiumMg: 20 },
    { foodId: 'ifct:F006', displayName: 'Potato', gramWeight: 120, energyKcal: 87, proteinG: 1.7, fatG: 0.1, carbG: 20.1, fiberG: 2.2, sugarG: 0.8, sodiumMg: 6 },
  ],
}

/** The engine's per-serving totals for the oil-free variant of a recipe. */
const noOil = (recipe: RecipeDraft): ReturnType<typeof computeRecipeServing> =>
  computeRecipeServing({ ...recipe, addedOilG: 0 })

describe('ingredientContributions math', () => {
  it('derives each contribution with the engine factor math, in the one-serving frame (locked fixture)', () => {
    // 340 kcal/100g × 100 g = 340 batch kcal; × (300/2)/300 = 0.5 → 170 per serving.
    // The 215.1 kcal serving total this reconciles with is locked by recipes.test.ts.
    expect(ingredientContributions(DAL)).toEqual([
      { id: 'ifct:B013', name: 'Lentil dal', grams: 100, kcal: 170, protein: 11, carbs: 30, fat: 0.5 },
    ])
  })

  it('sums to the engine totals for oil-free recipes, macro by macro (arithmetic-consistency proof)', () => {
    for (const recipe of [DAL, MULTI, { ...MULTI, addedOilG: 0, servings: 1 }]) {
      const totals = noOil(recipe)
      const sum = sumIngredientContributions(ingredientContributions(recipe))
      expect(sum.kcal).toBeCloseTo(totals.energyKcal ?? Number.NaN, 10)
      expect(sum.protein).toBeCloseTo(totals.proteinG ?? Number.NaN, 10)
      expect(sum.carbs).toBeCloseTo(totals.carbG ?? Number.NaN, 10)
      expect(sum.fat).toBeCloseTo(totals.fatG ?? Number.NaN, 10)
    }
  })

  it('sums to the displayed per-serving totals once the engine-derived oil share is added', () => {
    // The oil share is MEASURED from the engine (totals(oil) − totals(no oil)),
    // never re-derived here — the 9.02 kcal/g constant stays single-sourced in
    // @nutai/recipe-engine.
    for (const recipe of [DAL, MULTI]) {
      const withOil = computeRecipeServing(recipe)
      const withoutOil = noOil(recipe)
      const sum = sumIngredientContributions(ingredientContributions(recipe))
      expect((sum.kcal ?? 0) + (withOil.energyKcal! - withoutOil.energyKcal!)).toBeCloseTo(withOil.energyKcal!, 10)
      expect((sum.protein ?? 0) + (withOil.proteinG! - withoutOil.proteinG!)).toBeCloseTo(withOil.proteinG!, 10)
      expect((sum.carbs ?? 0) + (withOil.carbG! - withoutOil.carbG!)).toBeCloseTo(withOil.carbG!, 10)
      expect((sum.fat ?? 0) + (withOil.fatG! - withoutOil.fatG!)).toBeCloseTo(withOil.fatG!, 10)
    }
  })

  it('rounded captions reconcile with the rounded serving totals the list row displays (DAL: exact)', () => {
    // DAL: round(170) + round(45.1) = 170 + 45 = 215 = round(215.1).
    const sum = sumIngredientContributions(ingredientContributions(DAL))
    const oilKcal = computeRecipeServing(DAL).energyKcal! - noOil(DAL).energyKcal!
    expect(Math.round(sum.kcal!) + Math.round(oilKcal)).toBe(Math.round(computeRecipeServing(DAL).energyKcal!))
  })

  it('keeps the whole-batch frame when the draft is not saveable yet (editor intermediate states)', () => {
    // Blank/zero yield: the multiplier is still 1/servings (yield cancels).
    expect(ingredientContributions({ ...DAL, finalCookedWeightG: 0 })[0]!.kcal).toBeCloseTo(170, 10)
    // Blank/zero servings: whole-recipe frame (raw per-100g × grams/100) — the
    // caption never throws on an intermediate draft (AGENTS.md §8.3).
    expect(ingredientContributions({ ...DAL, servings: 0 })[0]!.kcal).toBeCloseTo(340, 10)
  })

  it('null macros null-propagate per ingredient and through the sum, mirroring the engine totals', () => {
    const recipe: RecipeDraft = {
      ...DAL,
      ingredients: [
        { ...DAL.ingredients[0]!, proteinG: null },
        { ...MULTI.ingredients[0]! },
      ],
    }
    const [first, second] = ingredientContributions(recipe)
    expect(first!.protein).toBeNull()
    expect(first!.kcal).toBeCloseTo(170, 10)
    expect(second!.protein).not.toBeNull()
    // One unknown ingredient nulls the aggregate for the whole recipe — the
    // sum mirrors computeRecipeServing instead of silently zeroing it.
    expect(sumIngredientContributions(ingredientContributions(recipe)).protein).toBeNull()
    expect(computeRecipeServing(recipe).proteinG).toBeNull()
    expect(computeRecipeServing(recipe).energyKcal).not.toBeNull()
  })

  it('zero grams contribute zero exactly, and cannot launder an unknown macro into zero', () => {
    const zeroGrams: RecipeDraft = { ...DAL, ingredients: [{ ...DAL.ingredients[0]!, gramWeight: 0 }] }
    expect(ingredientContributions(zeroGrams)[0]).toMatchObject({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
    // Removing a 0 g ingredient must not move the engine totals.
    expect(noOil(zeroGrams).energyKcal).toBeCloseTo(noOil({ ...zeroGrams, ingredients: [] }).energyKcal!, 10)
    // grams=0 + kcal unknown → unknown stays unknown (the engine's known-flag
    // does not exempt zero-gram ingredients).
    const unknown: RecipeDraft = { ...DAL, ingredients: [{ ...DAL.ingredients[0]!, gramWeight: 0, energyKcal: null }] }
    expect(ingredientContributions(unknown)[0]!.kcal).toBeNull()
    expect(computeRecipeServing(unknown).energyKcal).toBeNull()
  })

  it('an empty ingredient list sums to zero, matching the engine', () => {
    expect(sumIngredientContributions([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
    expect(ingredientContributions({ ...DAL, ingredients: [] })).toEqual([])
  })
})

describe('formatIngredientContribution (caption text shared by both render paths)', () => {
  it('formats known macros with the list-row rounding conventions', () => {
    expect(formatIngredientContribution(ingredientContributions(DAL)[0]!)).toBe('→ 170 kcal · 11.0g P · 30.0g C · 0.5g F')
    // kcal rounds like the recipe list row (Math.round); macros stay at one
    // decimal like the decomposer breakdown.
    const fractional = ingredientContributions(MULTI)[0]!
    expect(formatIngredientContribution(fractional)).toBe(`→ ${Math.round(fractional.kcal!)} kcal · ${fractional.protein!.toFixed(1)}g P · ${fractional.carbs!.toFixed(1)}g C · ${fractional.fat!.toFixed(1)}g F`)
  })

  it('degrades missing macros the way the decomposer breakdown does — never zero', () => {
    expect(formatIngredientContribution({ id: 'x', name: 'X', grams: 100, kcal: null, protein: 11, carbs: 30, fat: null }))
      .toBe('→ kcal unknown · 11.0g P · 30.0g C')
    expect(formatIngredientContribution({ id: 'x', name: 'X', grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 }))
      .toBe('→ 0 kcal · 0.0g P · 0.0g C · 0.0g F')
    expect(formatIngredientContribution({ id: 'x', name: 'X', grams: 50, kcal: null, protein: null, carbs: null, fat: null }))
      .toBe('→ kcal unknown')
  })
})

describe('listRecipes carries the contributions (snapshot → caption path)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)
  })

  it('serves per-ingredient contributions that reconcile with the row totals', async () => {
    await createRecipe(db, DAL, NOW)
    const [item] = await listRecipes(db)
    expect(item?.contributions).toEqual([
      { id: 'ifct:B013', name: 'Lentil dal', grams: 100, kcal: 170, protein: 11, carbs: 30, fat: 0.5 },
    ])
    const sum = sumIngredientContributions(item?.contributions ?? [])
    const withoutOil = computeRecipeServing({ ...DAL, addedOilG: 0 })
    // Σ captions + oil share = the 215.1 kcal the row displays (recipes.test.ts).
    expect((sum.kcal ?? 0) + ((item?.energyKcal ?? 0) - (withoutOil.energyKcal ?? 0))).toBeCloseTo(215.1, 10)
  })
})

// ---------------------------------------------------------------------------
// Source inspection: every ingredient row render path (editor + list) renders
// the contribution caption through the shared formatter, and the data layer
// feeds both from ingredientContributions — no hand-rolled per-100g math in
// the view. Same conventions as type-scale.test.ts's sweeps.

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string): string => readFileSync(join(APP_ROOT, rel), 'utf8')

describe('recipes.tsx render paths (source inspection)', () => {
  const screen = read('app/recipes.tsx')
  const data = read('src/data/recipes.ts')

  it('both the editor ingredient rows and the list rows render the contribution caption', () => {
    // Editor path: the live caption under each editable ingredient row.
    expect(screen).toMatch(/liveContributions\[index\]/)
    // List path: the read-only rows map the stored contributions.
    expect(screen).toMatch(/recipe\.contributions\.map\(/)
    // Both paths render through the ONE shared formatter.
    expect(screen.match(/formatIngredientContribution\(/g)?.length).toBeGreaterThanOrEqual(2)
    // The live editor caption is derived state from the form fields (no new inputs).
    expect(screen).toMatch(/useMemo\(\(\) => ingredientContributions\(/)
  })

  it('states the per-serving frame on both paths, mirroring the decomposer lead-in', () => {
    expect(screen).toContain('one serving')
    expect(screen).toContain('per serving')
  })

  it('uses the caption tier with tabular figures and the muted/faint text grades', () => {
    expect(screen).toMatch(/type\.caption,\s*styles\.contribution/)
    expect(screen).toMatch(/contribution:\s*\{\s*fontVariant:\s*\['tabular-nums'\]/)
    expect(screen).toMatch(/color: theme\.textMuted/)
    expect(screen).toMatch(/color: theme\.textFaint/)
  })

  it('feeds the view from the shared helper, not view-side arithmetic', () => {
    expect(screen).toContain("from '../src/data/recipes-contributions'")
    expect(data).toContain('contributions: ingredientContributions(recipe)')
    expect(data).not.toMatch(/\*\s*\(c\.grams\s*\/\s*100\)/)
  })
})
