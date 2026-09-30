import * as ImageManipulator from 'expo-image-manipulator'
import { SEEDED_BASELINES, type Band } from '@nutai/confidence'
import {
  LabelPayloadZ,
  ReceiptPayloadZ,
  VISION_WIRE_SCHEMA,
  WebLookupResultZ,
  type IngredientRow,
  type LoggedMeal,
} from '@nutai/core-schema'
import type { PersonalPriors } from '@nutai/gram-engine'
import {
  anthropicWireSchema,
  cheapestModel,
  geminiWireSchema,
  openAiWireSchema,
  LABEL_SCAN_PROMPT_VERSION,
  RECEIPT_SCAN_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import { recomputeAfterEdit, runPipeline, validatePayload, payloadValidationIssues, type ScanResult } from '@nutai/pipeline'
import { resolveByBarcode } from '@nutai/resolver'
import { openIfctDb, openNutritionDb } from '../db/expo-adapter'
import { loadFoodDb } from '../db/portions'
import { db, customProviderBaseUrl, setting } from '../data/repo'
import { loadCredential, type StoredCredential } from '../inference/credentials'
import { runLabelScan, runReceiptScan, runScanWithFallback, runWebLookup } from '../inference/pathA/client'
import { applyWebOption, beginScan, currentScanEpoch, getPhase, setPhase, setWebLookup } from './store'
import {
  BARCODE_NOT_FOUND_FAILURE,
  BARCODE_NO_KEY_FAILURE,
  describePreprocessFailure,
  gateScanProvider,
  isUnambiguousLookup,
  MAX_LOOKUPS_PER_SCAN,
  mergeScanMeta,
  planBarcodeScan,
  selectRefinementTargets,
  shouldRetryWithInstructionSchema,
  webOptionToIngredientRow,
} from './decisions'
import { stripJpegMetadataBase64 } from './jpeg-privacy'
import { LOOKUP_TIMEOUT_MS } from '@nutai/prompt'

/**
 * The scan orchestrator — capture in, ready-to-review meal out.
 *
 * This file is the reason the shutter can navigate IMMEDIATELY: everything
 * here runs behind the result screen's progress states, and every exit is a
 * named phase — never a silent dead end. The sequence:
 *
 *   preparing    resize + EXIF-bake + base64 (local, fast)
 *   identifying  the one model call — the only stage that owns wall-clock time
 *   matching     the deterministic pipeline against the bundled USDA corpus
 *   ready        review screen, editable rows
 *   (background) web-search refinement for items the corpus missed
 *
 * D16 note: the refinement stage transcribes published nutrition facts with a
 * source URL. It replaces AI-estimate rows — the weakest rows on the screen —
 * with cited label data, and never touches a row the database already matched.
 */

const EMPTY_PRIORS: PersonalPriors = { get: () => null, containers: new Map() }

/** Kept for retry, so a network blip does not re-run image preprocessing. */
let lastCapture: { photoUri: string; base64: string } | null = null

function wireSchemaFor(provider: ProviderId, keepPatterns: boolean): Record<string, unknown> {
  if (provider === 'anthropic') return anthropicWireSchema(VISION_WIRE_SCHEMA)
  // The official OpenAI endpoint enforces `pattern` in strict mode; unknown
  // reseller dialects may not, so patterns ride the wire only when the scan is
  // NOT pointed at a custom base URL. Reseller drift is handled by the payload
  // repair layer + the instruction-schema retry (see analyze).
  if (provider === 'openai') return openAiWireSchema(VISION_WIRE_SCHEMA, keepPatterns)
  return geminiWireSchema(VISION_WIRE_SCHEMA)
}

export async function preprocess(photoUri: string): Promise<string> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(photoUri)
  // Resize BEFORE encoding — the order is what bounds memory, not the format.
  ctx.resize({ width: 1024 })
  const image = await ctx.renderAsync()
  const saved = await image.saveAsync({
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  })
  if (!saved.base64) throw new Error('preprocess produced no base64')
  // ImageManipulator is an image transform, not our privacy guarantee. Strip
  // every JPEG application metadata segment explicitly and validate the output
  // before this payload can enter any cloud-provider request.
  const sanitizedBase64 = stripJpegMetadataBase64(saved.base64)
  
  // Clean up the resized temporary file since we only need the base64 payload
  import('expo-file-system').then((fs) => fs.deleteAsync(saved.uri, { idempotent: true }).catch(() => {}))
  
  return sanitizedBase64
}

type StorageStepResult<T> = { ok: true; value: T } | { ok: false }

/**
 * P2-7 companion: a settings/credential read that throws must never escape a
 * void-fired scan as an unhandled rejection — that left the result screen
 * spinning on "Preparing…" forever with no diagnosis. Every storage-backed
 * step between the phases is funneled through here: on failure it logs the
 * raw error, lands an honest internal-error phase (unless a newer scan has
 * already superseded this one), and tells the caller to stop.
 */
async function tryStorageStep<T>(
  photoUri: string,
  stale: () => boolean,
  step: () => Promise<T>,
): Promise<StorageStepResult<T>> {
  try {
    return { ok: true, value: await step() }
  } catch (err) {
    console.error('[scan] saved-settings read failed during scan setup', err)
    if (stale()) return { ok: false }
    setPhase({
      kind: 'failed',
      photoUri,
      message:
        'The scan could not read its saved settings — this one is on us, not your photo. Restart the app and try again.',
      canRetry: false,
      failureKind: 'internal-error',
    })
    return { ok: false }
  }
}

export async function startScan(photoUri: string): Promise<void> {
  // P2-7: this run's epoch. A back-out-and-rescan supersedes it; every phase
  // write below is checked against the store's active epoch first.
  const epoch = beginScan()
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch (err) {
    // P1-4: branch on the error shape — a blanket "could not read the photo"
    // here is the exact mechanism that mislabeled the thali RangeError. The
    // raw error is ALWAYS logged, stale or not.
    console.error('[scan] preprocess failed', err)
    if (currentScanEpoch() !== epoch) return
    const failure = describePreprocessFailure(err)
    setPhase({ kind: 'failed', photoUri, message: failure.message, canRetry: failure.canRetry })
    return
  }

  lastCapture = { photoUri, base64 }
  await analyze(photoUri, base64, { epoch })
}

export async function retryScan(): Promise<void> {
  if (!lastCapture) return
  const { photoUri, base64 } = lastCapture
  const epoch = beginScan()
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  await analyze(photoUri, base64, { epoch })
}

interface AnalyzeOpts {
  /** Prepended context for a Fix Result pass. */
  fixBlock?: string
  /** Prior scan's meta, so the ledger bills one meal for both calls. */
  priorMeta?: { inputTokens: number; outputTokens: number; costUsd: number | null } | null
  /** Portion fraction to carry across a fix — user answers survive re-analysis. */
  keepFraction?: number
  /** P2-7: the epoch this analyze loop belongs to; checked before every write. */
  epoch?: number
}

async function analyze(photoUri: string, base64: string, opts: AnalyzeOpts = {}): Promise<void> {
  // P2-7: the whole body is epoch-guarded and wrapped in a catch that always
  // lands a named failed phase — an exception from setting()/loadCredential()
  // used to escape the void-fired startScan as an unhandled rejection and
  // leave the result screen spinning on 'Preparing…' forever.
  const epoch = opts.epoch ?? beginScan()
  const stale = () => epoch !== currentScanEpoch()
  try {
    const providerSetting = await setting('provider')
    if (stale()) return
    const credential =
      providerSetting && providerSetting !== 'none' ? await loadCredential(providerSetting as ProviderId) : null
    if (stale()) return
    // P2-37 (QA Wave 4): the provider/credential gate is a pure decision now
    // (decisions.ts) with its own contract tests.
    const gate = gateScanProvider(providerSetting, credential)
    if (!gate.ok) {
      setPhase({
        kind: 'failed',
        photoUri,
        message: gate.message,
        canRetry: gate.canRetry,
        failureKind: gate.failureKind,
      })
      return
    }
    const provider = gate.provider
    const scanCredential = gate.credential

    const model = (await setting('provider_model')) || cheapestModel(provider).id
    const baseUrl = await customProviderBaseUrl()
    if (stale()) return

    setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
    const jsonSchema = wireSchemaFor(provider, !baseUrl)
    let outcome = await runScanWithFallback({
      provider,
      model,
      credential: scanCredential,
      imagesBase64: [base64],
      localSignalsBlock: opts.fixBlock ?? '',
      jsonSchema,
      baseUrl,
    })
    if (stale()) return

    // Degraded-answer rescue (validate BEFORE opening storage — validation is
    // pure and the DB is irrelevant to the retry decision). A gateway can fail
    // softly: a 200 with empty/prose content (response_format silently
    // dropped), or a payload too broken for the repair layer. Those used to
    // surface as "the model answered in a shape we could not use" whose manual
    // retry repeated the IDENTICAL request. One automatic re-ask with the
    // schema shipped as instruction text forces the field contract instead.
    let payloadUsable = outcome.ok && validatePayload(outcome.value.raw) != null
    if (
      shouldRetryWithInstructionSchema(
        outcome.ok
          ? { ok: true, payloadUsable }
          : { ok: false, failureKind: outcome.error.kind, retryable: outcome.error.retryable },
        outcome.usedSchemaFallback ? 'instruction' : 'json-schema',
      )
    ) {
      console.error(
        '[scan] first answer unusable — one retry with the schema as instruction',
        outcome.ok ? payloadValidationIssues(outcome.value.raw).slice(0, 8) : outcome.error.kind,
      )
      const retried = await runScanWithFallback({
        provider,
        model,
        credential: scanCredential,
        imagesBase64: [base64],
        localSignalsBlock: opts.fixBlock ?? '',
        jsonSchema: null,
        instructionSchema: jsonSchema,
        baseUrl,
      })
      if (stale()) return
      if (retried.ok && validatePayload(retried.value.raw) != null) {
        outcome = retried
        payloadUsable = true
      }
    }
    if (outcome.ok && !payloadUsable) {
      // The raw issues are the ONLY way this failure is diagnosable after the
      // fact — the user-facing copy stays friendly and never changes.
      console.error('[scan] payload failed validation after repair', payloadValidationIssues(outcome.value.raw).slice(0, 12))
    }

    if (!outcome.ok) {
      setPhase({
        kind: 'failed',
        photoUri,
        message: outcome.error.message,
        canRetry: outcome.error.retryable,
        failureKind: outcome.error.kind,
      })
      return
    }

    setPhase({ kind: 'analyzing', photoUri, stage: 'matching' })

    // P2-2: storage open and pipeline run are DIFFERENT failure classes and
    // used to share one catch — a corrupt or not-yet-open SQLite database was
    // diagnosed as 'the model answered in a shape we could not use' with a
    // retry suggestion that deterministically failed. Storage gets its own
    // honest message with no retry suggestion, and the real cause is logged.
    let dbs: {
      nutritionDb: Awaited<ReturnType<typeof openNutritionDb>>
      ifctDb: Awaited<ReturnType<typeof openIfctDb>>
      userDb: Awaited<ReturnType<typeof db>>
      foodDb: Awaited<ReturnType<typeof loadFoodDb>>
    } | null = null
    try {
      const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
      const foodDb = await loadFoodDb(nutritionDb)
      dbs = { nutritionDb, ifctDb, userDb, foodDb }
    } catch (err) {
      console.error('scan storage open failed', err)
      if (stale()) return
      setPhase({
        kind: 'failed',
        photoUri,
        message:
          'The nutrition database could not be opened. Check free storage or restart the app, then try again — your photo is saved.',
        canRetry: false,
        failureKind: 'internal-error',
      })
      return
    }

    let result: ScanResult | null = null
    try {
      result = await runPipeline(
        outcome.value.raw,
        {
          db: dbs.nutritionDb,
          sourceContext: { ifctDb: dbs.ifctDb, userDb: dbs.userDb },
          priors: EMPTY_PRIORS,
          baselines: SEEDED_BASELINES,
          path: 'cloud',
          now: Date.now(),
        },
        dbs.foodDb,
      )
    } catch (err) {
      console.error('scan pipeline failed', err)
      result = null
    }

    if (stale()) return
    if (!result) {
      setPhase({
        kind: 'failed',
        photoUri,
        message: 'The model answered in a shape we could not use. This one is on us — try once more.',
        canRetry: true,
        failureKind: 'schema-violation',
      })
      return
    }

    if (!result.isFood) {
      setPhase({
        kind: 'failed',
        photoUri,
        message: result.refusalReason || 'That photo does not look like food.',
        canRetry: false,
      })
      return
    }

    if (opts.keepFraction != null && opts.keepFraction !== 1) {
      result.meal.portionEatenFraction = opts.keepFraction
      const re = recomputeAfterEdit(result.meal, result.items.map((i) => i.band))
      result = { ...result, totals: re.totals, mealBand: re.mealBand }
    }

    if (stale()) return
    setPhase({
      kind: 'ready',
      photoUri,
      result,
      bands: result.items.map((i) => i.band),
      meta: mergeScanMeta(opts.priorMeta ?? null, {
        provider,
        model,
        inputTokens: outcome.value.inputTokens,
        outputTokens: outcome.value.outputTokens,
        // P2-9: one unknown-cost call makes the meal's total cost unknown —
        // null propagates rather than quietly reading as free.
        costUsd: outcome.value.costUsd,
        promptVersion: outcome.value.promptVersion,
      }),
      webLookups: {},
    })

    // Fire-and-forget: refinement upgrades rows underneath the review screen.
    void refineMisses(result, outcome.value.raw, provider, model, scanCredential, epoch)
  } catch (err) {
    console.error('scan analyze failed', err)
    if (stale()) return
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'Something went wrong inside the app while preparing this scan. This one is on us — try again.',
      canRetry: false,
      failureKind: 'internal-error',
    })
  }
}

/**
 * Background refinement: every item the corpus missed gets one shot at being
 * upgraded from "AI estimate" to "transcribed from the brand's published
 * nutrition facts". One option auto-applies; several become a question card.
 */
async function refineMisses(
  result: ScanResult,
  rawPayload: unknown,
  provider: ProviderId,
  model: string,
  credential: StoredCredential,
  epoch: number,
): Promise<void> {
  const stale = () => epoch !== currentScanEpoch()
  const payload = validatePayload(rawPayload)
  // Two triggers: the corpus missed entirely, or the model saw a BRAND (a logo
  // counts — golden arches on the wrapper). A branded item that matched some
  // generic corpus row still deserves the brand's own published numbers.
  // P2-37: target selection is a pure decision (miss-or-branded, capped).
  const targets = selectRefinementTargets(
    result.items.map((item) => ({ resolution: item.resolution, row: { id: item.row.id } })),
    payload?.items ?? null,
    MAX_LOOKUPS_PER_SCAN,
  )

  await Promise.all(
    targets.map(async (index) => {
      const item = result.items[index]!
      const rowId = item.row.id
      if (stale()) return
      setWebLookup(rowId, { status: 'running' })

      const source = payload?.items[index]
      const baseUrl = await customProviderBaseUrl()
      if (stale()) return
      const lookup = await runWebLookup(
        provider,
        {
          model,
          itemName: source?.name ?? item.row.displayName,
          brand: source?.brand ?? null,
          visualContext: source?.legible_label_text ?? null,
        },
        credential,
        fetch,
        LOOKUP_TIMEOUT_MS,
        baseUrl,
      )
      // P2-7: this scan may have been superseded (back-out-and-rescan) while
      // the lookup was in flight — its results never write into the newer
      // scan's phase.
      if (stale()) return

      if (!lookup.ok) {
        setWebLookup(rowId, { status: 'failed' })
        return
      }
      const parsed = WebLookupResultZ.safeParse(lookup.raw)
      if (!parsed.success || !parsed.data.found || parsed.data.options.length === 0) {
        setWebLookup(rowId, { status: 'failed' })
        return
      }

      setWebLookup(rowId, { status: 'done', result: parsed.data })
      // Unambiguous single match: apply it. The row visibly upgrades from
      // amber AI-estimate to a cited source — that is the payoff moment.
      // P2-4: NEVER when the user hand-edited (or removed) the row while the
      // lookup was in flight — the late response must not silently overwrite
      // their typed grams. The lookup state stays 'done', so the user's edit
      // simply stands.
      if (isUnambiguousLookup(parsed.data)) {
        const cur = getPhase()
        if (cur.kind === 'ready') {
          const row = cur.result.meal.ingredients.find((r) => r.id === rowId)
          if (row && row.userEditedAt == null) {
            applyWebOption(rowId, parsed.data.options[0]!, parsed.data.source_url)
          }
        }
      }
    }),
  )
}

/**
 * Fix Result — free-text correction with a minimal-delta contract.
 *
 * The re-analysis is seeded with the CURRENT ingredient state (including every
 * edit the user already made), and the instruction is explicit that items the
 * correction does not implicate must come back byte-identical. This is what
 * prevents the incumbent's canonical failure: re-analysis that deletes the
 * corrections you already made. Cost is merged so the ledger bills one meal.
 */
export async function fixScan(note: string): Promise<void> {
  const phase = getPhase()
  if (phase.kind !== 'ready' || !lastCapture) return

  const rows = phase.result.meal.ingredients
    .map((r) => `- ${r.displayName}: ${Math.round(r.grams)} g`)
    .join('\n')
  const fixBlock = [
    'FIX REQUEST — the user reviewed your previous analysis of this exact photo and asked for a correction.',
    'The currently accepted analysis:',
    rows,
    `The user's correction: "${note.trim()}"`,
    'Re-emit the FULL JSON payload with ONLY the changes the correction requires.',
    'Every item and gram figure the correction does not implicate must return IDENTICAL to the accepted analysis above — do not re-estimate what the user did not question.',
  ].join('\n')

  const keepFraction = phase.result.meal.portionEatenFraction
  const priorMeta = phase.meta
  const photoUri = phase.photoUri ?? lastCapture.photoUri

  // P2-7: a fix supersedes the scan that produced it — including its in-flight
  // background lookups.
  const epoch = beginScan()
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  await analyze(photoUri, lastCapture.base64, { fixBlock, priorMeta, keepFraction, epoch })
}

// ---------------------------------------------------------------------------
// Barcode and label — the zero-and-near-zero-cost paths
// ---------------------------------------------------------------------------

/**
 * Build a ready phase from rows whose numbers came off a package — a barcode
 * row or a transcribed label. No model grams, no repair questions: the printed
 * serving IS the portion, and the only remaining uncertainty is label rounding.
 */
function readyFromRows(
  rows: IngredientRow[],
  photoUri: string | null,
  engineId: string,
  promptVersion: string | null,
  webLookups: Record<string, import('./store').WebLookupState> = {},
  unresolvedItems: string[] = [],
): void {
  const meal: LoggedMeal = {
    id: `meal_${Date.now()}`,
    loggedAt: new Date().toISOString(),
    ingredients: rows,
    portionEatenFraction: 1,
    engineId,
    promptVersion,
    schemaVersion: null,
    clampFlags: [],
  }
  const bands: Band[] = rows.map((r) => ({
    halfPct: r.bandHalfPct,
    tier: 'tight',
    reasons: [
      r.origin === 'label_ocr'
        ? 'Transcribed from the printed nutrition label'
        : r.origin === 'web_lookup'
          ? 'Transcribed from published nutrition facts'
          : 'Matched by barcode to a labeled product',
    ],
  }))
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  const result: ScanResult = {
    isFood: true,
    refusalReason: null,
    items: rows.map((row, i) => ({
      row,
      band: bands[i]!,
      resolution: 'barcode',
      gramPathway: row.gramPathway,
    })),
    meal,
    totals,
    mealBand,
    questions: [],
    clampFlags: [],
    zeroHitCount: 0,
  }
  setPhase({
    kind: 'ready',
    photoUri,
    result,
    bands,
    meta: null,
    webLookups,
    // P3-A10: receipt items the lookups could not resolve are NAMED on the
    // ready screen — a partial receipt must not quietly lose line items the
    // user photographed. Empty for every other mode.
    unresolvedItems: unresolvedItems.length > 0 ? unresolvedItems : undefined,
  })
}

/**
 * Barcode: corpus GTIN hit costs NOTHING — no model call, no network. A miss
 * falls to one web search when a key exists, and to a clear pointer at the
 * label scanner when it does not.
 */
export async function startBarcodeScan(gtin: string): Promise<void> {
  const epoch = beginScan()
  const stale = () => epoch !== currentScanEpoch()
  setPhase({ kind: 'analyzing', photoUri: '', stage: 'matching' })

  let food: Awaited<ReturnType<typeof resolveByBarcode>> = null
  try {
    const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
    food = await resolveByBarcode(nutritionDb, gtin, { ifctDb, userDb })
  } catch {
    food = null
  }
  if (stale()) return

  // P2-37 (QA Wave 4): the barcode 3-step ROUTE (corpus hit → no-key pointer
  // → one AI lookup) is a pure decision with contract tests in decisions.ts.
  // The corpus-hit row construction stays here — it needs the resolver's food.
  if (food && food.energyKcal != null) {
    const grams = food.servingSizeG ?? 100
    readyFromRows(
      [
        {
          id: `row_${Date.now()}`,
          displayName: food.name,
          sourceFoodId: food.foodId,
          grams,
          nutrientSnapshot: {
            kcal: food.energyKcal,
            protein_g: food.proteinG ?? 0,
            fat_g: food.fatG ?? 0,
            carbs_g: food.carbG ?? 0,
            fiber_g: food.fiberG,
            sugar_g: food.sugarG,
            sodium_mg: food.sodiumMg,
          },
          origin: 'barcode',
          sourceUrl: food.source === 'off' ? `https://world.openfoodfacts.org/product/${gtin}` : null,
          sourceAttribution: food.attribution,
          gramPathway: 'packaged_exact',
          bandHalfPct: 0.05,
          isEstimate: false,
          assumptions: [],
        },
      ],
      null,
      `barcode-${food.source}`,
      null,
    )
    return
  }

  // Not in the corpus. One web search, if we have the means.
  const gotProvider = await tryStorageStep('', stale, () => setting('provider'))
  if (!gotProvider.ok) return
  const providerSetting = gotProvider.value as ProviderId | 'none' | ''
  if (stale()) return
  const gotCredential =
    providerSetting && providerSetting !== 'none'
      ? await tryStorageStep('', stale, () => loadCredential(providerSetting))
      : ({ ok: true, value: null } as const)
  if (!gotCredential.ok) return
  const credential = gotCredential.value
  if (stale()) return
  const route = planBarcodeScan(food, !!credential?.value)
  if (route.step === 'need-label-mode') {
    setPhase(BARCODE_NO_KEY_FAILURE)
    return
  }
  if (!credential || !providerSetting || providerSetting === 'none') return
  const provider = providerSetting

  const gotModel = await tryStorageStep('', stale, () => setting('provider_model'))
  if (!gotModel.ok) return
  const model = gotModel.value || cheapestModel(provider).id
  const gotBaseUrl = await tryStorageStep('', stale, () => customProviderBaseUrl())
  if (!gotBaseUrl.ok) return
  const baseUrl = gotBaseUrl.value
  if (stale()) return
  const lookup = await runWebLookup(
    provider,
    { model, itemName: `the packaged food product with barcode (GTIN/UPC/EAN) ${gtin}`, brand: null },
    credential,
    fetch,
    LOOKUP_TIMEOUT_MS,
    baseUrl,
  )
  if (stale()) return
  const parsed = lookup.ok ? WebLookupResultZ.safeParse(lookup.raw) : null
  const opt = parsed?.success && parsed.data.found ? parsed.data.options[0] : undefined
  if (!opt) {
    setPhase(BARCODE_NOT_FOUND_FAILURE)
    return
  }

  readyFromRows(
    [
      webOptionToIngredientRow(
        opt,
        parsed!.success ? parsed!.data.source_url : null,
        Date.now(),
      ),
    ],
    null,
    'barcode-web',
    null,
  )
}

/**
 * Label scanner: photograph the printed panel, transcribe it, log it as a
 * packaged_exact row. A label with no printed gram weight fails LOUDLY — a
 * guessed serving weight under a 'packaged_exact' pathway would be a lie in
 * the one place the app promises exactness.
 */
export async function startLabelScan(photoUri: string): Promise<void> {
  const epoch = beginScan()
  const stale = () => epoch !== currentScanEpoch()
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch (err) {
    // P1-4: diagnose by error shape, always log — see startScan.
    console.error('[scan] preprocess failed', err)
    if (stale()) return
    const failure = describePreprocessFailure(err)
    setPhase({ kind: 'failed', photoUri, message: failure.message, canRetry: failure.canRetry })
    return
  }
  lastCapture = { photoUri, base64 }

  const gotProvider = await tryStorageStep(photoUri, stale, () => setting('provider'))
  if (!gotProvider.ok) return
  const provider = gotProvider.value as ProviderId | 'none' | ''
  if (stale()) return
  const gotCredential =
    provider && provider !== 'none'
      ? await tryStorageStep(photoUri, stale, () => loadCredential(provider))
      : ({ ok: true, value: null } as const)
  if (!gotCredential.ok) return
  const credential = gotCredential.value
  if (stale()) return
  if (!credential || !provider || provider === 'none') {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'Reading a label needs an API key. Add one in Profile — or find the product by barcode or search instead.',
      canRetry: false,
      failureKind: 'no-key',
    })
    return
  }

  const gotModel = await tryStorageStep(photoUri, stale, () => setting('provider_model'))
  if (!gotModel.ok) return
  const model = gotModel.value || cheapestModel(provider).id
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })

  const baseUrl = await customProviderBaseUrl()
  if (stale()) return
  const outcome = await runLabelScan(provider, { model, imageBase64: base64 }, credential, fetch, LOOKUP_TIMEOUT_MS, baseUrl)
  if (stale()) return
  if (!outcome.ok) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: outcome.error?.message ?? 'The label could not be read.',
      canRetry: outcome.error?.retryable ?? false,
      failureKind: outcome.error?.kind,
    })
    return
  }

  const parsed = LabelPayloadZ.safeParse(outcome.raw)
  if (!parsed.success || parsed.data.per_serving.calories_kcal <= 0) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'That does not look like a legible nutrition label. Get the whole panel in frame, flat and well lit.',
      canRetry: true,
    })
    return
  }
  if (parsed.data.serving_g == null) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'The label was read, but it prints no gram weight for the serving — without it the numbers cannot be scaled honestly. Include the serving-size line in the photo if it has one.',
      canRetry: true,
    })
    return
  }

  const label = parsed.data
  if (stale()) return
  const grams = label.serving_g!
  const per100 = 100 / grams
  const p = label.per_serving
  readyFromRows(
    [
      {
        id: `row_${Date.now()}`,
        displayName: label.product_name ?? 'Labeled item',
        sourceFoodId: null,
        grams,
        nutrientSnapshot: {
          kcal: p.calories_kcal * per100,
          protein_g: p.protein_g * per100,
          fat_g: p.fat_g * per100,
          carbs_g: p.carbs_g * per100,
          fiber_g: p.fiber_g == null ? null : p.fiber_g * per100,
          sugar_g: p.sugar_g == null ? null : p.sugar_g * per100,
          sodium_mg: p.sodium_mg == null ? null : p.sodium_mg * per100,
        },
        origin: 'label_ocr',
        gramPathway: 'packaged_exact',
        bandHalfPct: 0.05,
        isEstimate: false,
        assumptions: [],
      },
    ],
    photoUri,
    'label-scan',
    LABEL_SCAN_PROMPT_VERSION,
  )
}

/**
 * Receipt mode — the meal you didn't photograph.
 *
 * The model transcribes merchant + line items off the paper; every NUMBER then
 * comes from one web lookup per item with the merchant as the brand. Items the
 * lookup cannot resolve are dropped and named in the failure copy rather than
 * logged as zeros — a silent zero-calorie Big Mac is worse than an honest gap.
 */
const MAX_RECEIPT_ITEMS = 8

export async function startReceiptScan(photoUri: string): Promise<void> {
  const epoch = beginScan()
  const stale = () => epoch !== currentScanEpoch()
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch (err) {
    // P1-4: diagnose by error shape, always log — see startScan.
    console.error('[scan] preprocess failed', err)
    if (stale()) return
    const failure = describePreprocessFailure(err)
    setPhase({ kind: 'failed', photoUri, message: failure.message, canRetry: failure.canRetry })
    return
  }
  lastCapture = { photoUri, base64 }

  const gotProvider = await tryStorageStep(photoUri, stale, () => setting('provider'))
  if (!gotProvider.ok) return
  const provider = gotProvider.value as ProviderId | 'none' | ''
  if (stale()) return
  const gotCredential =
    provider && provider !== 'none'
      ? await tryStorageStep(photoUri, stale, () => loadCredential(provider))
      : ({ ok: true, value: null } as const)
  if (!gotCredential.ok) return
  const credential = gotCredential.value
  if (stale()) return
  if (!credential || !provider || provider === 'none') {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'Reading a receipt needs an API key. Add one in Profile.',
      canRetry: false,
      failureKind: 'no-key',
    })
    return
  }
  const gotModel = await tryStorageStep(photoUri, stale, () => setting('provider_model'))
  if (!gotModel.ok) return
  const model = gotModel.value || cheapestModel(provider).id

  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  const baseUrl = await customProviderBaseUrl()
  if (stale()) return
  const outcome = await runReceiptScan(provider, { model, imageBase64: base64 }, credential, fetch, LOOKUP_TIMEOUT_MS, baseUrl)
  if (stale()) return
  if (!outcome.ok) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: outcome.error?.message ?? 'The receipt could not be read.',
      canRetry: outcome.error?.retryable ?? false,
      failureKind: outcome.error?.kind,
    })
    return
  }

  const receipt = ReceiptPayloadZ.safeParse(outcome.raw)
  if (!receipt.success || receipt.data.items.length === 0) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'No food lines found on that receipt. Get the itemized part flat and in focus.',
      canRetry: true,
    })
    return
  }

  setPhase({ kind: 'analyzing', photoUri, stage: 'matching' })
  const merchant = receipt.data.merchant
  const items = receipt.data.items.slice(0, MAX_RECEIPT_ITEMS)

  const looked = await Promise.all(
    items.map(async (item) => ({
      item,
      lookup: await runWebLookup(
        provider,
        { model, itemName: item.name, brand: merchant },
        credential,
        fetch,
        LOOKUP_TIMEOUT_MS,
        baseUrl,
      ),
    })),
  )
  if (stale()) return

  const rows: IngredientRow[] = []
  const webLookups: Record<string, import('./store').WebLookupState> = {}
  const unresolved: string[] = []

  for (const { item, lookup } of looked) {
    const parsed = lookup.ok ? WebLookupResultZ.safeParse(lookup.raw) : null
    const data = parsed?.success && parsed.data.found && parsed.data.options.length > 0 ? parsed.data : null
    if (!data) {
      unresolved.push(item.name)
      continue
    }
    const opt = data.options[0]!
    const grams = (opt.serving_g ?? 100) * item.quantity
    const per100 = grams > 0 ? (100 * item.quantity) / grams : 0
    const rowId = `row_${Date.now()}_${rows.length}`
    rows.push({
      id: rowId,
      displayName: item.quantity > 1 ? `${opt.label} × ${item.quantity}` : opt.label,
      sourceFoodId: null,
      grams,
      nutrientSnapshot: {
        kcal: opt.calories_kcal * per100,
        protein_g: opt.protein_g * per100,
        carbs_g: opt.carbs_g * per100,
        fat_g: opt.fat_g * per100,
        fiber_g: opt.fiber_g == null ? null : opt.fiber_g * per100,
        sugar_g: null,
        sodium_mg: opt.sodium_mg == null ? null : opt.sodium_mg * per100,
      },
      origin: 'web_lookup',
      sourceUrl: data.source_url,
      gramPathway: 'packaged_exact',
      bandHalfPct: 0.1,
      isEstimate: false,
      assumptions: [],
    })
    // Several menu variants → the question card renders under the row.
    if (data.options.length > 1) {
      webLookups[rowId] = { status: 'done', result: data }
    }
  }

  if (rows.length === 0) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: `Read the receipt but could not find nutrition for: ${unresolved.join(', ')}. Add them by search instead.`,
      canRetry: false,
    })
    return
  }

  readyFromRows(rows, photoUri, 'receipt-scan', RECEIPT_SCAN_PROMPT_VERSION, webLookups, unresolved)
}

/**
 * Free-text "Other" answer on a question card: one more search, seeded with
 * what the user typed.
 */
export async function lookupOther(rowId: string, typed: string): Promise<void> {
  try {
    const provider = (await setting('provider')) as ProviderId | 'none' | ''
    if (!provider || provider === 'none') return
    const credential = await loadCredential(provider)
    if (!credential) return
    const model = (await setting('provider_model')) || cheapestModel(provider).id

    setWebLookup(rowId, { status: 'running' })
    const lookup = await runWebLookup(
      provider,
      { model, itemName: typed, brand: null },
      credential,
      fetch,
      LOOKUP_TIMEOUT_MS,
      await customProviderBaseUrl(),
    )
    if (!lookup.ok) {
      setWebLookup(rowId, { status: 'failed' })
      return
    }
    const parsed = WebLookupResultZ.safeParse(lookup.raw)
    if (!parsed.success || !parsed.data.found || parsed.data.options.length === 0) {
      setWebLookup(rowId, { status: 'failed' })
      return
    }
    setWebLookup(rowId, { status: 'done', result: parsed.data })
    if (parsed.data.options.length === 1) {
      // P2-4 companion: the same hand-beats-machine rule refineMisses lives by.
      // A single-option auto-apply must never overwrite a row the user edited
      // while the lookup was in flight — leave the option on the card instead;
      // the user can still tap it.
      const current = getPhase()
      const row =
        current.kind === 'ready' ? current.result.meal.ingredients.find((r) => r.id === rowId) : undefined
      if (row && row.userEditedAt == null) {
        applyWebOption(rowId, parsed.data.options[0]!, parsed.data.source_url)
      }
    }
  } catch (err) {
    // User-initiated (fire-and-forget from the question card) — a storage or
    // network throw must degrade to the card's failed state, never an
    // unhandled rejection.
    console.error('[scan] "Other" lookup failed', err)
    setWebLookup(rowId, { status: 'failed' })
  }
}
