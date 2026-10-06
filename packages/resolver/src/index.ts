import type { DbAdapter } from '@nutai/db-adapter'
import { USDASource, OpenFoodFactsSource, IFCTSource, UserFoodSource, RecipeSource, RouterSource, DishKBSource, HouseholdDishSource } from '@nutai/nutrition-sources'
import { lookupPrior, priorToHint, type PortionHint } from '@nutai/portion-priors'
import { normalizeGtin } from './gtin.js'
import { matchLadder } from './query.js'
import { normalizeIndianAliases } from './aliases.js'
import { FavoritesSource } from './favorites-source.js'
import {
  type Candidate,
  type ResolutionOutcome,
  type ScoringContext,
  type ScoredCandidate,
  decideOutcome,
  scoreCandidates,
} from './scoring.js'

export * from './gtin.js'
export * from './query.js'
export * from './scoring.js'
export * from './aliases.js'
export * from './favorites-source.js'

// Task 2-c: re-export the canonical hint shape so the pipeline (and any other
// consumer) can type ResolvedFood.portionHints without reaching into the
// portion-priors package directly.
export type { PortionHint } from '@nutai/portion-priors'

export interface NutritionSourceContext {
  readonly ifctDb?: DbAdapter
  readonly userDb?: DbAdapter
  readonly nutritionDb?: DbAdapter
}

function sourceRouter(nutritionDb: DbAdapter, context: NutritionSourceContext = {}): RouterSource {
  const sources = [
    ...(context.userDb ? [
      new UserFoodSource(context.userDb),
      // Task 11-b: saved favorite meals (logging_shortcuts kind='favorite') —
      // the user's own logged meal snapshots, searchable alongside every
      // corpus. Priority 95: below user_foods (100) so a matching single food
      // keeps the top auto-accept tier, above recipes (90) because the user's
      // own logged meal beats a household recipe for the same name.
      new FavoritesSource(context.userDb),
      new RecipeSource(context.userDb),
      // Saved "My Version" household dishes: previously written to the user DB
      // where no source could find them again.
      new HouseholdDishSource(context.userDb, nutritionDb, context.ifctDb),
    ] : []),
    new DishKBSource(nutritionDb, context.ifctDb), // Draft dishes remain searchable but cannot resolve to nutrition.
    ...(context.ifctDb ? [new IFCTSource(context.ifctDb)] : []),
    new USDASource(nutritionDb),
    new OpenFoodFactsSource(),
  ]
  return new RouterSource(sources)
}

/**
 * Nutrition resolution — food name to database row.
 *
 * SPEC-accuracy-engine.md §5. The stage between "the model says this is grilled
 * chicken breast" and "165 kcal per 100 g, from FDC row 171077".
 *
 * Everything here is offline. No network call has ever been part of this stage,
 * on either inference path, which is what makes the whole repair loop free.
 */

export interface ResolvedFood {
  foodId: string
  sourceId: string
  sourceVersion: string | null
  attribution: string
  name: string
  brand: string | null
  /** Per-100 g. Always. There is exactly one computational basis. */
  energyKcal: number | null
  proteinG: number | null
  fatG: number | null
  carbG: number | null
  fiberG: number | null
  sugarG: number | null
  sodiumMg: number | null
  servingSizeG: number | null
  servingDesc: string | null
  /**
   * Task 2-c — the portionHints seam. Household portion hints for this food,
   * each { unit, typical, min, max, source }, range-carrying and sourced:
   *   - set by DishKBSource.resolveById from the dish's curated portion model;
   *   - otherwise, when the corpus row carries NO grams of its own
   *     (servingSizeG null), populated here from the @nutai/portion-priors
   *     population dataset via the resolved display name.
   * The pipeline spreads this into the gram engine's ResolvedRow, whose
   * population-prior tier (between discrete-count and personal-prior) consumes
   * it — replacing hardcoded screen numbers with inspectable data.
   */
  portionHints?: PortionHint[]
  license: string
  source: string
}

export async function resolveByBarcode(
  db: DbAdapter,
  rawBarcode: string,
  context?: NutritionSourceContext,
): Promise<ResolvedFood | null> {
  const gtin = normalizeGtin(rawBarcode)
  if (!gtin) return null

  const source = sourceRouter(db, context)
  if (!source.resolveByBarcode) return null
  return (await source.resolveByBarcode(gtin)) as ResolvedFood | null
}

/**
 * Attach household portion hints to a resolved food (Task 2-c).
 *
 * Two sources, in order of specificity:
 *   1. Hints the source itself attached — the Dish KB's curated portion model
 *      ("one Plain Dosa = 80 g, range 60-100"). Passed through untouched.
 *   2. The @nutai/portion-priors population dataset, consulted ONLY when the
 *      corpus row lacks grams of its own (servingSizeG null). A row that
 *      already knows its serving size does not need a second opinion, and a
 *      barcode/label row must never have one bolted on. The lookup keys off
 *      the resolved display name via substring/stem matching ('Pigeon pea
 *      (red gram), dal, cooked' -> dal katori), so generic-corpus Indian rows
 *      reach the gram ladder as inspectable data instead of falling to the
 *      150 g generic fallback.
 */
function attachPortionHints(resolved: ResolvedFood | null): ResolvedFood | null {
  if (!resolved) return null
  if (resolved.portionHints?.length) return resolved
  if (resolved.servingSizeG != null) return resolved

  const prior = lookupPrior(resolved.name)
  if (!prior) return resolved
  return { ...resolved, portionHints: [priorToHint(prior)] }
}

export async function loadFood(
  db: DbAdapter,
  foodId: string,
  context?: NutritionSourceContext,
): Promise<ResolvedFood | null> {
  const source = sourceRouter(db, context)
  const resolved = (await source.resolveById(foodId)) as ResolvedFood | null
  return attachPortionHints(resolved)
}

export interface ResolveResult {
  outcome: ResolutionOutcome
  /** How far down the broadening ladder we had to go. 0 = exact first try. */
  ladderStep: number
  /** True when every rung returned nothing — this is what the 5% trigger counts. */
  zeroHit: boolean
  /**
   * The best-scoring candidates of the winning ladder rung, ACROSS every
   * source. Multi-source search: the auto-accept decision picks one match,
   * but the searcher still gets to see what the other databases hold — an
   * IFCT row beside its USDA counterpart — instead of a single enforced row.
   */
  topCandidates: ScoredCandidate[]
}

/**
 * Text resolution: FTS5 candidate generation, six-signal scoring, and the
 * two-part auto-accept decision.
 */
export async function resolveByText(
  db: DbAdapter,
  ctx: ScoringContext,
  context?: NutritionSourceContext,
): Promise<ResolveResult> {
  const literalLadder = matchLadder(ctx.canonicalFoodKey.trim().toLowerCase())
  const normalizedLadder = matchLadder(normalizeIndianAliases(ctx.canonicalFoodKey))
  const ladder = Array.from(
    { length: Math.max(literalLadder.length, normalizedLadder.length) },
    // P0-2 (re-verified as Task 2-c): the LITERAL term goes first at every
    // depth. WHY: the literal Indian dish identity is MORE SPECIFIC than the
    // generic English alias — 'dosa' names the dish, 'crepe' merely describes
    // it — so aliases must BROADEN the ladder, never REPLACE the identity. The
    // old normalized-first interleave let broad expansions (biryani -> 'mixed
    // rice', poha -> 'cape gooseberry', upma -> 'savory porridge') match
    // acceptable-scoring junk from low-priority sources and end the cascade
    // before the literal dish name ever reached the CURATED dish KB. Specific
    // aliases (toor -> red gram, idly -> idli) still catch everything the
    // literal term misses — one rung later, only when the literal term had no
    // acceptable hit.
    (_, index) => [literalLadder[index], normalizedLadder[index]],
  ).flat().filter((expression, index, all): expression is string => Boolean(expression) && all.indexOf(expression) === index)
  const source = sourceRouter(db, context)

  for (let step = 0; step < ladder.length; step++) {
    const expr = ladder[step]
    if (!expr) continue

    let rows: Candidate[] = []
    try {
      rows = (await source.search(expr)) as Candidate[]
    } catch {
      // A malformed MATCH expression must not take down a scan. Move down the
      // ladder rather than surfacing a SQL error to someone photographing lunch.
      continue
    }

    if (rows.length === 0) {
      continue
    }

    const scored = scoreCandidates(rows, ctx)

    // The accept/decision runs on the highest-priority source tier only — the
    // same trust ordering the old source cascade enforced structurally. The
    // merged LIST (topCandidates) still shows every corpus, but a generic USDA
    // row must not out-decide a matching dish-KB identity or IFCT row merely
    // because BM25 magnitudes differ across corpora (P0-2 contract, golden
    // queries). Within the tier, the two-part auto-accept rule applies as-is.
    const topTier = scored.reduce((max, c) => Math.max(max, c.sourcePriority ?? 0), 0)
    const tierScored = scored.filter((c) => (c.sourcePriority ?? 0) === topTier)
    const outcome = decideOutcome(tierScored)

    if (outcome.kind === 'miss') {
      // If we got rows but they all completely missed, keep going down the ladder.
      // E.g., exact phase hit a brand that doesn't exist, unbranded phase might find it.
      continue
    }

    return {
      outcome,
      ladderStep: step,
      zeroHit: false,
      topCandidates: scored.slice(0, 12),
    }
  }

  return {
    outcome: { kind: 'miss' },
    ladderStep: ladder.length,
    zeroHit: true,
    topCandidates: [],
  }
}
