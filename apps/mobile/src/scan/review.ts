import type { Band, BandTier } from '@nutai/confidence'
import { rangeFor } from '@nutai/confidence'
import type { IngredientRow } from '@nutai/core-schema'
import type { ScanResult } from '@nutai/pipeline'
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

// ---------------------------------------------------------------------------
// Contract v1.3.0 honesty surfaces — what the model itself flagged
// ---------------------------------------------------------------------------

/**
 * Wave-3 contract slices, mirrored from contract v1.3.0: the fields 3-b wires
 * onto ScanResult (known/unknownSummary, uncertaintyFactors,
 * highImpactQuestion, portionContext) and onto IngredientRow (preparation).
 * They live HERE as structural declarations — the same move as TitleInput —
 * so the review screen compiles and tests before the pipeline lands the real
 * fields, and keeps compiling unchanged the moment it does. The shapes are
 * pinned next to the code that consumes them, so any drift in the landed
 * contract shows up as a typecheck error at this seam, not as wrong UI.
 */
export interface PortionContext {
  wholeMealVisible: boolean
  scaleReferenceAvailable: boolean
  scaleReferenceDescription: string | null
  absolutePortionConfidence: 'low' | 'medium' | 'high' | 'unknown'
}

export interface UncertaintyFactor {
  factor: string
  impactOnTotalCalories: 'low' | 'medium' | 'high'
}

export interface ModelHighImpactQuestion {
  question: string
  options: string[]
}

export interface PreparationInfo {
  method: string
  intrinsicFat: 'low' | 'moderate' | 'high' | 'unknown'
  addedCookingFat: 'none' | 'light' | 'moderate' | 'heavy' | 'unknown'
  confidence: number
}

/**
 * ScanResult as contract v1.3.0 delivers it. All five fields are OPTIONAL so
 * a result built by today's pipeline — which does not set them yet — is still
 * a valid ScanResultV13; result.tsx annotates its result with this type and
 * reads the fields defensively. When 3-b lands the real declarations the
 * alias becomes a no-op (a checked assignment, not a cast, so any shape drift
 * fails the typecheck instead of silently changing the screen).
 */
export type ScanResultV13 = ScanResult & {
  knownSummary?: string | null
  unknownSummary?: string | null
  uncertaintyFactors?: ReadonlyArray<UncertaintyFactor> | null
  highImpactQuestion?: ModelHighImpactQuestion | null
  portionContext?: PortionContext | null
}

/** IngredientRow as contract v1.3.0 delivers it. Same lifecycle as ScanResultV13. */
export type IngredientRowV13 = IngredientRow & {
  qualitativeAmount?: 'tiny' | 'light' | 'moderate' | 'heavy' | 'unknown' | null
  preparation?: PreparationInfo | null
}

// -- Known/unknown summary card ------------------------------------------------

/** Structural slice summaryLinesFor needs — keeps tests light (TitleInput pattern). */
export interface SummaryLinesInput {
  knownSummary?: string | null
  unknownSummary?: string | null
}

export interface SummaryLines {
  known: string | null
  unknown: string | null
}

/**
 * The known/unknown summary card's two lines, display-ready.
 *
 * Each summary is independently optional: the model may know things and not
 * know others, know both, or have flagged neither. Null/undefined/empty and
 * whitespace-only summaries mean "nothing to say" — the card renders only the
 * lines that survive, and neither line exists to pad the other.
 *
 * Wave 4d (report Ch 13 DoD "no text glyph standing in for a symbol"): the
 * lines come back PLAIN. The old "✓ "/"? " text prefixes were the last text
 * glyphs standing in for icons — result.tsx now renders the real check and
 * search ICONS beside these lines, so the symbol lives in the icon system
 * where it can take a weight, a theme colour, and an accessible name.
 */
export function summaryLinesFor(result: SummaryLinesInput): SummaryLines {
  const known = cleanSummaryLine(result.knownSummary)
  const unknown = cleanSummaryLine(result.unknownSummary)
  return { known, unknown }
}

function cleanSummaryLine(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

// -- Biggest calorie uncertainty line ------------------------------------------

export interface TopUncertaintyOptions {
  /** True when the "Likely range …" line is rendered beside the hero. */
  rangeShown?: boolean
}

/**
 * A factor that only restates OVERALL size uncertainty: a portion/amount/
 * serving/size/weight noun AND an unknown/uncertain/estimated/guess/varies
 * qualifier on the same normalized text. Deliberately narrow — a factor about
 * hidden cooking fat, mixed composition, or count ambiguity ("cooking oil not
 * visible", "curry composition estimated") contains neither keyword pair and
 * is never suppressed, even with the range line showing.
 */
const AMOUNT_NOUN_RE = /\b(portion|amount|quantity|serving|size|weight)\b/
const OPEN_UNCERTAINTY_RE = /\b(unknown|uncertain|uncertainty|unclear|estimated|guess|guessed|varies)\b/

/**
 * The single biggest calorie uncertainty, display-ready:
 * "Biggest calorie uncertainty: {factor}".
 *
 * Selection: the first factor the model marked impact 'high' wins; when the
 * model marked none high, the first factor of any impact is the honest
 * fallback (the model DID flag something); no factors → null.
 *
 * DUPLICATION GUARD (documented ruling): when the "Likely range …" line is
 * already on screen (rangeShown), a factor that merely restates overall
 * portion/amount uncertainty adds nothing the range has not already said in
 * numbers — the range IS that statement. Such factors are SKIPPED and
 * selection falls through to the next candidate; if every factor is guarded,
 * the line is not shown at all. When no range line is shown (tight band), the
 * same factor is KEPT: it is then the only size honesty on the screen. The
 * guard is the keyword pair above, not free-text similarity — simple,
 * predictable, and tested.
 */
export function topUncertaintyFor(
  factors: ReadonlyArray<UncertaintyFactor> | null | undefined,
  options?: TopUncertaintyOptions,
): string | null {
  if (!factors || factors.length === 0) return null
  const rangeShown = options?.rangeShown ?? false
  const duplicatesRangeLine = (factorText: string): boolean => {
    if (!rangeShown) return false
    const text = factorText.trim().toLowerCase()
    return AMOUNT_NOUN_RE.test(text) && OPEN_UNCERTAINTY_RE.test(text)
  }
  const pick = (impact: UncertaintyFactor['impactOnTotalCalories'] | 'any'): UncertaintyFactor | null => {
    for (const f of factors) {
      if (f.factor.trim() === '') continue
      if ((impact === 'any' || f.impactOnTotalCalories === impact) && !duplicatesRangeLine(f.factor)) return f
    }
    return null
  }
  const chosen = pick('high') ?? pick('any')
  return chosen == null ? null : `Biggest calorie uncertainty: ${chosen.factor.trim()}`
}

// -- Portion-context honesty chip ----------------------------------------------

/**
 * The portion-context chip's text, or null when nothing should show.
 *
 * RULINGS (documented):
 * - Only 'low' and 'unknown' absolutePortionConfidence earn the chip. 'high'
 *   is the model asserting a bound portion — a chip would be noise. 'medium'
 *   is not chip-worthy either: the chip's job is to flag a GUESS, and medium
 *   is not a guess; the confidence chip and its band already carry gradations.
 * - The copy depends on scaleReferenceAvailable: claiming "no scale in photo"
 *   while the contract says a reference object WAS found would itself be a
 *   lie, so a found-but-insufficient reference gets the softer line. Both
 *   variants stay short and non-alarmist — violet is an invitation, per the
 *   theme's colour ruling.
 */
export function portionConfidenceNoteFor(context: PortionContext | null | undefined): string | null {
  if (!context) return null
  const { absolutePortionConfidence: confidence, scaleReferenceAvailable } = context
  if (confidence !== 'low' && confidence !== 'unknown') return null
  return scaleReferenceAvailable
    ? 'Portion size is a rough guess'
    : 'Portion size is a guess — no scale in photo'
}

// -- The model's one high-impact question ---------------------------------------

/** Structural slice shouldShowModelQuestionCard needs. */
export interface ModelQuestionInput {
  highImpactQuestion?: ModelHighImpactQuestion | null
}

/**
 * Question-text normalization for duplicate detection: lowercase, punctuation
 * to spaces, whitespace collapsed. Punctuation is stripped (not preserved) so
 * "pizza?" and "pizza" are the same token on BOTH sides of the comparison.
 */
function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The suppression threshold: an active chip covering this share of the model question's tokens suppresses the card. */
const QUESTION_DUPLICATE_THRESHOLD = 0.6

/**
 * Whether the model's high-impact question card should render.
 *
 * FALSE only when the question is absent/empty, or when an already-rendered
 * question chip (3-b promotes keyword matches from the bank) covers ≥60% of
 * the model question's normalized tokens — the same question must not appear
 * twice on one screen, once as a chip and once as a card. Coverage is
 * token-SET membership, not raw substring: "in" inside "cooking" must not
 * count as covering the token "in", which would over-suppress. A chip that
 * normalizes to nothing cannot suppress anything; the card's own option list
 * is irrelevant to the decision.
 */
export function shouldShowModelQuestionCard(
  result: ModelQuestionInput,
  activeChipQuestions: ReadonlyArray<string>,
): boolean {
  const q = result.highImpactQuestion
  if (!q) return false
  const tokens = normalizeQuestionText(q.question).split(' ').filter((t) => t !== '')
  if (tokens.length === 0) return false
  for (const chip of activeChipQuestions) {
    const chipTokens = new Set(normalizeQuestionText(chip).split(' ').filter((t) => t !== ''))
    if (chipTokens.size === 0) continue
    let covered = 0
    for (const token of tokens) {
      if (chipTokens.has(token)) covered++
    }
    if (covered / tokens.length >= QUESTION_DUPLICATE_THRESHOLD) return false
  }
  return true
}

// -- Per-row preparation signal --------------------------------------------------

/**
 * The per-row preparation subtitle fragment, or null.
 *
 * Only a stated addedCookingFat of 'moderate' | 'heavy' earns the note — the
 * model is claiming the dish was likely cooked WITH meaningful added fat,
 * which a per-100 g snapshot cannot see. 'none' and 'light' earn honest
 * silence, 'unknown' explicitly claims nothing, and an absent preparation
 * block means the model said nothing at all — no note is invented.
 *
 * RENDER CONTRACT with result.tsx: the row's provenance subtitle chain keeps
 * its 2-d order (web citation → sourceAttribution → Confirmed → AI ESTIMATE →
 * the warning-icon Estimated line) as its ONE subtitle line; this fragment renders as an
 * ADDITIONAL muted micro line directly under it, never replacing it. The prep
 * fact is about THIS meal's cooking; every chain entry is about where the
 * per-100 g data came from or who owns the grams — different facts, so one
 * never suppresses the other (suppressing "likely cooked in oil/ghee" behind
 * a citation would hide exactly the fat the snapshot cannot see).
 */
export function preparationNoteFor(row: IngredientRowV13): string | null {
  const fat = row.preparation?.addedCookingFat
  if (fat !== 'moderate' && fat !== 'heavy') return null
  return '· likely cooked in oil/ghee'
}

// -- UI/UX report §8.4 (Wave 3): confidence you can see -------------------------
//
// "Confidence chips get a legend on first appearance, uncertain rows show the
// reason inline instead of behind a tap." Both rulings are decisions, so they
// live here next to every other result-screen ruling, node-pure and tested.

/** Settings key persisting the legend dismissal (survives restarts). */
export const CONFIDENCE_LEGEND_SETTING_KEY = 'confidence_legend_dismissed'

/**
 * The legend gate. `stored` is the raw settings value ('1' = dismissed).
 * Anything else — including null/undefined (never read) — shows the legend:
 * the one-time explanatory line is the DEFAULT, and only an explicit
 * dismissal hides it.
 */
export function shouldShowConfidenceLegend(stored: string | null | undefined): boolean {
  return stored !== '1'
}

/**
 * The first reason an uncertain row shows INLINE (§8.4: "the reason inline
 * instead of behind a tap"), or null when the band is confident enough that
 * an inline reason would be noise. 'tight' bands are excluded deliberately:
 * the chip still offers its tap-for-range, but a near-label band whose
 * reason reads aloud trains people to ignore the signal — the same ruling
 * ConfidenceChip already makes for tier 'none'. Only the FIRST reason shows;
 * the chip's tap expands the full list.
 */
const INLINE_REASON_TIERS: ReadonlySet<BandTier> = new Set(['moderate', 'wide', 'very_wide'])

export function inlineUncertaintyReason(band: Band): string | null {
  if (!INLINE_REASON_TIERS.has(band.tier)) return null
  return band.reasons[0] ?? null
}

/**
 * How many skeleton ingredient rows the analyzing state shows — the list
 * GROWS as the pipeline advances (§8.4: "a skeleton ingredient list builds
 * while the model works"), anchored to the real stage, never a fake timer:
 * 'preparing' has nothing identified yet, 'identifying' has found half the
 * plate, 'matching' is close to the full list. The last row renders shorter
 * (see result.tsx) so a growing list reads as filling, not appending.
 */
export function analyzingSkeletonRowCount(
  stage: 'preparing' | 'identifying' | 'matching',
): number {
  switch (stage) {
    case 'preparing':
      return 2
    case 'identifying':
      return 4
    case 'matching':
      return 6
  }
}
