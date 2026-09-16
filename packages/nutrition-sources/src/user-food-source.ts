import type { DbAdapter } from '@nutai/db-adapter'
import { parseSourceFoodId, searchTerms, type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'

export class UserFoodSource implements NutritionSource {
  public readonly id = 'userfood'
  public readonly priority = 100 // Highest priority

  constructor(private db: DbAdapter) {}

  async search(query: string): Promise<SourceCandidate[]> {
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    // A simple LIKE search since user_foods is small
    const rows = await this.db.all<any>(
      `SELECT uuid, name, brand, barcode, energy_kcal, serving_size_g
       FROM user_foods
       WHERE deleted_at IS NULL AND ${terms.map(() => '(name LIKE ? OR brand LIKE ?)').join(' AND ')}
       LIMIT 20`,
      terms.flatMap((term) => [`%${term}%`, `%${term}%`])
    )

    return rows.map((r: any) => ({
      foodId: `userfood:${r.uuid}`,
      source: this.id,
      name: r.name,
      brand: r.brand,
      category: null,
      prepFacet: null,
      basisConfidence: 'high',
      servingSizeG: r.serving_size_g,
      energyKcal: r.energy_kcal,
      popularityRank: 100, // User foods are highly relevant
      completenessScore: 100,
      rawBm25: -10
    }))
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    const sourceId = parseSourceFoodId(foodId, this.id)
    if (sourceId == null) return null
    const r = await this.db.get<any>('SELECT * FROM user_foods WHERE uuid = ? AND deleted_at IS NULL', [sourceId])
    if (!r) return null

    return {
      foodId,
      sourceId,
      sourceVersion: null,
      attribution: 'User created food',
      name: r.name,
      brand: r.brand,
      energyKcal: r.energy_kcal,
      proteinG: r.protein_g,
      fatG: r.fat_g,
      carbG: r.carb_g,
      fiberG: r.fiber_g,
      sugarG: r.sugar_g,
      sodiumMg: r.sodium_mg,
      servingSizeG: r.serving_size_g,
      servingDesc:
        r.serving_amount != null && r.serving_unit
          ? `${r.serving_amount} ${r.serving_unit}`
          : r.serving_size_g != null
            ? `${r.serving_size_g} g`
            : null,
      license: 'User Content',
      source: 'userfood'
    }
  }

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'User Foods',
      version: null,
      attribution: 'User Created',
      license: 'Private',
      redistributionPermitted: false
    }
  }
}
