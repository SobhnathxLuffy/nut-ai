/**
 * Candidate scoring.
 *
 * SPEC-accuracy-engine.md §5.5. Six signals plus one penalty, combined linearly.
 * The weights are tunable constants to be fitted against real dogfood logs — they
 * are a reasoned starting point, not final numbers, and they live here in one
 * place precisely so fitting them is a one-file change.
 */

export interface Candidate {
  foodId: string
  source?: string
  sourcePriority?: number
  name: string
  brand: string | null
  category: string | null
  prepFacet: string | null
  basisConfidence: 'high' | 'low'
  servingSizeG: number | null
  energyKcal: number | null
  popularityRank: number | null
  completenessScore: number | null
  /** FTS5 bm25(): more negative is more relevant. Normalized before use. */
  rawBm25: number
  /** True when this row came from the brand-filtered query. */
  brandFiltered?: boolean
  /** Typical portion range for this row, from food_portions. */
  typicalGramsMin?: number | null
  typicalGramsMax?: number | null
}

export interface ScoringContext {
  /** What the model asked for. */
  canonicalFoodKey: string
  /** Brand text read off packaging, if any. An observation, not an inference. */
  observedBrand: string | null
  /** grilled | fried | raw | ... from the model's cooking cues. */
  prepFacet: string | null
  modelCategory: string | null
  /** The gram engine's estimate, used for portion plausibility. */
  estimatedGrams: number | null
}

export const WEIGHTS = {
  bm25: 0.35,
  /** Large, because directly-observed packaging text is an observation. */
  brandMatch: 0.2,
  prepMatch: 0.1,
  categoryPrior: 0.1,
  portionPlausibility: 0.1,
  popularityPrior: 0.1,
  sourcePriority: 0.05,
  /** v1.x only. Zero for now; the remaining weights already sum to 1.0. */
  embeddingCosine: 0,
  basisAmbiguityPenalty: 0.15,
} as const

/**
 * Auto-accept thresholds. BOTH must hold.
 *
 * The two-part rule is the structurally important part:
 *   - An absolute floor alone would auto-accept a mediocre top score just because
 *     nothing else came close — a genuinely novel dish with five equally-bad
 *     candidates.
 *   - A relative-gap rule alone would auto-accept a great score sitting beside an
 *     almost-as-great near-duplicate — two branded SKUs of the same product at
 *     different pack sizes — when the user really should glance at it.
 */
export const AUTO_ACCEPT = {
  minScore: 0.6,
  minGap: 0.12,
} as const

/**
 * FTS5 bm25() returns more-negative-is-more-relevant and is unbounded. Map the
 * result set onto 0-1 by its own range, so a query whose best hit is weak does not
 * get a free 1.0 just for being the best of a bad set — which is exactly what the
 * absolute auto-accept floor then catches.
 */
export function normalizeBm25(candidates: readonly Candidate[]): Map<string, number> {
  const out = new Map<string, number>()
  if (candidates.length === 0) return out

  const scores = candidates.map((c) => -c.rawBm25)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const range = max - min

  candidates.forEach((c, i) => {
    const s = scores[i] ?? 0
    // A single candidate, or an all-equal set, gets a neutral 0.5 rather than a
    // free 1.0 — being the only option is not evidence of being a good one.
    out.set(c.foodId, range === 0 ? 0.5 : (s - min) / range)
  })
  return out
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
}

/** 1.0 on exact brand match, 0 otherwise. */
export function brandMatch(c: Candidate, ctx: ScoringContext): number {
  if (!ctx.observedBrand || !c.brand) return 0
  return normalizeText(c.brand) === normalizeText(ctx.observedBrand) ? 1 : 0
}

/**
 * 1.0 on match, 0.5 when the row has NO prep facet, 0 on explicit conflict.
 *
 * The 0.5 is the load-bearing part: an untagged row is UNKNOWN, not contradicted.
 * Scoring it as a conflict would systematically punish generic USDA rows, which
 * frequently carry no prep facet at all, in favour of over-specified branded rows.
 */
export function prepMatch(c: Candidate, ctx: ScoringContext): number {
  if (!ctx.prepFacet) return 0.5
  if (!c.prepFacet) return 0.5
  return normalizeText(c.prepFacet) === normalizeText(ctx.prepFacet) ? 1 : 0
}

/** Same three-way logic. A scoring PRIOR, never a hard filter. */
export function categoryPrior(c: Candidate, ctx: ScoringContext): number {
  if (!ctx.modelCategory || !c.category) return 0.5
  return normalizeText(c.category) === normalizeText(ctx.modelCategory) ? 1 : 0
}

/**
 * How plausible this row is at the estimated mass.
 *
 * Penalizes matching "bouillon cube" when the plate clearly holds 150 g. Uses the
 * row's own typical portion range where known, falling back to its serving size.
 */
export function portionPlausibility(c: Candidate, ctx: ScoringContext): number {
  if (ctx.estimatedGrams == null || ctx.estimatedGrams <= 0) return 0.5

  const min = c.typicalGramsMin ?? (c.servingSizeG != null ? c.servingSizeG * 0.25 : null)
  const max = c.typicalGramsMax ?? (c.servingSizeG != null ? c.servingSizeG * 4 : null)
  if (min == null || max == null) return 0.5

  if (ctx.estimatedGrams >= min && ctx.estimatedGrams <= max) return 1

  // Decay smoothly by how many multiples outside the range we landed, rather than
  // cliff-edging to zero — a row can be right even at an unusual portion.
  const distance =
    ctx.estimatedGrams < min ? min / Math.max(ctx.estimatedGrams, 0.1) : ctx.estimatedGrams / max
  return Math.max(0, 1 / distance)
}

/** Zipfian tie-break toward the more commonly logged row. */
export function popularityPrior(c: Candidate): number {
  if (c.popularityRank == null || c.popularityRank <= 0) return 0.3
  // Rank 1 -> 1.0, decaying with the log of rank.
  return 1 / (1 + Math.log10(c.popularityRank))
}

/**
 * Subtracted when serving metadata is incomplete. An incomplete row is a worse
 * candidate because its onward unit math is less trustworthy — not because it is
 * less likely to be the right food.
 */
export function basisAmbiguity(c: Candidate): number {
  let penalty = 0
  if (c.basisConfidence === 'low') penalty += 0.6
  if (c.energyKcal == null) penalty += 0.4
  if (c.completenessScore != null && c.completenessScore < 0.5) penalty += 0.3
  return Math.min(1, penalty)
}

export interface ScoredCandidate extends Candidate {
  score: number
  breakdown: Record<string, number>
}

export function scoreCandidates(
  candidates: readonly Candidate[],
  ctx: ScoringContext,
): ScoredCandidate[] {
  const bm25 = normalizeBm25(candidates)

  return candidates
    .map((c) => {
      const parts = {
        bm25: bm25.get(c.foodId) ?? 0,
        brandMatch: brandMatch(c, ctx),
        prepMatch: prepMatch(c, ctx),
        categoryPrior: categoryPrior(c, ctx),
        portionPlausibility: portionPlausibility(c, ctx),
        popularityPrior: popularityPrior(c),
        sourcePriority: Math.max(0, Math.min(1, (c.sourcePriority ?? 0) / 100)),
        basisAmbiguity: basisAmbiguity(c),
      }

      const score =
        WEIGHTS.bm25 * parts.bm25 +
        WEIGHTS.brandMatch * parts.brandMatch +
        WEIGHTS.prepMatch * parts.prepMatch +
        WEIGHTS.categoryPrior * parts.categoryPrior +
        WEIGHTS.portionPlausibility * parts.portionPlausibility +
        WEIGHTS.popularityPrior * parts.popularityPrior +
        WEIGHTS.sourcePriority * parts.sourcePriority -
        WEIGHTS.basisAmbiguityPenalty * parts.basisAmbiguity

      return { ...c, score: Math.max(0, Math.min(1, score)), breakdown: parts }
    })
    .sort((a, b) => b.score - a.score)
}

export type ResolutionOutcome =
  | { kind: 'auto_accept'; match: ScoredCandidate }
  | { kind: 'disambiguate'; candidates: ScoredCandidate[] }
  | { kind: 'miss' }

/** Apply the two-part auto-accept rule. */
export function decideOutcome(scored: readonly ScoredCandidate[]): ResolutionOutcome {
  if (scored.length === 0) return { kind: 'miss' }

  const top = scored[0]
  if (!top) return { kind: 'miss' }
  const second = scored[1]
  const gap = second ? top.score - second.score : Number.POSITIVE_INFINITY

  if (top.score >= AUTO_ACCEPT.minScore && gap >= AUTO_ACCEPT.minGap) {
    return { kind: 'auto_accept', match: top }
  }

  return { kind: 'disambiguate', candidates: scored.slice(0, 5) }
}
