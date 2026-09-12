import type { DbAdapter } from '@nutai/db-adapter'
import {
  parseSourceFoodId,
  sourceFoodId,
  type NutritionSource,
  type SourceCandidate,
  type SourceLicenseInfo,
  type SourceResolvedFood,
} from './types.js'

const CANDIDATE_SQL = `
SELECT COALESCE(f.source_id, CAST(f.id AS TEXT)) AS foodId,
       f.name          AS name,
       b.canonical_name AS brand,
       f.category      AS category,
       f.prep_facet    AS prepFacet,
       f.basis_confidence AS basisConfidence,
       f.serving_size_g   AS servingSizeG,
       f.energy_kcal      AS energyKcal,
       f.popularity_rank  AS popularityRank,
       f.completeness_score AS completenessScore,
       bm25(food_fts, 10.0, 8.0, 4.0) AS rawBm25
FROM food_fts
JOIN foods f ON f.id = food_fts.rowid
LEFT JOIN brands b ON b.id = f.brand_id
WHERE food_fts MATCH ? AND f.source LIKE 'fdc_%'
ORDER BY rawBm25
LIMIT 50
`

const FOOD_BY_ID_SQL = `
SELECT COALESCE(f.source_id, CAST(f.id AS TEXT)) AS foodId, f.name AS name, b.canonical_name AS brand,
       f.energy_kcal AS energyKcal, f.protein_g AS proteinG, f.fat_g AS fatG,
       f.carb_g AS carbG, f.fiber_g AS fiberG, f.sugar_g AS sugarG,
       f.sodium_mg AS sodiumMg, f.serving_size_g AS servingSizeG,
       f.serving_desc AS servingDesc, f.license AS license, f.source AS source
FROM foods f
LEFT JOIN brands b ON b.id = f.brand_id
WHERE (f.source_id = ? OR (f.source_id IS NULL AND CAST(f.id AS TEXT) = ?)) AND f.source LIKE 'fdc_%'
`

function toResolvedFood(
  row: (Omit<SourceResolvedFood, 'foodId' | 'sourceId' | 'source'> & { foodId: string; source: string }) | null,
): SourceResolvedFood | null {
  if (row == null) return null
  return {
    ...row,
    foodId: sourceFoodId('usda', row.foodId),
    sourceId: String(row.foodId),
    sourceVersion: 'bundled FoodData Central release',
    attribution: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
    source: 'usda',
  }
}

export class USDASource implements NutritionSource {
  readonly id = 'usda'
  readonly priority = 70

  constructor(private readonly db: DbAdapter) {}

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'USDA FoodData Central',
      version: 'bundled FoodData Central release',
      attribution: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
      license: 'Public domain (U.S. Government work)',
      redistributionPermitted: true,
    }
  }

  async search(query: string): Promise<SourceCandidate[]> {
    const rows = await this.db.all<Omit<SourceCandidate, 'foodId'> & { foodId: string }>(CANDIDATE_SQL, [query])
    return rows.map((r) => ({ ...r, foodId: sourceFoodId(this.id, r.foodId), source: this.id }))
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    const sourceId = parseSourceFoodId(foodId, this.id)
    if (sourceId == null) return null
    const row = await this.db.get<Omit<SourceResolvedFood, 'foodId' | 'sourceId'> & { foodId: string }>(
      FOOD_BY_ID_SQL,
      [sourceId, sourceId],
    )
    return toResolvedFood(row)
  }

  async resolveByBarcode(barcode: string): Promise<SourceResolvedFood | null> {
    const unpadded = barcode.replace(/^0+/, '')
    const sql = FOOD_BY_ID_SQL.replace(
      "WHERE (f.source_id = ? OR (f.source_id IS NULL AND CAST(f.id AS TEXT) = ?)) AND f.source LIKE 'fdc_%'",
      "WHERE (f.barcode = ? OR f.barcode = ?) AND f.source LIKE 'fdc_%'",
    )
    const row = await this.db.get<Omit<SourceResolvedFood, 'foodId' | 'sourceId'> & { foodId: string }>(sql, [barcode, unpadded])
    return toResolvedFood(row)
  }
}
