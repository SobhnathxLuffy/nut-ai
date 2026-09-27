import type { DbAdapter } from '@nutai/db-adapter'
import type { NutritionSource, SourceResolvedFood, SourceCandidate, SourceLicenseInfo } from './types.js'

export class DishKBSource implements NutritionSource {
  readonly id = 'indian_dish_kb'
  // P0-2: 75 — ABOVE the generic corpora (USDA 70, OFF 60), BELOW IFCT (80).
  // At 65 the KB sat under USDA, so any USDA row sharing one FTS token with a
  // dish name ("Bread, chapati or roti, commercially prepared", "Groundcherries,
  // (cape-gooseberries or poha)") ended the source cascade and shadowed the
  // CURATED dish identity entirely. IFCT stays first so ingredient queries
  // ("paneer", "rice", "toor") keep resolving to ingredient rows.
  readonly priority = 75

  constructor(
    private readonly db: DbAdapter,
    private readonly ifctDb?: DbAdapter,
  ) {}

  /**
   * True when the artifact this adapter opens actually carries the dish KB.
   * Fixture databases and pre-P0-6 builds have no dish tables — the source
   * must yield nothing there, not throw (P0-2 follow-up: at priority 75 this
   * source is consulted BEFORE USDA, so a throw on a KB-less fixture would
   * break every fixture-backed resolver/pipeline path).
   */
  private kbPresent?: Promise<boolean>

  private kbReady(): Promise<boolean> {
    this.kbPresent ??= (async () => {
      try {
        const row = await this.db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dish_definitions'",
        )
        return row !== null
      } catch {
        return false
      }
    })()
    return this.kbPresent
  }

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
    if (!(await this.kbReady())) return []
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
    if (!(await this.kbReady())) return null
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
