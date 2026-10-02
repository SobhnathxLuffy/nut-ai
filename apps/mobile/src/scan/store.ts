import type { Band } from '@nutai/confidence'
import type { IngredientRow, LoggedMeal, WebLookupOption, WebLookupResult } from '@nutai/core-schema'
import type { ProviderId } from '@nutai/prompt'
import type { ScanResult } from '@nutai/pipeline'
import { recomputeAfterEdit } from '@nutai/pipeline'
import type { SelectedQuestion } from '@nutai/repair'
import { ADDED_FAT_MULTIPLIERS, addedFatMultiplier, wholeDishSizeMultiplier } from '@nutai/repair'
import { countAnswerValue, countMultiplierFor, rowIdForNamedQuestion } from './review'
import { deleteLocalFile } from './file-cleanup'
import { useSyncExternalStore } from 'react'
import type { ScanFailureKind } from '../inference/pathA/client'

/**
 * The in-flight scan.
 *
 * Deliberately a tiny external store rather than a state library: this holds one
 * meal at a time and every mutation is the same operation — edit the rows, then
 * recompute. Adding a dependency for that would be more machinery than the
 * problem has.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: every mutation below runs
 * `recomputeAfterEdit` locally and synchronously. No network call, no database
 * read, no model call. That is what makes correction free, instant, offline, and
 * identical on both inference paths — and it is only possible because every row
 * already carries its own per-100 g snapshot.
 */

/** What the scan cost and where it ran — carried to the ledger at log time. */
export interface ScanMeta {
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  /** P2-9: null = a custom model whose price the catalogue does not know. */
  costUsd: number | null
  promptVersion: string
}

/** Per-row web-search refinement state, keyed by ingredient row id. */
export type WebLookupState =
  | { status: 'running' }
  | { status: 'done'; result: WebLookupResult }
  | { status: 'failed' }

export type ScanPhase =
  | { kind: 'idle' }
  | { kind: 'captured'; photoUri: string }
  | {
      kind: 'analyzing'
      photoUri: string
      /** Which stage, for honest progress copy — never a fake percentage. */
      stage: 'preparing' | 'identifying' | 'matching'
    }
  | {
      kind: 'ready'
      photoUri: string | null
      result: ScanResult
      bands: Band[]
      meta: ScanMeta | null
      webLookups: Record<string, WebLookupState>
      /** P3-A10: receipt line items no lookup could resolve — named, never silently dropped. */
      unresolvedItems?: string[]
    }
  | {
      kind: 'failed'
      photoUri: string
      message: string
      canRetry: boolean
      failureKind?: ScanFailureKind | 'no-key'
      /**
       * P1-2 (QA report Cycle 2): honest model guidance, present ONLY after
       * the same model failed with gateway server (500-class) errors twice in
       * a row through a custom base URL. The retry loop's dead end gets a way
       * out instead of sending the user back into the same 30s failure.
       * Rendered by the result screen below the failure copy in textFaint.
       */
      modelHint?: string
    }

let phase: ScanPhase = { kind: 'idle' }
const listeners = new Set<() => void>()

// --- Per-model consecutive gateway failures (P1-2, QA report Cycle 2) ----
//
// The live case: inclusionai/ling-3.0-flash-vl's vision path is broken
// GATEWAY-SIDE (any image payload → HTTP 500 at the 30s wall; text-only
// completes fine), so a user who picked it retries into the identical
// failure forever and concludes the app is broken. The counter records
// consecutive 500-class scan failures PER MODEL — module-level like the
// phase itself so it survives screen unmounts and scan resets — and any
// successful call with that model clears its streak. Non-500 failures
// (auth, quota, offline) never count: they say nothing about the model's
// vision capability.

const consecutiveServerFailuresByModel = new Map<string, number>()

/** Record one 500-class scan failure for a model; returns the new consecutive count. */
export function recordScanModelServerFailure(model: string): number {
  const next = (consecutiveServerFailuresByModel.get(model) ?? 0) + 1
  consecutiveServerFailuresByModel.set(model, next)
  return next
}

/** A successful call with this model clears its streak — the model CAN see. */
export function resetScanModelFailures(model: string): void {
  consecutiveServerFailuresByModel.delete(model)
}

/** The current consecutive 500-class failure count for a model (0 = healthy). */
export function consecutiveScanModelFailures(model: string): number {
  return consecutiveServerFailuresByModel.get(model) ?? 0
}

/**
 * Grams per row id as the last scan result landed (see setPhase). Kept next to
 * the phase because the multiplier questions need the model's ORIGINAL
 * estimate, which live row grams stop knowing the moment the user edits them.
 */
const scanGramsByRowId = new Map<string, number>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useScan(): ScanPhase {
  return useSyncExternalStore(subscribe, () => phase, () => phase)
}

export function setPhase(next: ScanPhase) {
  phase = next
  // Task 2-d: capture each row's gram estimate as THE SCAN PRODUCED IT. The
  // question bank defines its whole_dish_size / count multipliers on "the
  // item's estimated grams" (question-bank.ts), so a size/count answer
  // rescales from this baseline — which also makes repeated answers IDEMPOTENT
  // (12" then 14" lands at 1.96×, not 1.44 × 1.96×). Rebuilt on every scan
  // landing: fixScan/re-scan rows arrive fresh through this same door. Rows
  // added later (addRow) have no baseline and fall back to their live grams.
  if (next.kind === 'ready') {
    scanGramsByRowId.clear()
    for (const r of next.result.meal.ingredients) scanGramsByRowId.set(r.id, r.grams)
  }
  emit()
}

// --- Scan epochs (P2-7) -----------------------------------------------------
//
// Scans are fired as `void startScan(...)` from the shutter and CANNOT be
// cancelled from the camera side, so back-out-and-rescan lets two analyze
// loops race setPhase — last finisher wins and the UI flickers between
// results. Every scan run begins with beginScan(): a monotonically increasing
// epoch the orchestrator checks before each phase write and each background
// lookup callback. Stale loops bail instead of writing.

let scanEpoch = 0

/** Start a new scan run and return its epoch. Supersedes every older run. */
export function beginScan(): number {
  scanEpoch += 1
  return scanEpoch
}

/** The epoch of the currently-active scan run. */
export function currentScanEpoch(): number {
  return scanEpoch
}

/** Non-hook read for the orchestrator (Fix Result needs the current rows). */
export function getPhase(): ScanPhase {
  return phase
}

/** Every edit path funnels through here, so the invariant holds in exactly one place. */
function mutateMeal(fn: (meal: LoggedMeal) => LoggedMeal) {
  if (phase.kind !== 'ready') return
  const ready = phase
  // P3-A5: bands are parallel to the rows they were SCANNED with. Any
  // add/remove re-indexes the rows, so re-align the bands by row id before
  // recomputing — otherwise a mid-list removal shifts every later band one
  // slot and the meal-level confidence band is computed from the wrong rows.
  // Rows added after the scan (AI repair, manual add) fall back to their own
  // bandHalfPct with the same moderate-tier default the pipeline uses.
  const bandByRowId = new Map(
    ready.result.meal.ingredients.map((r, i) => [r.id, ready.bands[i] as Band | undefined]),
  )
  const meal = fn(ready.result.meal)
  const bands: Band[] = meal.ingredients.map(
    (r) => bandByRowId.get(r.id) ?? { halfPct: r.bandHalfPct, tier: 'moderate' as const, reasons: [] },
  )
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  phase = {
    ...ready,
    bands,
    result: { ...ready.result, meal, totals, mealBand },
  }
  emit()
}

export function editGrams(rowId: string, grams: number) {
  if (!Number.isFinite(grams) || grams < 0) return
  // P2-4: a direct user edit is timestamped on the row. Background web-lookup
  // auto-apply checks this and NEVER overwrites a row the hand has touched —
  // the late network response loses to the user's typed value.
  mutateMeal((meal) => ({
    ...meal,
    ingredients: meal.ingredients.map((r) =>
      r.id === rowId ? { ...r, grams, userEditedAt: Date.now() } : r,
    ),
  }))
}

export function removeRow(rowId: string) {
  // No special-casing "AI-added" versus "user-added" once a row is in the list.
  // There is no data-model difference between "the AI added rice and I removed
  // it" and "I removed rice because I didn't eat it".
  mutateMeal((meal) => ({
    ...meal,
    ingredients: meal.ingredients.filter((r) => r.id !== rowId),
  }))
}

export function addRow(row: IngredientRow) {
  mutateMeal((meal) => ({ ...meal, ingredients: [...meal.ingredients, row] }))
}

export function setPortionEaten(fraction: number) {
  mutateMeal((meal) => ({ ...meal, portionEatenFraction: Math.max(0, Math.min(1, fraction)) }))
}

/**
 * Answering a clarifying chip IS an add/remove/edit operation.
 *
 * "Yes there was oil" pushes an assumption-filler row; "no oil" removes it; "oat
 * milk instead of whole" swaps a row's snapshot. There is no separate code path
 * for questions — the chip UI is a friendly wrapper over the same three
 * primitives, which is what makes the two impossible to get out of sync.
 */
export function answerQuestion(q: SelectedQuestion, value: string) {
  if (q.question.id === 'portion_eaten') {
    const f = Number(value)
    if (Number.isFinite(f)) setPortionEaten(f)
    return
  }
  if (q.question.id === 'thali_scope') {
    // Scene-aware meal-portion question (schema 1.1). Same destination as
    // portion_eaten — the MEAL-level fraction — plus one special mapping:
    // "I'll select items" lands at half the platter with the chip's own
    // disclosure, because the user is heading into per-item edits and some of
    // the platter was definitionally eaten. Zero would quietly claim a fast.
    const f = value === 'select_items' ? 0.5 : Number(value)
    if (Number.isFinite(f)) setPortionEaten(f)
    return
  }
  if (q.question.id === 'cooking_oil') {
    if (value === 'none') {
      if (phase.kind !== 'ready') return
      const oil = phase.result.meal.ingredients.find((r) => r.origin === 'assumption_filler')
      if (oil) removeRow(oil.id)
    }
    return
  }
  // --- Schema 1.2 per-item questions -----------------------------------------
  // These are the first question types whose answer targets ONE row. The
  // SelectedQuestion carries no item id, so the row is recovered from the
  // question's rendered text (see rowIdForNamedQuestion for the matching rule).
  // Both routes funnel through editGrams on purpose: it recomputes totals
  // locally, stamps userEditedAt (the late-lookup guard), and — because the
  // answer IS the user speaking — flips the row's provenance to "Confirmed".
  if (q.question.id === 'whole_dish_size') {
    if (phase.kind !== 'ready') return
    const rowId = rowIdForNamedQuestion(q.text, phase.result.meal.ingredients)
    if (!rowId) return
    const multiplier = wholeDishSizeMultiplier(value)
    // 'know_weight' → null: the user will type the grams themselves, and a
    // guessed 1.0 would silently masquerade as knowledge. The baseline 10"
    // answer (multiplier 1.0) is also a no-op — applying it would edit the row
    // without changing anything and falsely claim user confirmation.
    if (multiplier == null || multiplier === 1) return
    const row = phase.result.meal.ingredients.find((r) => r.id === rowId)
    if (row) {
      // Rescale the ESTIMATE the scan produced (the presumed 10" base), not
      // the live grams — a prior answer or a typed gram must not compound.
      const baseline = scanGramsByRowId.get(rowId) ?? row.grams
      editGrams(rowId, baseline * multiplier)
    }
    return
  }
  if (q.question.id === 'count_question') {
    if (phase.kind !== 'ready') return
    const rowId = rowIdForNamedQuestion(q.text, phase.result.meal.ingredients)
    if (!rowId) return
    const row = phase.result.meal.ingredients.find((r) => r.id === rowId)
    if (!row) return
    const answerCount = countAnswerValue(value)
    if (answerCount == null) return
    const multiplier = countMultiplierFor(row, answerCount)
    if (multiplier == null || multiplier === 1) return
    // Mission formula: model grams × M/N — from the scan baseline, so the
    // answer REPLACES the previous count instead of compounding onto it.
    const baseline = scanGramsByRowId.get(rowId) ?? row.grams
    editGrams(rowId, baseline * multiplier)
    return
  }
  if (q.question.id === 'added_fat') {
    // Schema v1.3 meal-level hidden-fat rescale. The question is about the
    // MEAL's cooking fat, which may span several synthetic rows (two fried
    // dishes); every hidden-fat row rescales from its OWN baseline, and no
    // other row is touched.
    if (phase.kind !== 'ready') return
    const multiplier = addedFatMultiplier(value)
    if (multiplier == null) return
    for (const row of phase.result.meal.ingredients) {
      if (!isHiddenFatRow(row)) continue
      // Baseline = the grams the scan landed the assumption at (never the
      // live grams — a prior answer or typed value must not compound).
      const baseline = scanGramsByRowId.get(row.id) ?? row.grams
      // The level the scan LANDED at is folded into the row (a disclosed
      // 'heavy' row is already base × 1.6). Dividing it back out makes the
      // answers REPLACE the level instead of compounding onto it: confirming
      // 'heavy' on a heavy-landed row is a no-op, not 2.56×. Rows without a
      // disclosure (the engine's cue-triggered rows) ARE the moderate
      // reference — the landed estimate is what the table's 1.0 means.
      const landed = landedAddedFatLevel(row)
      const landedMult = landed != null ? ADDED_FAT_MULTIPLIERS[landed] : undefined
      const reference =
        typeof landedMult === 'number' && landedMult > 0 ? baseline / landedMult : baseline
      const grams = reference * multiplier
      if (!Number.isFinite(grams) || grams < 0) continue
      // 'none' lands at 0 g — the row STAYS (at zero, contributing nothing to
      // totals) rather than being removed, so a later answer can restore it,
      // and confirming the level the scan already landed at is a no-op that
      // never falsely stamps the row Confirmed.
      if (grams === row.grams) continue
      editGrams(row.id, grams)
    }
    return
  }
  // Remaining answers swap a row's snapshot against a bundled filler food. That
  // lookup belongs to the resolver and is wired at the screen level.
}

/** The oil row marker the pipeline sets on every hidden-fat assumption row. */
function isHiddenFatRow(row: IngredientRow): boolean {
  return row.assumptions.some((a) => a.type === 'oil_added')
}

/**
 * The disclosed cooking-fat level the scan landed this row at, read
 * defensively off the schema v1.3 preparation block (the field is optional
 * and its owner lands independently of this store). Null = no disclosure —
 * the engine's heuristic rows have none, and their landed grams ARE the
 * added_fat table's 1.0 reference.
 */
function landedAddedFatLevel(row: IngredientRow): string | null {
  const prep = (row as { preparation?: { addedCookingFat?: unknown } | null }).preparation
  const level = prep != null ? prep.addedCookingFat : undefined
  return typeof level === 'string' && level in ADDED_FAT_MULTIPLIERS && level !== 'none' ? level : null
}

export function setWebLookup(rowId: string, state: WebLookupState) {
  if (phase.kind !== 'ready') return
  phase = { ...phase, webLookups: { ...phase.webLookups, [rowId]: state } }
  emit()
}

/**
 * Apply a web-lookup option: swap the row's snapshot for the transcribed
 * published values. A LOCAL operation — the search already paid for every
 * option's data, so choosing between them costs nothing.
 */
export function applyWebOption(rowId: string, option: WebLookupOption, sourceUrl: string | null) {
  mutateMeal((meal) => ({
    ...meal,
    ingredients: meal.ingredients.map((r) => {
      if (r.id !== rowId) return r
      const grams = option.serving_g ?? r.grams
      // Published values are PER SERVING; the snapshot is per 100 g.
      const per100 = grams > 0 ? 100 / grams : 0
      return {
        ...r,
        displayName: option.label,
        grams,
        nutrientSnapshot: {
          kcal: option.calories_kcal * per100,
          protein_g: option.protein_g * per100,
          fat_g: option.fat_g * per100,
          carbs_g: option.carbs_g * per100,
          fiber_g: option.fiber_g == null ? null : option.fiber_g * per100,
          sugar_g: null,
          sodium_mg: option.sodium_mg == null ? null : option.sodium_mg * per100,
        },
        origin: 'web_lookup' as const,
        sourceUrl,
        // Label-quality numbers: rounding rules plus serving variation, far
        // tighter than a visual estimate but never zero.
        bandHalfPct: 0.1,
        isEstimate: false,
      }
    }),
  }))
}

export function reset(opts?: { retainPhoto?: boolean }) {
  const phase = getPhase()
  if (!opts?.retainPhoto && 'photoUri' in phase && phase.photoUri) {
    // P2-6: modern expo-file-system API (File.exists + File.delete) — see
    // file-cleanup.ts for why the legacy deleteAsync call had to go.
    void deleteLocalFile(phase.photoUri)
  }
  setPhase({ kind: 'idle' })
}

// ---------------------------------------------------------------------------
// Review mode (quick vs advanced)
// ---------------------------------------------------------------------------

export type ScanReviewMode = 'quick' | 'advanced'

/**
 * How the user wants to review scans, chosen on the camera screen and honored
 * by the result screen. Module-level like the phase itself: set once at
 * capture time, read once at result-mount time. The camera persists the
 * preference through settings; this carries the choice across the
 * navigate-to-result hand-off without threading a param through the router.
 */
let reviewMode: ScanReviewMode = 'quick'

export function setScanReviewMode(mode: ScanReviewMode) {
  reviewMode = mode
}

export function getScanReviewMode(): ScanReviewMode {
  return reviewMode
}
