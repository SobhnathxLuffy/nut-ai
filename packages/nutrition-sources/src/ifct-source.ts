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
SELECT f.source_id     AS foodId,
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
WHERE food_fts MATCH ? AND f.source = 'ifct'
ORDER BY rawBm25
LIMIT 50
`

const FOOD_BY_ID_SQL = `
SELECT f.source_id AS foodId, f.name AS name, b.canonical_name AS brand,
       f.energy_kcal AS energyKcal, f.protein_g AS proteinG, f.fat_g AS fatG,
       f.carb_g AS carbG, f.fiber_g AS fiberG, f.sugar_g AS sugarG,
       f.sodium_mg AS sodiumMg, f.serving_size_g AS servingSizeG,
       f.serving_desc AS servingDesc, f.license AS license, f.source AS source
FROM foods f
LEFT JOIN brands b ON b.id = f.brand_id
WHERE f.source_id = ? AND f.source = 'ifct'
`

function toResolvedFood(
  row: (Omit<SourceResolvedFood, 'foodId' | 'sourceId' | 'source'> & { foodId: string; source: string }) | null,
): SourceResolvedFood | null {
  if (row == null) return null
  return {
    ...row,
    foodId: sourceFoodId('ifct', row.foodId),
    sourceId: String(row.foodId),
    sourceVersion: '2017',
    attribution: 'T. Longvah et al., Indian Food Composition Tables, ICMR-NIN, 2017.',
    source: 'ifct',
  }
}

export class IFCTSource implements NutritionSource {
  readonly id = 'ifct'
  readonly priority = 80

  constructor(private readonly db: DbAdapter) {}

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Indian Food Composition Tables (IFCT) 2017',
      version: '2017',
      attribution: 'National Institute of Nutrition (ICMR-NIN), Hyderabad. Used with permission.',
      license: 'Used with permission (ICMR-NIN)',
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
    const row = await this.db.get<Omit<SourceResolvedFood, 'foodId' | 'sourceId'> & { foodId: string }>(FOOD_BY_ID_SQL, [sourceId])
    return toResolvedFood(row)
  }
}
