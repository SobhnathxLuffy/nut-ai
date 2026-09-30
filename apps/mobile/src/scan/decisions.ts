import type { IngredientRow } from '@nutai/core-schema'
import type { ProviderId } from '@nutai/prompt'

/**
 * Pure per-scan decision logic (QA Wave 4, P2-37).
 *
 * orchestrator.ts is 763 lines of glue with four 100+-line scan functions —
 * the highest-risk coordination code in the app, and until now it had ZERO
 * direct tests because every decision was welded to its I/O. This module
 * extracts the decisions that route a scan (mode gating, refinement target
 * selection, meta merging, barcode next-step) as PURE functions: same input,
 * same output, no store writes, no fetch, no clock. The orchestrator keeps the
 * I/O and calls these; decisions.test.ts pins the contract.
 */

// ---------------------------------------------------------------------------
// Provider / credential gating (photo scan entry)
// ---------------------------------------------------------------------------

export type ProviderGateFailure = {
  ok: false
  failureKind: 'no-key' | 'key-invalid'
  message: string
  canRetry: false
}

/**
 * The gate every model-backed scan passes first: a named provider with a
 * saved credential, or an honest failure phase. A missing key is DIFFERENT
 * from a rejected key — the first is "add one", the second is "re-enter it".
 */
export function gateScanProvider<C extends { value: string }>(
  providerSetting: string | null | undefined,
  credential: C | null | undefined,
): { ok: true; provider: ProviderId; credential: C } | ProviderGateFailure {
  const provider = providerSetting as ProviderId | 'none' | '' | null | undefined
  if (!provider || provider === 'none') {
    return {
      ok: false,
      failureKind: 'no-key',
      message:
        'Photo scans need an API key. Add one in Profile — barcode, search and manual logging work without one.',
      canRetry: false,
    }
  }
  if (!credential || !credential.value) {
    return {
      ok: false,
      failureKind: 'key-invalid',
      message: 'Your saved key is missing. Re-enter it in Profile.',
      canRetry: false,
    }
  }
  return { ok: true, provider, credential }
}

// ---------------------------------------------------------------------------
// Preprocess failure diagnosis (QA P1-4)
// ---------------------------------------------------------------------------

export type PreprocessFailure = { message: string; canRetry: boolean }

/**
 * ANY throw inside the preprocess stage used to be diagnosed as "could not
 * read the photo" with retry disabled — the exact mechanism that mislabeled
 * the thali RangeError, guaranteed to recur invisibly under a new root cause.
 * Branch on the error shape instead (pure, so decisions.test.ts pins it):
 *
 *  - RangeError / string-length / allocation errors: the photo is too large
 *    for this device's JS engine to process. Retrying the same photo fails
 *    the same way, so retry stays disabled — but the diagnosis is honest.
 *  - Decode-shaped errors (atob InvalidCharacterError, malformed data):
 *    keep the established "could not read the photo" copy, no retry.
 *  - Everything else (transient native/imagemanipulator failures): retrying
 *    may genuinely work, so offer the retry.
 *
 * The caller ALWAYS logs the raw error alongside — the silent part of the
 * original bug was as damaging as the mislabel.
 */
export function describePreprocessFailure(err: unknown): PreprocessFailure {
  // Native bridges and cross-realm throws do not always produce real Error
  // instances — read name/message defensively off whatever shape arrived.
  const name = typeof (err as { name?: unknown } | null)?.name === 'string' ? (err as { name: string }).name : ''
  const rawMsg = (err as { message?: unknown } | null)?.message
  const msg = typeof rawMsg === 'string' ? rawMsg : String(err)
  if (name === 'RangeError' || /string length|invalid array length|allocation failed/i.test(msg)) {
    return {
      message: 'This photo is too large for this device to process. Try a smaller or lower-quality photo.',
      canRetry: false,
    }
  }
  if (name === 'InvalidCharacterError' || /decod|malformed|unsupported|corrupt|not a valid/i.test(msg)) {
    return { message: 'Could not read the photo. Try taking it again.', canRetry: false }
  }
  return { message: 'Preparing the photo failed unexpectedly. Try again.', canRetry: true }
}

// ---------------------------------------------------------------------------
// One-shot instruction-schema retry (degraded-answer rescue)
// ---------------------------------------------------------------------------

/** The minimal outcome view the retry decision needs (ScanOutcome | failure). */
export type ScanAttemptView =
  | { ok: true; payloadUsable: boolean }
  | { ok: false; failureKind: string; retryable: boolean }

/** Was the first attempt sent WITH a json_schema (vs the instruction fallback)? */
export type ScanSchemaMode = 'json-schema' | 'instruction'

/**
 * Should the scan re-run ONCE with the schema shipped as prompt text?
 *
 * Historically only a structural HTTP 400 re-ran the scan without structured
 * output. But gateways can also fail SOFTLY: a 200 whose content is empty or
 * prose (response_format silently dropped), or a payload too broken for even
 * the repair layer to normalize. Those all surfaced as "the model answered in
 * a shape we could not use" with nothing but a manual retry — which repeated
 * the identical request and failed identically. This decision turns that dead
 * end into one automatic re-ask that FORCES the field contract as text.
 *
 * 'truncated' is covered too: a length-cut answer is a BUDGET failure, not a
 * shape failure — re-asking with the identical budget would truncate again,
 * but the rescue goes through runScanWithFallback, whose internal escalation
 * gives the retry a doubled (capped) budget. Sending the schema as
 * instruction text on that retry also costs nothing structurally (a thinking
 * model has no structured-output problem to begin with) and keeps the field
 * contract in front of the model while it has room to finish.
 *
 * Never retries when the first attempt already ran without a json_schema (the
 * retry would be a third identical billing), and never retries a transport
 * failure the user can actually fix (401, offline, timeout).
 */
export function shouldRetryWithInstructionSchema(
  attempt: ScanAttemptView,
  mode: ScanSchemaMode,
): boolean {
  if (mode !== 'json-schema') return false
  if (attempt.ok) return !attempt.payloadUsable
  if (attempt.failureKind === 'truncated') return true
  return attempt.failureKind === 'schema-violation'
}

// ---------------------------------------------------------------------------
// Scan meta merging (fix-scan re-analysis)
// ---------------------------------------------------------------------------

export interface ScanMeta {
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  /** P2-9: null = a custom model whose catalogue price is unknown. */
  costUsd: number | null
  promptVersion: string
}

/**
 * A fix re-analysis rides on top of the original call, so its tokens ADD.
 * Cost propagates null: one unknown-cost call makes the meal's total unknown —
 * null must never quietly read as free. (P2-9; the shipped code previously
 * contradicted its own comment by summing a known fix cost over an unknown
 * original — the contract tests caught it and the documented principle won.)
 * A null PRIOR means "no prior call" — the new cost simply stands.
 *
 * THE BUG THE TESTS MISSED (reproduced live, web :3000): the wave-4 rewrite
 * evaluated `prior!.costUsd` even when prior WAS null — every FIRST scan with
 * a catalogue-priced model threw TypeError at the ready step, because the
 * only null-prior test also used an unknown cost (which short-circuits to
 * null before the addition). The prior==null + known-cost case is the single
 * most common merge in the app, and it is pinned first below now.
 */
export function mergeScanMeta(
  prior: Pick<ScanMeta, 'inputTokens' | 'outputTokens' | 'costUsd'> | null,
  next: ScanMeta,
): ScanMeta {
  const costKnown = next.costUsd != null && (prior == null || prior.costUsd != null)
  return {
    provider: next.provider,
    model: next.model,
    inputTokens: next.inputTokens + (prior?.inputTokens ?? 0),
    outputTokens: next.outputTokens + (prior?.outputTokens ?? 0),
    costUsd: !costKnown ? null : (prior?.costUsd ?? 0) + (next.costUsd ?? 0),
    promptVersion: next.promptVersion,
  }
}

// ---------------------------------------------------------------------------
// Background refinement target selection
// ---------------------------------------------------------------------------

/** How many corpus misses we will pay to look up per scan. */
export const MAX_LOOKUPS_PER_SCAN = 2

/**
 * Two triggers, in row order, capped: the corpus missed entirely, or the model
 * saw a BRAND (a logo counts — golden arches on the wrapper). A branded item
 * that matched some generic corpus row still deserves the brand's own
 * published numbers.
 */
export function selectRefinementTargets(
  items: ReadonlyArray<{ resolution: string; row: { id: string } }>,
  payloadItems: ReadonlyArray<{ brand?: string | null } | null | undefined> | null,
  max: number = MAX_LOOKUPS_PER_SCAN,
): number[] {
  const targets = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item.resolution === 'miss' || payloadItems?.[index]?.brand != null)
    .map(({ index }) => index)
    .slice(0, max)
  return targets
}

/** A lookup with exactly one option and no open question applies itself. */
export function isUnambiguousLookup(result: { found: boolean; options: readonly unknown[]; question?: string | null }): boolean {
  return result.found && result.options.length === 1 && !result.question
}

// ---------------------------------------------------------------------------
// Barcode routing
// ---------------------------------------------------------------------------

export interface BarcodeCorpusFood {
  name: string
  foodId: string | null
  servingSizeG: number | null
  energyKcal: number | null
  source: string
}

export type BarcodeRoute =
  /** Corpus GTIN hit with usable energy — the zero-cost path, no model call. */
  | { step: 'corpus-ready'; source: string }
  /** Corpus miss (or hit with no energy) and NO credential — honest pointer
   * at the label scanner, which works without a key. */
  | { step: 'need-label-mode' }
  /** Corpus miss with a credential — one server-side search attempt. */
  | { step: 'try-web-lookup' }

/**
 * The barcode 3-step flow's routing decision, pure: decoded GTIN → offline
 * corpus lookup → only on miss (with means) → one AI lookup. A reseller
 * gateway never gets a "search" promise — the lookup builder downgrades to
 * plain completions upstream; the ROUTE is unchanged, the honesty lives in
 * the transport.
 */
export function planBarcodeScan(corpusFood: BarcodeCorpusFood | null, hasCredential: boolean): BarcodeRoute {
  if (corpusFood && corpusFood.energyKcal != null) {
    return { step: 'corpus-ready', source: corpusFood.source }
  }
  if (!hasCredential) return { step: 'need-label-mode' }
  return { step: 'try-web-lookup' }
}

/** The failure phase when the corpus missed and no key exists. */
export const BARCODE_NO_KEY_FAILURE = {
  kind: 'failed' as const,
  photoUri: '',
  message:
    'This barcode is not in the bundled database. The Food label mode reads the printed panel directly and works without a key.',
  canRetry: false as const,
}

/** The failure phase when the corpus missed and the lookup found nothing. */
export const BARCODE_NOT_FOUND_FAILURE = {
  kind: 'failed' as const,
  photoUri: '',
  message:
    'Could not find this barcode in the database or online. Try the Food label mode — it reads the printed panel directly.',
  canRetry: false as const,
}

// ---------------------------------------------------------------------------
// Web lookup option → packaged-exact ingredient row
// ---------------------------------------------------------------------------

export interface WebLookupOption {
  label: string
  serving_g: number | null
  calories_kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number | null
  sodium_mg: number | null
}

/**
 * Convert one web-lookup option into a packaged_exact row. The option's
 * numbers are PER SERVING; the snapshot is per-100 g — scaled by the printed
 * serving weight, which is the exactness the pathway name promises.
 */
export function webOptionToIngredientRow(
  opt: WebLookupOption,
  sourceUrl: string | null,
  now: number,
): IngredientRow {
  const grams = opt.serving_g ?? 100
  const per100 = grams > 0 ? 100 / grams : 0
  return {
    id: `row_${now}`,
    displayName: opt.label,
    sourceFoodId: null,
    grams,
    nutrientSnapshot: {
      kcal: opt.calories_kcal * per100,
      protein_g: opt.protein_g * per100,
      fat_g: opt.fat_g * per100,
      carbs_g: opt.carbs_g * per100,
      fiber_g: opt.fiber_g == null ? null : opt.fiber_g * per100,
      sugar_g: null,
      sodium_mg: opt.sodium_mg == null ? null : opt.sodium_mg * per100,
    },
    origin: 'web_lookup',
    sourceUrl,
    gramPathway: 'packaged_exact',
    bandHalfPct: 0.1,
    isEstimate: false,
    assumptions: [],
  }
}
