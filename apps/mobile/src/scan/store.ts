import type { Band } from '@nutai/confidence'
import type { IngredientRow, LoggedMeal, WebLookupOption, WebLookupResult } from '@nutai/core-schema'
import type { ProviderId } from '@nutai/prompt'
import type { ScanResult } from '@nutai/pipeline'
import { recomputeAfterEdit } from '@nutai/pipeline'
import type { SelectedQuestion } from '@nutai/repair'
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
    }

let phase: ScanPhase = { kind: 'idle' }
const listeners = new Set<() => void>()

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
  if (q.question.id === 'cooking_oil') {
    if (value === 'none') {
      if (phase.kind !== 'ready') return
      const oil = phase.result.meal.ingredients.find((r) => r.origin === 'assumption_filler')
      if (oil) removeRow(oil.id)
    }
    return
  }
  // Remaining answers swap a row's snapshot against a bundled filler food. That
  // lookup belongs to the resolver and is wired at the screen level.
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
    import('expo-file-system').then((fs) => {
      fs.deleteAsync(phase.photoUri!, { idempotent: true }).catch(() => {})
    })
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
