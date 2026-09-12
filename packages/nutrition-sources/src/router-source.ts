import { type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'

export class RouterSource implements NutritionSource {
  public readonly id = 'router'
  public readonly priority = 0
  private sources: NutritionSource[]

  constructor(sources: NutritionSource[]) {
    // Sort sources by priority descending
    this.sources = [...sources].sort((a, b) => b.priority - a.priority)
  }

  async search(query: string): Promise<SourceCandidate[]> {
    // Source priority is a cascade, not a weak scoring hint. A generic USDA row
    // must not displace a matching household recipe or IFCT row merely because
    // FTS scores from two independent corpora happen to have different scales.
    for (const source of this.sources) {
      const candidates = await source.search(query).catch(() => [] as SourceCandidate[])
      if (candidates.length > 0) {
        return candidates.map((candidate) => ({ ...candidate, sourcePriority: source.priority }))
      }
    }
    return []
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
