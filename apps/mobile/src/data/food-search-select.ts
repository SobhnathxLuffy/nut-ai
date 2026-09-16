import type { DbAdapter } from '@nutai/db-adapter'
import type { ResolvedFood, ScoredCandidate } from '@nutai/resolver'
import type { ManualFoodSelection } from './manual-food'

/**
 * What "select this candidate" means, computed from the (read-only) nutrition
 * corpus alone. ZERO React Native imports, deliberately — same reasoning as
 * backup-core.ts and manual-food.ts — so it is testable under bare Node.
 * food-search.tsx's `onPress` calls this (via `selectFood` in that file,
 * which additionally reaches for the live user-db singleton and so is not
 * itself unit-testable here) for every tap on a result row.
 */

interface FoodRow {
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

interface PortionRow {
  gram_weight: number
}

export async function resolveSelection(
  nutritionDb: DbAdapter,
  candidate: ScoredCandidate,
  resolved?: ResolvedFood,
): Promise<ManualFoodSelection> {
  const source = resolved?.source ?? 'usda'
  const sourceId = resolved?.sourceId ?? candidate.foodId.replace(/^usda:/, '')
  const usdaRecordId = source === 'usda' && /^\d+$/.test(sourceId)
    ? Number(sourceId)
    : null

  const [foodRecord, defaultPortion, anyPortion] = await Promise.all([
    usdaRecordId == null ? Promise.resolve(null) : nutritionDb.get<FoodRow>(
      "SELECT protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg FROM foods WHERE source_id = ? AND source LIKE 'fdc_%'", [sourceId],
    ),
    usdaRecordId == null ? Promise.resolve(null) : nutritionDb.get<PortionRow>(
      "SELECT p.gram_weight FROM food_portions p JOIN foods f ON f.id = p.food_id WHERE f.source_id = ? AND f.source LIKE 'fdc_%' AND p.is_fndds_default = 1 LIMIT 1", [sourceId],
    ),
    usdaRecordId == null ? Promise.resolve(null) : nutritionDb.get<PortionRow>(
      "SELECT p.gram_weight FROM food_portions p JOIN foods f ON f.id = p.food_id WHERE f.source_id = ? AND f.source LIKE 'fdc_%' ORDER BY p.id LIMIT 1", [sourceId],
    ),
  ])

  const kcal = resolved?.energyKcal ?? candidate.energyKcal
  const protein = resolved?.proteinG ?? foodRecord?.protein_g
  const fat = resolved?.fatG ?? foodRecord?.fat_g
  const carbs = resolved?.carbG ?? foodRecord?.carb_g
  if (kcal == null || protein == null || fat == null || carbs == null) {
    throw new Error('Core nutrition is unavailable for this food')
  }

  return {
    foodId: /^\d+$/.test(sourceId) ? Number(sourceId) : null,
    matchedFoodSource: source,
    displayName: candidate.name,
    // Serving size from resolved dish/food first, FNDDS default portion second,
    // any recorded portion third, and only then flat 100 g.
    grams: resolved?.servingSizeG ?? defaultPortion?.gram_weight ?? anyPortion?.gram_weight ?? 100,
    nutrientSnapshot: {
      kcal,
      protein_g: protein,
      fat_g: fat,
      carbs_g: carbs,
      fiber_g: resolved?.fiberG ?? foodRecord?.fiber_g ?? null,
      sugar_g: resolved?.sugarG ?? foodRecord?.sugar_g ?? null,
      sodium_mg: resolved?.sodiumMg ?? foodRecord?.sodium_mg ?? null,
    },
  }
}
