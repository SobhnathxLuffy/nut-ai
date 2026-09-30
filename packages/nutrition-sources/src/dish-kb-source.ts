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

  /**
   * Memoized deterministic resolutions. Search and resolveById both need the
   * computed per-100 g numbers for CURATED/VERIFIED dishes; computeDishNutrition
   * is a handful of SQL lookups per slot, but a search can surface up to 10
   * dish rows per keystroke — cache the promise so each dish computes once per
   * adapter instance.
   */
  private resolvedCache = new Map<string, Promise<SourceResolvedFood | null>>()

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

    return Promise.all(rows.map(async (r) => {
      // Priority: Verified KB > Curated (DRAFT_CURATED)
      const deterministic = r.record_status === 'VERIFIED' || r.record_status === 'CURATED'
      const priority = r.record_status === 'VERIFIED' ? 70 : deterministic ? 60 : 25
      // A CURATED dish can show its deterministic per-100 g number right in
      // the search row — the same computation resolveById performs. Draft
      // rows stay energyless and low-confidence on purpose.
      const resolved = deterministic ? await this.resolveById(r.foodId).catch(() => null) : null
      // Task 2-c: deterministic rows now also expose the curated portion range
      // to the scorer — portionPlausibility is one of the six signals, and a
      // CURATED dish row that knows "one piece is 60-100 g" must not compete
      // with a generic USDA row at equal plausibility blindness.
      const hint = resolved?.portionHints?.[0]
      return {
        foodId: r.foodId,
        source: this.id,
        sourcePriority: priority,
        name: r.name,
        brand: null,
        category: r.category,
        prepFacet: null,
        basisConfidence: deterministic ? 'high' : 'low',
        servingSizeG: resolved?.servingSizeG ?? null,
        energyKcal: resolved?.energyKcal ?? null, // Draft rows: computed downstream or never.
        popularityRank: 100,
        completenessScore: deterministic ? 1.0 : 0,
        typicalGramsMin: hint?.min ?? null,
        typicalGramsMax: hint?.max ?? null,
        rawBm25: r.rawBm25,
      }
    }))
  }

  async resolveById(id: string): Promise<SourceResolvedFood | null> {
    const cached = this.resolvedCache.get(id)
    if (cached) return cached
    const promise = this.resolveByIdUncached(id)
    this.resolvedCache.set(id, promise)
    return promise
  }

  private async resolveByIdUncached(id: string): Promise<SourceResolvedFood | null> {
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
    } as any // eslint-disable-line no-restricted-syntax -- corpus read boundary: manifest fields are plain sqlite values

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

    // Task 2-c: carry the dish's curated portion model onto the resolved food.
    // This is the FIRST-WIRE point of the portionHints seam — the resolver
    // exposes it as ResolvedFood.portionHints, the pipeline spreads it into the
    // gram engine's ResolvedRow, and tier 1.5 (population prior) consumes it.
    // The dynamic import keeps @nutai/indian-dishes lazy, matching the
    // computeDishNutrition import above.
    let portionHints: SourceResolvedFood['portionHints'] = undefined
    try {
      const { portionHintsForDish } = await import('@nutai/indian-dishes')
      portionHints = portionHintsForDish({
        canonicalName: row.canonical_name,
        portionModel: dish.portionModel,
      })
    } catch {
      portionHints = undefined // The KB number stands on its own; hints are additive.
    }

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
      ...(portionHints?.length ? { portionHints } : {}),
      license: 'proprietary',
      source: this.id
    }
  }
}
