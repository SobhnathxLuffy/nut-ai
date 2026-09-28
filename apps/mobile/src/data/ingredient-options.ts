import type { DbAdapter } from '@nutai/db-adapter'
import { IFCTSource, USDASource, UserFoodSource } from '@nutai/nutrition-sources'
import { toMatchExpression } from '@nutai/resolver'
import { createCustomFood, type CustomFood } from './custom-foods'

export interface IngredientOption {
  foodId: string
  label: string
  source: 'userfood' | 'ifct' | 'usda'
  kcalPer100g: number | null
}

/**
 * Search every ingredient source the decomposer can cook with: the user's own
 * custom foods first, then IFCT 2017, then USDA FDC. Multi-source — the same
 * dish ingredient may exist in two corpora with different granularities, and
 * the picker should say which database each row came from instead of silently
 * hiding one of them.
 */
export async function searchIngredientOptions(
  nutritionDb: DbAdapter,
  ifctDb: DbAdapter | undefined,
  userDb: DbAdapter | undefined,
  term: string,
): Promise<IngredientOption[]> {
  const expression = toMatchExpression(term)
  if (!expression) return []

  const perSourceCohorts = await Promise.all([
    (async (): Promise<IngredientOption[]> => {
      if (!userDb) return []
      const rows = await new UserFoodSource(userDb).search(expression).catch(() => [])
      return rows.map((r) => ({
        foodId: r.foodId,
        label: r.name,
        source: 'userfood' as const,
        kcalPer100g: r.energyKcal ?? null,
      }))
    })(),
    (async (): Promise<IngredientOption[]> => {
      if (!ifctDb) return []
      const rows = await new IFCTSource(ifctDb).search(expression).catch(() => [])
      return rows.map((r) => ({
        foodId: r.foodId,
        label: r.name,
        source: 'ifct' as const,
        kcalPer100g: r.energyKcal ?? null,
      }))
    })(),
    (async (): Promise<IngredientOption[]> => {
      const rows = await new USDASource(nutritionDb).search(expression).catch(() => [])
      return rows.map((r) => ({
        foodId: r.foodId,
        label: r.name,
        source: 'usda' as const,
        kcalPer100g: r.energyKcal ?? null,
      }))
    })(),
  ])

  const seen = new Set<string>()
  const out: IngredientOption[] = []
  // Cap per cohort so one 7,928-row corpus cannot drown the others; user rows
  // come first because they are the user's own reviewed ingredients.
  for (const cohort of perSourceCohorts) {
    for (const option of cohort.slice(0, 6)) {
      if (seen.has(option.foodId)) continue
      seen.add(option.foodId)
      out.push(option)
    }
  }
  return out
}

export interface NewIngredientInput {
  name: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g?: number | null
}

/**
 * Create a custom ingredient on a per-100 g basis. It lands in `user_foods`,
 * which the food search and the ingredient pickers both query — so an
 * ingredient that neither IFCT nor USDA knows becomes a first-class,
 * searchable citizen the moment it is saved.
 */
export async function createIngredientFood(
  userDb: DbAdapter,
  input: NewIngredientInput,
  now: number,
): Promise<CustomFood> {
  return createCustomFood(userDb, {
    name: input.name,
    servingAmount: 100,
    servingUnit: 'g',
    calories: input.kcal,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    fiber_g: input.fiber_g ?? null,
  }, now)
}
