export interface SourceLicenseInfo {
  readonly name: string
  readonly version: string | null
  readonly attribution: string
  readonly license: string
  readonly redistributionPermitted: boolean
  readonly odblShareAlike?: boolean
}

export interface SourceCandidate {
  readonly foodId: string
  /** Adapter identity. `foodId` is qualified with the same value. */
  readonly source: string
  /** Router priority, normalized by the resolver as a ranking tie-break. */
  readonly sourcePriority?: number
  readonly name: string
  readonly brand: string | null
  readonly category: string | null
  readonly prepFacet: string | null
  readonly basisConfidence: 'high' | 'low'
  readonly servingSizeG: number | null
  readonly energyKcal: number | null
  readonly popularityRank: number | null
  readonly completenessScore: number | null
  readonly rawBm25: number
  readonly brandFiltered?: boolean
  readonly typicalGramsMin?: number | null
  readonly typicalGramsMax?: number | null
}

export interface SourceResolvedFood {
  readonly foodId: string
  /** Stable identifier from the originating source, not a local SQLite row ID. */
  readonly sourceId: string
  readonly sourceVersion: string | null
  readonly attribution: string
  readonly name: string
  readonly brand: string | null
  readonly energyKcal: number | null
  readonly proteinG: number | null
  readonly fatG: number | null
  readonly carbG: number | null
  readonly fiberG: number | null
  readonly sugarG: number | null
  readonly sodiumMg: number | null
  readonly servingSizeG: number | null
  readonly servingDesc: string | null
  readonly license: string
  readonly source: string
}

export function sourceFoodId(source: string, sourceId: string | number): string {
  return `${source}:${String(sourceId)}`
}

export function parseSourceFoodId(
  foodId: string,
  expectedSource: string,
): string | null {
  const prefix = `${expectedSource}:`
  if (!foodId.startsWith(prefix)) return null
  const sourceId = foodId.slice(prefix.length)
  return sourceId.length > 0 ? sourceId : null
}

export interface NutritionSource {
  readonly id: string
  readonly priority: number
  search(query: string): Promise<SourceCandidate[]>
  resolveById(foodId: string): Promise<SourceResolvedFood | null>
  resolveByBarcode?(barcode: string): Promise<SourceResolvedFood | null>
  getLicenseInfo(): SourceLicenseInfo
}

/** Convert the resolver's FTS expression into terms for small LIKE-backed sources. */
export function searchTerms(expression: string): string[] {
  const quoted = [...expression.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[]
  if (quoted.length > 0) return quoted
  return expression.split(/\s+(?:AND|OR)\s+|\s+/i).map((term) => term.replaceAll('"', '').trim()).filter(Boolean)
}
