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
import { OpenFoodFactsSource } from '@nutai/nutrition-sources'
import { recomputeAfterEdit, runPipeline, validatePayload, payloadValidationIssues, type ScanResult } from '@nutai/pipeline'
import { normalizeGtin, resolveByBarcode } from '@nutai/resolver'
import { openIfctDb, openNutritionDb } from '../db/expo-adapter'
import { loadFoodDb } from '../db/portions'
import { db, customProviderBaseUrl, setting } from '../data/repo'
import { completePendingMeal, failPendingMeal, markPendingMealStage, retryPendingMeal } from '../data/repo'
import { loadCredential, type StoredCredential } from '../inference/credentials'
import { runLabelScan, runReceiptScan, runScanWithFallback, runWebLookup, type ScanFailure, type ScanFailureKind } from '../inference/pathA/client'
import { applyWebOption, beginScan, currentScanEpoch, getPhase, recordScanModelServerFailure, resetScanModelFailures, setPhase, setScanOutcome, setWebLookup } from './store'
import { deleteLocalFile } from './file-cleanup'
import {
  barcodeFailurePhase,
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

/**
 * P1-2 (QA report Cycle 2): the copy shown when a model has failed with
 * gateway server errors twice in a row. Names the honest escape route — a
 * vision-capable Gemma model — without claiming the app can SEE which models
 * a gateway breaks (only the gateway's own repeated 500s say that).
 */
const VISION_MODEL_HINT =
  'This model may not process photos through your gateway. Try a Gemma vision model like google/gemma-3-12b-it.'

/**
 * P1-2: record a scan failure against its model and decide whether the
 * failure phase should carry model guidance. Only 500-class errors count
 * (auth/quota/offline failures say nothing about vision capability), only
 * through a custom base URL (official endpoints fix their own 500s), and only
 * from the SECOND consecutive failure of the SAME model — one 500 is noise,
 * two is a broken vision path. Retry stays available either way: the user
 * decides.
 */
function modelHintFor(
  error: ScanFailure,
  model: string,
  baseUrl: string | null | undefined,
): string | undefined {
  const isServerError = error.kind === 'error-retryable' && (error.httpStatus ?? 0) >= 500
  if (!isServerError) return undefined
  const streak = recordScanModelServerFailure(model)
  if (!baseUrl || streak < 2) return undefined
  return VISION_MODEL_HINT
}

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
  // (P2-6: modern File API — see file-cleanup.ts).
  void deleteLocalFile(saved.uri)

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

/**
 * The food-scan entry. `opts.mealId` turns this into the OPTIMISTIC flow: the
 * shutter already inserted the meal row (analysis_status='captured') and this
 * run upgrades THAT row in place — queued → analyzing → complete/failed —
 * writing nothing to the shared phase store (food scans no longer route
 * through the result screen, so a second shutter must never strand the first
 * meal, and the store stays coherent for the barcode/label/receipt flows that
 * still render there). Without mealId the legacy result-screen flow runs
 * unchanged.
 */
export async function startScan(photoUri: string, opts: { mealId?: number } = {}): Promise<void> {
  // P2-7: this run's epoch. A back-out-and-rescan supersedes it; every phase
  // write below is checked against the store's active epoch first.
  const epoch = beginScan()
  if (opts.mealId == null) setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch (err) {
    // P1-4: branch on the error shape — a blanket "could not read the photo"
    // here is the exact mechanism that mislabeled the thali RangeError. The
    // raw error is ALWAYS logged, stale or not.
    console.error('[scan] preprocess failed', err)
    if (opts.mealId != null) {
      await failPendingMeal(opts.mealId).catch((e) => console.error('[scan] failed-mark failed', e))
      return
    }
    if (currentScanEpoch() !== epoch) return
    const failure = describePreprocessFailure(err)
    setPhase({ kind: 'failed', photoUri, message: failure.message, canRetry: failure.canRetry })
    return
  }

  lastCapture = { photoUri, base64 }
  await analyze(photoUri, base64, { epoch, mealId: opts.mealId })
}

/**
 * The failed scan card's Retry: re-arm the DB row (failed → captured) and
 * re-run analysis on the SAME photo the row retained. Nothing is re-photographed
 * and nothing is lost — the retry is the row's own second chance.
 */
export async function retryPendingScan(mealId: number): Promise<void> {
  const photoUri = await retryPendingMeal(mealId).catch((err) => {
    console.error('[scan] re-arming the failed meal failed', err)
    return null
  })
  if (!photoUri) return
  await startScan(photoUri, { mealId })
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
  /** Optimistic flow: the pending meal row this run upgrades in place. */
  mealId?: number
}

async function analyze(photoUri: string, base64: string, opts: AnalyzeOpts = {}): Promise<void> {
  // P2-7: the whole body is epoch-guarded and wrapped in a catch that always
  // lands a named failed phase — an exception from setting()/loadCredential()
  // used to escape the void-fired startScan as an unhandled rejection and
  // leave the result screen spinning on 'Preparing…' forever.
  const epoch = opts.epoch ?? beginScan()
  const mealId = opts.mealId ?? null
  // The optimistic flow owns its DB row outright: its completion is a row
  // UPDATE, not a phase write, so it must survive a second shutter beginning a
  // new epoch. The stale guard stays exactly as P2-7 built it for the
  // result-screen flows (barcode/label/receipt/fix/retry).
  const stale = () => (mealId != null ? false : epoch !== currentScanEpoch())
  // Every named failure exit routes through here: the optimistic flow marks
  // the DB row failed (photo retained, card offers retry/edit/delete); the
  // legacy flow lands the phase on the result screen.
  const landFailure = (failure: {
    message: string
    canRetry: boolean
    failureKind?: ScanFailureKind | 'no-key'
    modelHint?: string
  }) => {
    if (mealId != null) {
      void failPendingMeal(mealId).catch((err) => console.error('[scan] failed-mark failed', err))
      return
    }
    if (stale()) return
    setPhase({ kind: 'failed', photoUri, ...failure })
  }
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
      landFailure({
        message: gate.message,
        canRetry: gate.canRetry,
        failureKind: gate.failureKind,
      })
      return
    }
    const provider = gate.provider
    const scanCredential = gate.credential

    // The stored stage is the pending card's progress copy — a persisted
    // field, never a timer. 'queued' = the model call is running.
    if (mealId != null) await markPendingMealStage(mealId, 'queued').catch(() => {})

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
      landFailure({
        message: outcome.error.message,
        canRetry: outcome.error.retryable,
        failureKind: outcome.error.kind,
        // P1-2 (QA report Cycle 2): honest model guidance once the same model
        // has failed with gateway server errors twice in a row.
        modelHint: modelHintFor(outcome.error, model, baseUrl),
      })
      return
    }
    // The model answered — its vision path works through this gateway, so
    // any P1-2 failure streak it had is over (even if validation below
    // still rejects the payload: a broken ANSWER is not a broken model).
    resetScanModelFailures(model)

    setPhase({ kind: 'analyzing', photoUri, stage: 'matching' })
    // 'analyzing' = the deterministic pipeline is matching and the macros are
    // being computed — the last wait stage before real items land.
    if (mealId != null) await markPendingMealStage(mealId, 'analyzing').catch(() => {})

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
      landFailure({
        message:
          'The nutrition database could not be opened. Check free storage or restart the app, then try again — your photo is saved.',
        canRetry: false,
        failureKind: 'internal-error',
      })
      return
    }

    let result: ScanResult | null = null
    let pipelineError: unknown = null
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
      pipelineError = err
      result = null
    }

    if (stale()) return
    if (!result) {
      // A thrown pipeline error used to be swallowed SILENTLY and then reported
      // with the same copy as an unusable payload — the user's live-reported
      // failure path, with zero diagnosis in either the UI or the logs. Now:
      // the short reason rides the message (bounded, so a giant stack-string
      // cannot flood the failure screen), and the full error plus the raw
      // model answer are warned together exactly once for post-hoc debugging.
      if (pipelineError != null) {
        const reason =
          pipelineError instanceof Error ? pipelineError.message : String(pipelineError)
        console.warn('[scan] pipeline could not use the model answer', pipelineError, outcome.value.raw)
        landFailure({
          message: `The model's answer could not be used (${reason.trim().slice(0, 120) || 'unexpected shape'}). Retrying may help.`,
          canRetry: true,
          failureKind: 'schema-violation',
        })
        return
      }
      landFailure({
        message: 'The model answered in a shape we could not use. This one is on us — try once more.',
        canRetry: true,
        failureKind: 'schema-violation',
      })
      return
    }

    if (!result.isFood) {
      landFailure({
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

    // OPTIMISTIC COMPLETION: the pending row becomes a real logged meal in
    // place — items, per-100 g snapshots, honesty snapshot and cost ledger,
    // one transaction, one operation record (undo removes the whole scan).
    // The highlighted questions ride the in-session outcome map so the card
    // can surface the ONE follow-up that matters (Cal AI pattern #2).
    if (mealId != null) {
      const scanMeta = {
        provider,
        model,
        inputTokens: outcome.value.inputTokens,
        outputTokens: outcome.value.outputTokens,
        costUsd: outcome.value.costUsd,
      }
      // A transient DB failure inside the completion transaction must not
      // cost the user a second MODEL call — one immediate retry, then the
      // guarded fail path (which is a no-op if the row completed anyway).
      const completeOnce = (now: number) =>
        completePendingMeal(mealId, result, scanMeta, now).catch((err) => {
          console.error('[scan] completing the pending meal failed', err)
          return false
        })
      let completed = await completeOnce(Date.now())
      if (!completed) completed = await completeOnce(Date.now() + 1)
      if (completed) {
        // Baselines keyed by name are only unambiguous when the name is unique
        // within the scan; duplicates fall back to the row's own logged grams
        // (the consumer's ?? item.grams) instead of the wrong row's baseline.
        const seen = new Set<string>()
        const uniqueBaseline: Record<string, number> = {}
        for (const r of result.meal.ingredients) {
          if (seen.has(r.displayName)) delete uniqueBaseline[r.displayName]
          else {
            uniqueBaseline[r.displayName] = r.grams
            seen.add(r.displayName)
          }
        }
        setScanOutcome({
          mealId,
          questions: result.questions.filter((q) => q.state === 'highlighted'),
          baselineGrams: uniqueBaseline,
        })
        // The haptic rides a dynamic import on purpose: a static one would
        // pull expo-haptics → react-native into every bare-Node test that
        // imports this module (Rollup cannot parse RN's Flow index.js).
        void (async () => {
          try {
            const { success } = await import('../utils/haptics')
            void success()
          } catch {
            // haptics are optional polish — never a scan outcome
          }
        })()
      } else {
        // The row was cancelled or already upgraded meanwhile — the guarded
        // UPDATE found nothing to change, so nothing gets resurrected.
        await failPendingMeal(mealId).catch(() => {})
      }
      return
    }

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
    landFailure({
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
    // Barcode/label/receipt rows have no vision scene — the package in hand IS
    // the identity. Null (not undefined) so every ScanResult from this module
    // carries a definitive scene value.
    scene: null,
    sceneDisplayName: null,
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

  // T4-a wiring (offline-vs-miss): the router's resolveByBarcode collapses an
  // OFF transport failure into the same null as a genuine miss. On a miss, ask
  // the OFF source directly WHY nothing came back — an unreachable OFF is an
  // offline verdict the failure phases must own (barcodeFailurePhase). The
  // outcome call never throws; the one extra fetch happens only on the miss
  // path, where a verdict is about to be shown anyway.
  let offUnreachable = false
  if (!food) {
    const normalized = normalizeGtin(gtin)
    if (normalized) {
      const outcome = await new OpenFoodFactsSource().resolveByBarcodeOutcome(normalized)
      if (stale()) return
      if (outcome.kind === 'found') food = outcome.food
      else offUnreachable = outcome.kind === 'unreachable'
    }
  }

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
    setPhase(barcodeFailurePhase(offUnreachable, false))
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
    setPhase(barcodeFailurePhase(offUnreachable, true))
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
