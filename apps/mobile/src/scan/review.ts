import type { Band, BandTier } from '@nutai/confidence'
import { rangeFor } from '@nutai/confidence'
import type { IngredientRow } from '@nutai/core-schema'
import { countAnswerMultiplier } from '@nutai/repair'

/**
 * Pure presentation logic for the scan REVIEW screen (result.tsx).
 *
 * WHY a separate module: result.tsx is a React Native screen and cannot run
 * under the repo's node-only vitest setup, but the decisions it makes — which
 * title a thali gets, when the hero number is allowed to look precise, what a
 * row's provenance label says — are exactly the "AI interprets, deterministic
 * code calculates" rulings the product is made of. Everything that is a RULE
 * lives here, node-pure and unit-tested; result.tsx only renders what these
 * functions return. No react-native import, no platform API, no I/O.
 */

// ---------------------------------------------------------------------------
// Thousands separator (display-only; the underlying numbers stay raw floats)
// ---------------------------------------------------------------------------

/**
 * Regex grouping instead of Intl.NumberFormat: some Hermes builds ship without
 * full ICU, and a formatting helper that throws or formats differently per
 * device would put DIFFERENT numbers on the same screen. One implementation,
 * one output, everywhere.
 */
export function formatInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ---------------------------------------------------------------------------
// Scene-based meal title (schema 1.1 `scene`)
// ---------------------------------------------------------------------------

/** Structural slice of ScanResult the title rule needs — keeps tests light. */
export interface TitleInput {
  scene?: { mealType: string; displayName: string; confidence: number } | null
  sceneDisplayName?: string | null
  items: ReadonlyArray<{ row: Pick<IngredientRow, 'displayName'> }>
}

/**
 * The screen title.
 *
 * BUG this fixes: a whole Indian thali was titled "Chapati" because the title
 * fell back to items[0]. A scene that IS many dishes at once must be named by
 * the scene's own display_name; anything else keeps the old behavior (first
 * item wins), because a single-pizza photo titled "Pizza" is correct and a
 * scene label must never override a name the item itself carries.
 *
 * TITLE_MULTI_COMPONENT_SCENES (below) mirrors @nutai/repair's
 * MULTI_COMPONENT_SCENE_TYPES — the "many dishes at once" set: mixed_plate,
 * indian_thali, buffet, composite_dish. The items.length > 1 guard keeps a
 * one-item composite (a pizza the model resolved as one row) from being
 * retitled by a scene the photo only partially supports.
 */
export function mealTitleFor(result: TitleInput): string {
  const fallback = result.items[0]?.row.displayName ?? 'Your meal'
  const scene = result.scene
  if (
    scene != null &&
    TITLE_MULTI_COMPONENT_SCENES.has(scene.mealType) &&
    result.items.length > 1 &&
    result.sceneDisplayName
  ) {
    return result.sceneDisplayName
  }
  return fallback
}

/**
 * Local copy of the multi-component set, NOT an import: @nutai/repair's
 * MULTI_COMPONENT_SCENE_TYPES is exported and used by the repair layer, but the
 * title rule must not silently change when the QUESTION layer tunes its
 * scene sets for interruption economics. Title semantics are pinned here.
 */
const TITLE_MULTI_COMPONENT_SCENES: ReadonlySet<string> = new Set([
  'mixed_plate',
  'indian_thali',
  'buffet',
  'composite_dish',
])

/**
 * The small caption under the title: "<scene display name, lowercased> · N
 * items". Only when the scene says something the title does not already say —
 * repeating the title in smaller text is noise, not honesty.
 */
export function sceneCaptionFor(result: TitleInput): string | null {
  const scene = result.scene
  if (scene == null) return null
  const title = mealTitleFor(result)
  if (scene.displayName.trim().toLowerCase() === title.trim().toLowerCase()) return null
  const n = result.items.length
  return `${scene.displayName.toLowerCase()} · ${n} ${n === 1 ? 'item' : 'items'}`
}

// ---------------------------------------------------------------------------
// Uncertainty-honest hero number
// ---------------------------------------------------------------------------

/** Tiers wide enough that a precise-looking integer is a lie. */
export function isWideTier(tier: BandTier): boolean {
  return tier === 'wide' || tier === 'very_wide'
}

/**
 * The meal-level kcal the hero renders.
 *
 * WHY round to 100 only on wide bands: "1,433 kcal" implies ±1 kcal certainty.
 * When the measured band is ±30-60%, the honest rendering is the nearest-100
 * anchor plus the explicit range line (likelyRangeLabel) — precision the data
 * cannot support is exactly the incumbent's failure mode this app exists to
 * fix. Tight/moderate bands keep the exact figure: rounding there would THROW
 * AWAY real information.
 */
export function roundForUncertainty(kcal: number, tier: BandTier): string {
  if (isWideTier(tier)) {
    return `≈ ${formatInt(Math.round(kcal / 100) * 100)}`
  }
  return formatInt(kcal)
}

/** "Likely range 900–1,950" — the companion line under a wide hero number. */
export function likelyRangeLabel(kcal: number, band: Band): string {
  const { low, high } = rangeFor(kcal, band)
  return `Likely range ${formatInt(low)}–${formatInt(high)}`
}

// ---------------------------------------------------------------------------
// Per-row gram range + quick controls (the range chips' expanded panel)
// ---------------------------------------------------------------------------

export interface GramRange {
  minG: number
  maxG: number
}

/**
 * The honest gram range around a row.
 *
 * The model's own bounded range (schema 1.1 model_gram_range → row.portionRange)
 * wins when present — it is a claim about THIS item, not a symmetric band. When
 * the model could not bound it, the row's measured band derives one from the
 * grams the estimate was anchored at.
 *
 * WHY anchorGrams: the derived range is grams × (1 ± halfPct). If it re-derived
 * from the LIVE grams after every quick-set, tapping [min] would make min the
 * new center and every subsequent tap would ratchet the estimate downward. The
 * screen freezes the anchor at first expansion; portionRange rows never drift
 * because the model owns their ends.
 */
export function portionRangeFor(row: IngredientRow, band: Band, anchorGrams?: number): GramRange {
  if (row.portionRange && row.portionRange.minG <= row.portionRange.maxG) {
    return row.portionRange
  }
  const base = anchorGrams ?? row.grams
  return { minG: base * (1 - band.halfPct), maxG: base * (1 + band.halfPct) }
}

export interface QuickSetGrams {
  min: number
  typical: number
  max: number
}

/**
 * The three quick-control targets for an expanded row.
 *
 * `typical` is the ANCHOR estimate (what the scan said before the user started
 * quick-setting), so the middle button doubles as "put it back". Tapping any of
 * them routes through editGrams — the same primitive as typing in the grams
 * field — so totals recompute locally and the row becomes user-confirmed.
 */
export function quickSetGramsFor(row: IngredientRow, band: Band, anchorGrams: number): QuickSetGrams {
  const { minG, maxG } = portionRangeFor(row, band, anchorGrams)
  return { min: minG, typical: anchorGrams, max: maxG }
}

// ---------------------------------------------------------------------------
// Row provenance (AI estimate vs user-confirmed vs sourced)
// ---------------------------------------------------------------------------

export interface ProvenanceLabel {
  label: string
  tone: 'uncertain' | 'positive'
}

/**
 * The provenance label under a row that has no better source to cite.
 *
 * "Confirmed" replaces "AI ESTIMATE" once the USER owns the quantity — either
 * they typed/set grams (editGrams stamps userEditedAt) or they confirmed the
 * row's stated assumption. Web-sourced attribution is deliberately NOT
 * handled here: the citation describes the per-100 g data, which a gram edit
 * does not change, so "From chick-fil-a.com" stays true after an edit and the
 * screen keeps showing it.
 *
 * WHY userEditedAt and not macrosUserEdited: macrosUserEdited flips the
 * calorie basis to Atwater recomputation and stamps a "recalculated from
 * macros" note in the ledger (packages/totals §6.2) — a FALSE disclosure for a
 * gram-only edit, which scales the snapshot linearly. userEditedAt is the
 * exact "the user set this quantity" marker, already maintained by editGrams.
 */
export function estimateProvenanceLabel(row: IngredientRow): ProvenanceLabel | null {
  if (row.userEditedAt != null || row.assumptions.some((a) => a.userConfirmed)) {
    return { label: 'Confirmed', tone: 'positive' }
  }
  if (row.isEstimate) return { label: 'AI ESTIMATE', tone: 'uncertain' }
  return null
}

// ---------------------------------------------------------------------------
// Question → row matching for the per-item question types
// ---------------------------------------------------------------------------

/**
 * Find the row a per-item question is about.
 *
 * WHY name matching: SelectedQuestion carries no item id (the repair layer
 * predates per-item questions — every earlier question was meal-level), and
 * packages/** is out of bounds for this fix. The rendered text is the only
 * linkage: "How large was the {name}?" / "How many {name}s did you eat?" both
 * embed the item name. Longest displayName contained in the text wins — it
 * disambiguates "Pizza" vs "Margherita Pizza" toward the specific row, and
 * plural forms match because the question text embeds the plural ("samosas"
 * contains "samosa"). Names under 3 characters are skipped so a row literally
 * named "Pea" cannot hijack unrelated text.
 */
export function rowIdForNamedQuestion(
  questionText: string,
  rows: ReadonlyArray<Pick<IngredientRow, 'id' | 'displayName'>>,
): string | null {
  const text = questionText.toLowerCase()
  let best: { id: string; length: number } | null = null
  for (const row of rows) {
    const name = row.displayName.trim().toLowerCase()
    if (name.length < 3) continue
    if (text.includes(name) && (best == null || name.length > best.length)) {
      best = { id: row.id, length: name.length }
    }
  }
  return best?.id ?? null
}

const COUNT_TAG = /^count:(\d+(?:\.\d+)?)$/

/**
 * The count the model's estimate describes, when it is recoverable.
 *
 * The vision Item's qualitative_size ("count:N") is deliberately not carried
 * onto the UI-facing ScanResult, so the baseline count is recovered from a
 * count assumption the pipeline copied verbatim onto the row
 * (item.stated_assumptions → row.assumptions) when the model stated one.
 */
export function modelCountFor(row: IngredientRow): number | null {
  for (const a of row.assumptions) {
    const m = COUNT_TAG.exec(a.type)
    if (m) return Number(m[1])
  }
  return null
}

/**
 * The grams multiplier for a count_question answer: answerCount / N, via the
 * repair layer's own helper so the arithmetic has exactly one definition.
 *
 * WHEN N IS UNKNOWN: the estimate is presumed to describe ONE unit — the same
 * neutral-baseline reading whole_dish_size gives its 10" base — and the answer
 * rescales from there. Exact for the modal single-snack case (count:1);
 * documented best-effort for multi-unit photos until ScanResult exposes the
 * item's qualitative_size (a packages/ change owned by the pipeline agents).
 */
export function countMultiplierFor(row: IngredientRow, answerCount: number): number | null {
  const n = modelCountFor(row)
  return countAnswerMultiplier(n != null ? `count:${n}` : 'count:1', answerCount)
}

/**
 * A count_question answer as the number of units the user ate. '4plus' is the
 * minimum the user asserted (never an invented midpoint); 'as_counted' (the
 * silent default) and anything non-numeric change nothing.
 */
export function countAnswerValue(optionValue: string): number | null {
  if (optionValue === 'as_counted') return null
  if (optionValue === '4plus') return 4
  const n = Number(optionValue)
  return Number.isFinite(n) && n > 0 ? n : null
}
