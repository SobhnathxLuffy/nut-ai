import type { DbAdapter } from '@nutai/db-adapter'
import { parseSourceFoodId, searchTerms, type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'
import { computeRecipeServing } from '@nutai/recipe-engine'

export class RecipeSource implements NutritionSource {
  public readonly id = 'recipe'
  public readonly priority = 90 // Right below UserFood (100)

  constructor(private db: DbAdapter) {}

  async search(query: string): Promise<SourceCandidate[]> {
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    const rows = await this.db.all<any>(
      `SELECT id, uuid, name
       FROM recipes
       WHERE deleted_at IS NULL AND ${terms.map(() => 'name LIKE ?').join(' AND ')}
       LIMIT 20`,
      terms.map((term) => `%${term}%`)
    )

    // For recipes, we need to return candidates.
    // To get macro info, we might need to compute the serving, but for search results, we can just return the name.
    return rows.map((r: any) => ({
      foodId: `recipe:${r.uuid}`,
      source: this.id,
      name: r.name,
      brand: null,
      category: 'Household Recipe',
      prepFacet: null,
      basisConfidence: 'high',
      servingSizeG: null,
      energyKcal: null,
      popularityRank: 90,
      completenessScore: 100,
      rawBm25: -10
    }))
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    const uuid = parseSourceFoodId(foodId, this.id)
    if (uuid == null) return null

    // Fetch recipe
    const recipe = await this.db.get<any>('SELECT id, name FROM recipes WHERE uuid = ? AND deleted_at IS NULL', [uuid])
    if (!recipe) return null

    // Fetch latest version
    const versionRow = await this.db.get<any>(
      'SELECT id, version_number, preparation, added_oil_g, added_water_g, final_cooked_weight_g, servings FROM recipe_versions WHERE recipe_id = ? AND deleted_at IS NULL ORDER BY version_number DESC LIMIT 1',
      [recipe.id]
    )
    if (!versionRow) return null

    // Fetch components
    const components = await this.db.all<any>(
      `SELECT food_id, gram_weight, snap_energy_kcal, snap_protein_g, snap_fat_g,
              snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg
       FROM recipe_components WHERE recipe_version_id = ? AND deleted_at IS NULL`,
      [versionRow.id]
    )

    const serving = computeRecipeServing({
      preparation: versionRow.preparation as any,
      addedOilG: versionRow.added_oil_g,
      addedWaterG: versionRow.added_water_g,
      finalCookedWeightG: versionRow.final_cooked_weight_g,
      servings: versionRow.servings,
      ingredients: components.map((c: any) => ({
        foodId: c.food_id,
        gramWeight: c.gram_weight,
        energyKcal: c.snap_energy_kcal,
        proteinG: c.snap_protein_g,
        fatG: c.snap_fat_g,
        carbG: c.snap_carb_g,
        fiberG: c.snap_fiber_g,
        sugarG: c.snap_sugar_g,
        sodiumMg: c.snap_sodium_mg
      }))
    })

    return {
      foodId,
      sourceId: uuid,
      sourceVersion: String(versionRow.version_number),
      attribution: 'User-created household recipe',
      name: recipe.name,
      brand: null,
      energyKcal: serving.energyKcal,
      proteinG: serving.proteinG,
      fatG: serving.fatG,
      carbG: serving.carbG,
      fiberG: serving.fiberG,
      sugarG: serving.sugarG,
      sodiumMg: serving.sodiumMg,
      servingSizeG: serving.servingSizeG,
      servingDesc: `1 serving (1/${versionRow.servings} of recipe)`,
      license: 'User Content',
      source: 'recipe'
    }
  }

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Household Recipes',
      version: null,
      attribution: 'User Created',
      license: 'Private',
      redistributionPermitted: false
    }
  }
}
