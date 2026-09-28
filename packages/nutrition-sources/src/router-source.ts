import { type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'

/**
 * Upper bound on rows a single corpus may contribute to a merged search.
 *
 * Multi-source search (QA product round): a query must be able to surface
 * matches from MORE than one database — an IFCT row and its USDA counterpart
 * belong on the same screen. Each corpus still ranks by its own BM25 (scores
 * from independent FTS tables are not comparable across corpora), so the merge
 * is priority-grouped: higher-priority sources contribute their best rows
 * first, and a per-source cap keeps one large corpus from drowning the rest.
 */
const MAX_ROWS_PER_SOURCE = 15

export class RouterSource implements NutritionSource {
  public readonly id = 'router'
  public readonly priority = 0
  private sources: NutritionSource[]

  constructor(sources: NutritionSource[]) {
    // Sort sources by priority descending
    this.sources = [...sources].sort((a, b) => b.priority - a.priority)
  }

  async search(query: string): Promise<SourceCandidate[]> {
    // Fan out to EVERY source, not just the first one that matches. The old
    // cascade ended at the highest-priority corpus with any hit, which meant a
    // search could only ever show rows from a single database (user report:
    // "only USDA or only IFCT comes back"). BM25 remains per-corpus — the
    // merge is by source priority, and scoring normalizes BM25 within each
    // source cohort (see normalizeBm25) — so cross-corpus scale differences
    // still cannot displace a matching household recipe, dish-KB identity, or
    // IFCT row with a generic USDA row.
    const settled = await Promise.all(
      this.sources.map(async (source) => ({
        source,
        rows: await source.search(query).catch(() => [] as SourceCandidate[]),
      })),
    )

    const merged: SourceCandidate[] = []
    for (const { source, rows } of settled) {
      for (const row of rows.slice(0, MAX_ROWS_PER_SOURCE)) {
        // A row-level priority (the dish KB grades VERIFIED/CURATED/DRAFT
        // rows individually) must never drag the row below its source's
        // class-level tier — the dish KB outranks USDA as a SOURCE even when
        // one of its rows carries a lower per-row grade.
        merged.push({ ...row, sourcePriority: Math.max(row.sourcePriority ?? 0, source.priority) })
      }
    }
    return merged
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    for (const source of this.sources) {
      const res = await source.resolveById(foodId)
      if (res) return res
    }
    return null
  }

  async resolveByBarcode(barcode: string): Promise<SourceResolvedFood | null> {
    for (const source of this.sources) {
      if (source.resolveByBarcode) {
        const res = await source.resolveByBarcode(barcode)
        if (res) return res
      }
    }
    return null
  }

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Router Source',
      version: null,
      attribution: 'Multiple Sources',
      license: 'Mixed',
      redistributionPermitted: false
    }
  }
}
