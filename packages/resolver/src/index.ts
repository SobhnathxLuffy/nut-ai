import type { DbAdapter } from '@nutai/db-adapter'
import { USDASource, OpenFoodFactsSource, IFCTSource, UserFoodSource, RecipeSource, RouterSource } from '@nutai/nutrition-sources'
import { normalizeGtin } from './gtin.js'
import { matchLadder } from './query.js'
import { normalizeIndianAliases } from './aliases.js'
import {
  type Candidate,
  type ResolutionOutcome,
  type ScoringContext,
  decideOutcome,
  scoreCandidates,
} from './scoring.js'

export * from './gtin.js'
export * from './query.js'
export * from './scoring.js'
export * from './aliases.js'

/**
 * Source databases deliberately remain separate. The bundled USDA and IFCT
 * artifacts have independent provenance/licensing lifecycles, while recipes
 * and user foods live only in user.db. Passing this context prevents accidental
 * cross-database row-ID collisions (for example USDA id 1 versus IFCT id 1).
 */
export interface NutritionSourceContext {
  readonly ifctDb?: DbAdapter
  readonly userDb?: DbAdapter
}

function sourceRouter(nutritionDb: DbAdapter, context: NutritionSourceContext = {}): RouterSource {
  const sources = [
    ...(context.userDb ? [new UserFoodSource(context.userDb), new RecipeSource(context.userDb)] : []),
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

export async function loadFood(
  db: DbAdapter,
  foodId: string,
  context?: NutritionSourceContext,
): Promise<ResolvedFood | null> {
  const source = sourceRouter(db, context)
  return (await source.resolveById(foodId)) as ResolvedFood | null
}

export interface ResolveResult {
  outcome: ResolutionOutcome
  /** How far down the broadening ladder we had to go. 0 = exact first try. */
  ladderStep: number
  /** True when every rung returned nothing — this is what the 5% trigger counts. */
  zeroHit: boolean
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
    const outcome = decideOutcome(scored)

    if (outcome.kind === 'miss') {
      // If we got rows but they all completely missed, keep going down the ladder.
      // E.g., exact phase hit a brand that doesn't exist, unbranded phase might find it.
      continue
    }

    return {
      outcome,
      ladderStep: step,
      zeroHit: false,
    }
  }

  return {
    outcome: { kind: 'miss' },
    ladderStep: ladder.length,
    zeroHit: true,
  }
}
