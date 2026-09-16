import type { DbAdapter } from '@nutai/db-adapter'
import type { NutritionSource, SourceResolvedFood, SourceCandidate, SourceLicenseInfo } from './types.js'

export class DishKBSource implements NutritionSource {
  readonly id = 'indian_dish_kb'
  readonly priority = 65

  constructor(
    private readonly db: DbAdapter,
    private readonly ifctDb?: DbAdapter,
  ) {}

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Nut AI Dish KB',
      version: 'v0.1',
      attribution: 'Nut AI Indian Dish Knowledge Base',
      license: 'proprietary',
      redistributionPermitted: false
    }
  }

  async search(ftsExpression: string): Promise<SourceCandidate[]> {
    const rows = await this.db.all<any>(`
      SELECT
        d.id as foodId,
        d.canonical_name as name,
        d.category,
        d.record_status,
        fts.rank as rawBm25
      FROM dish_fts fts
      JOIN dish_definitions d ON d.search_rowid = fts.rowid
      WHERE dish_fts MATCH ?
      ORDER BY rawBm25
      LIMIT 10
    `, [ftsExpression])

    return rows.map((r) => {
      // Priority: Verified KB > Curated (DRAFT_CURATED)
      const deterministic = r.record_status === 'VERIFIED' || r.record_status === 'CURATED'
      const priority = r.record_status === 'VERIFIED' ? 70 : deterministic ? 60 : 25
      return {
        foodId: r.foodId,
        source: this.id,
        sourcePriority: priority,
        name: r.name,
        brand: null,
        category: r.category,
        prepFacet: null,
        basisConfidence: deterministic ? 'high' : 'low',
        servingSizeG: null,
        energyKcal: null, // Computation done downstream
        popularityRank: 100,
        completenessScore: deterministic ? 1.0 : 0,
        rawBm25: r.rawBm25,
      }
    })
  }

  async resolveById(id: string): Promise<SourceResolvedFood | null> {
    const row = await this.db.get<any>(
      'SELECT * FROM dish_definitions WHERE id = ?',
      [id]
    )
    if (!row) return null

    const dish = {
      id: row.id,
      canonicalName: row.canonical_name,
      category: row.category,
      family: row.family,
      cooking: {
        methods: JSON.parse(row.cooking_methods_json || '[]'),
        yieldModel: JSON.parse(row.yield_model_json || '{}')
      },
      recipeTemplate: JSON.parse(row.recipe_template_json || '{}'),
      portionModel: JSON.parse(row.portion_model_json || '{}'),
      uncertaintyModel: JSON.parse(row.uncertainty_model_json || '{}'),
      resolver: JSON.parse(row.resolver_config_json || '{}'),
      provenance: { recordStatus: row.record_status }
    } as any

    // Draft records are searchable for coverage/review, but are never presented
    // as deterministic nutrition merely because an ID exists.
    if (row.record_status !== 'CURATED' && row.record_status !== 'VERIFIED') return null

    let calculated
    try {
      const { computeDishNutrition } = await import('@nutai/indian-dishes')
      calculated = await computeDishNutrition({
        dish,
        nutritionDb: this.db,
        ...(this.ifctDb ? { ifctDb: this.ifctDb } : {}),
        servings: 1,
      })
    } catch {
      return null
    }

    // Normalizing to per-100g because standard resolved foods are per 100g.
    const multiplier = 100 / (calculated.servingSizeG || 100)

    return {
      foodId: row.id,
      sourceId: row.id,
      sourceVersion: 'v0.1',
      attribution: 'Nut AI Dish KB',
      name: row.canonical_name,
      brand: null,
      energyKcal: calculated.energyKcal === null ? null : calculated.energyKcal * multiplier,
      proteinG: calculated.proteinG === null ? null : calculated.proteinG * multiplier,
      fatG: calculated.fatG === null ? null : calculated.fatG * multiplier,
      carbG: calculated.carbG === null ? null : calculated.carbG * multiplier,
      fiberG: calculated.fiberG === null ? null : calculated.fiberG * multiplier,
      sugarG: calculated.sugarG === null ? null : calculated.sugarG * multiplier,
      sodiumMg: calculated.sodiumMg === null ? null : calculated.sodiumMg * multiplier,
      servingSizeG: calculated.servingSizeG || 100,
      servingDesc: `${calculated.servingSizeG || 100}g standard portion`,
      license: 'proprietary',
      source: this.id
    }
  }
}
