import { bandTier, rangeFor, type Band, type BandTier } from '@nutai/confidence'
import type { HighImpactQuestion, PortionContext, UncertaintyFactor } from '@nutai/core-schema'

/**
 * Meal-level honesty persistence (honesty-contract round follow-up, O6).
 *
 * The scan computes the contract-v1.3.0 meal blocks — portionContext,
 * uncertaintyFactors, highImpactQuestion, the known/unknown summary — plus the
 * meal-level band, and the result screen renders all of it. Until v12 none of
 * it survived the log: `meals.honesty_json` is the scan-time summary object
 * serialized AT LOG TIME (post-review, so it is the state the user actually
 * accepted), and `log_items`' per-row quality columns carry the row-level
 * disclosures. This module owns the one (de)serialization both sides share:
 * repo.ts logMeal writes it, logged-meals.ts reads it, meal-detail.tsx renders
 * it. Zero React Native imports so the round trip is testable under bare Node.
 *
 * DEGRADATION RULE (the honesty contract, not a convenience): a NULL/absent/
 * corrupt snapshot or column means NO CLAIM. Pre-v12 meals, barcode/label/
 * receipt/manual rows, and non-scan writers all read back null, and every
 * reader renders nothing rather than inventing a default the model never
 * made. Parse failures are logged as null, never thrown — a history row that
 * cannot be parsed must not brick the meal-detail screen.
 */

/** The meal-level honesty snapshot as serialized into `meals.honesty_json`. */
export interface MealHonestySnapshot {
  /** The meal-level uncertainty band computed at log time. Always present. */
  mealBand: Band
  /** Schema v1.3 portion_context — how much of the meal the frame showed. */
  portionContext?: PortionContext | null
  /** Schema v1.3 major_uncertainties, capped at the contract maximum. */
  uncertaintyFactors?: UncertaintyFactor[]
  /** Schema v1.3 highest_impact_question, verbatim. */
  highImpactQuestion?: HighImpactQuestion | null
  /** Schema v1.3 summary.what_is_known, verbatim. */
  knownSummary?: string | null
  /** Schema v1.3 summary.what_is_not_known, verbatim. */
  unknownSummary?: string | null
}

/**
 * The slice of ScanResult the snapshot derives from — structural, so both a
 * real ScanResult and an already-built snapshot satisfy it (TitleInput
 * pattern: keeps the helper honest about exactly what it reads).
 */
export interface HonestySource {
  mealBand: Band
  portionContext?: PortionContext | null
  uncertaintyFactors?: UncertaintyFactor[]
  highImpactQuestion?: HighImpactQuestion | null
  knownSummary?: string | null
  unknownSummary?: string | null
}

/**
 * Derive the snapshot from the ScanResult the store holds at log time.
 *
 * `mealBand` is non-optional on ScanResult (recomputeAfterEdit keeps it
 * current through every review edit), so a logged meal always carries its
 * band; the v1.3 blocks are optional in the TYPE because ScanResult is also
 * built on paths with no vision payload, and they normalize to their
 * documented neutrals (null / empty) here — the JSON never carries
 * `undefined`, so the serialized shape is stable key-for-key.
 */
export function mealHonestyFromScan(source: HonestySource): MealHonestySnapshot {
  return {
    mealBand: source.mealBand,
    portionContext: source.portionContext ?? null,
    uncertaintyFactors: source.uncertaintyFactors ?? [],
    highImpactQuestion: source.highImpactQuestion ?? null,
    knownSummary: source.knownSummary ?? null,
    unknownSummary: source.unknownSummary ?? null,
  }
}

/** Fixed-shape serialization — same key order every time, no undefined. */
export function serializeMealHonesty(source: HonestySource): string {
  return JSON.stringify(mealHonestyFromScan(source))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Parse `meals.honesty_json` back into a snapshot, defensively.
 *
 * The one structurally REQUIRED member is mealBand (it is the only value the
 * pipeline guarantees); anything missing or malformed there fails the whole
 * parse — a half-invented snapshot is worse than none. The optional v1.3
 * blocks degrade member-by-member to their neutrals so a future block added
 * to the serializer cannot orphan every older snapshot.
 */
export function parseMealHonesty(json: string | null | undefined): MealHonestySnapshot | null {
  if (json == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const band = parsed['mealBand']
  if (!isRecord(band)) return null
  const halfPct = band['halfPct']
  const tier = band['tier']
  if (typeof halfPct !== 'number' || !Number.isFinite(halfPct)) return null
  if (typeof tier !== 'string' || !TIER_SET.has(tier as BandTier)) return null
  const reasons = Array.isArray(band['reasons'])
    ? band['reasons'].filter((r): r is string => typeof r === 'string')
    : []

  const portionContextRaw = parsed['portionContext']
  const portionContext: PortionContext | null = isRecord(portionContextRaw)
    ? {
        wholeMealVisible: portionContextRaw['wholeMealVisible'] === true,
        scaleReferenceAvailable: portionContextRaw['scaleReferenceAvailable'] === true,
        scaleReferenceDescription:
          typeof portionContextRaw['scaleReferenceDescription'] === 'string'
            ? portionContextRaw['scaleReferenceDescription']
            : '',
        absolutePortionConfidence:
          typeof portionContextRaw['absolutePortionConfidence'] === 'string' &&
          ['high', 'medium', 'low', 'unknown'].includes(portionContextRaw['absolutePortionConfidence'])
            ? (portionContextRaw['absolutePortionConfidence'] as PortionContext['absolutePortionConfidence'])
            : 'unknown',
      }
    : null

  const factorsRaw = parsed['uncertaintyFactors']
  // A factor with no text is not a claim — dropped here exactly as
  // topUncertaintyFor skips empty factors on the result screen.
  const uncertaintyFactors: UncertaintyFactor[] = Array.isArray(factorsRaw)
    ? factorsRaw
        .filter(isRecord)
        .filter((f) => typeof f['factor'] === 'string' && (f['factor'] as string).trim() !== '')
        .map((f) => ({
          factor: f['factor'] as string,
          impactOnTotalCalories:
            typeof f['impactOnTotalCalories'] === 'string' &&
            ['low', 'medium', 'high'].includes(f['impactOnTotalCalories'])
              ? (f['impactOnTotalCalories'] as UncertaintyFactor['impactOnTotalCalories'])
              : 'low',
        }))
    : []

  const questionRaw = parsed['highImpactQuestion']
  const highImpactQuestion: HighImpactQuestion | null =
    isRecord(questionRaw) && typeof questionRaw['question'] === 'string' && questionRaw['question'].trim() !== ''
      ? {
          question: questionRaw['question'],
          options: Array.isArray(questionRaw['options'])
            ? questionRaw['options'].filter((o): o is string => typeof o === 'string')
            : [],
        }
      : null

  return {
    mealBand: { halfPct, tier: tier as BandTier, reasons },
    portionContext,
    uncertaintyFactors,
    highImpactQuestion,
    knownSummary: nullableString(parsed['knownSummary']),
    unknownSummary: nullableString(parsed['unknownSummary']),
  }
}

const TIER_SET: ReadonlySet<BandTier> = new Set(['none', 'tight', 'moderate', 'wide', 'very_wide'])

// ---------------------------------------------------------------------------
// Render derivations (meal-detail consumes these; the decisions are tested
// here, the JSX only renders — the review.ts pattern).
// ---------------------------------------------------------------------------

/** The persisted visibility column's closed set, as the DB stores it. */
export type LoggedRowVisibility = 'visible' | 'likely' | 'inferred'

const VISIBILITY_LABELS: Readonly<Record<LoggedRowVisibility, string>> = {
  visible: 'Seen in photo',
  likely: 'Likely present',
  inferred: 'Not directly visible',
}

/**
 * The per-row "basis" caption: how this row earned its place in the meal
 * (the model's own scene-visibility claim, persisted since v12).
 *
 * NULL for pre-v12 rows, manual/barcode/label rows, and any string outside
 * the closed set — those rows made no claim, and an invented label would be
 * the exact dishonesty this column exists to prevent.
 */
export function visibilityLabelFor(visibility: string | null | undefined): string | null {
  if (visibility == null) return null
  return VISIBILITY_LABELS[visibility as LoggedRowVisibility] ?? null
}

/**
 * The per-row band, reconstructed from the PERSISTED half-width — or null.
 *
 * Null when the row carries no band_half_pct (manual/added rows, pre-band
 * writers) or when the persisted width lands in the 'none' tier: ConfidenceChip
 * already rules that a band that tight is false modesty, and the same ruling
 * governs history. Every non-null tier comes from @nutai/confidence's own
 * bandTier() step function — the tier is DERIVED from the stored width, never
 * stored beside it where the two could drift.
 */
export interface LoggedRowBand {
  tier: BandTier
  low: number
  high: number
}

export function loggedRowBandFor(
  halfPct: number | null | undefined,
  rowKcal: number,
): LoggedRowBand | null {
  if (typeof halfPct !== 'number' || !Number.isFinite(halfPct) || halfPct < 0) return null
  const tier = bandTier(halfPct)
  if (tier === 'none') return null
  const { low, high } = rangeFor(rowKcal, { halfPct, tier, reasons: [] })
  return { tier, low, high }
}
