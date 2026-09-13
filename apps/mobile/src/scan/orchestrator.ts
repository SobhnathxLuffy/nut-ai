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
import { recomputeAfterEdit, runPipeline, validatePayload, type ScanResult } from '@nutai/pipeline'
import { resolveByBarcode } from '@nutai/resolver'
import { openIfctDb, openNutritionDb } from '../db/expo-adapter'
import { loadFoodDb } from '../db/portions'
import { db, setting } from '../data/repo'
import { loadCredential, type StoredCredential } from '../inference/credentials'
import { runLabelScan, runReceiptScan, runScanWithFallback, runWebLookup } from '../inference/pathA/client'
import { applyWebOption, getPhase, setPhase, setWebLookup } from './store'

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

function wireSchemaFor(provider: ProviderId): Record<string, unknown> {
  if (provider === 'anthropic') return anthropicWireSchema(VISION_WIRE_SCHEMA)
  if (provider === 'openai') return openAiWireSchema(VISION_WIRE_SCHEMA)
  return geminiWireSchema(VISION_WIRE_SCHEMA)
}

async function preprocess(photoUri: string): Promise<string> {
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
  
  // Clean up the resized temporary file since we only need the base64 payload
  import('expo-file-system').then((fs) => fs.deleteAsync(saved.uri, { idempotent: true }).catch(() => {}))
  
  return saved.base64
}

export async function startScan(photoUri: string): Promise<void> {
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'Could not read the photo. Try taking it again.',
      canRetry: false,
    })
    return
  }

  lastCapture = { photoUri, base64 }
  await analyze(photoUri, base64)
}

export async function retryScan(): Promise<void> {
  if (!lastCapture) return
  const { photoUri, base64 } = lastCapture
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  await analyze(photoUri, base64)
}

interface AnalyzeOpts {
  /** Prepended context for a Fix Result pass. */
  fixBlock?: string
  /** Prior scan's meta, so the ledger bills one meal for both calls. */
  priorMeta?: { inputTokens: number; outputTokens: number; costUsd: number } | null
  /** Portion fraction to carry across a fix — user answers survive re-analysis. */
  keepFraction?: number
}

async function analyze(photoUri: string, base64: string, opts: AnalyzeOpts = {}): Promise<void> {
  const provider = (await setting('provider')) as ProviderId | 'none' | ''
  if (!provider || provider === 'none') {
    setPhase({
      kind: 'failed',
      photoUri,
      message:
        'Photo scans need an API key. Add one in Profile — barcode, search and manual logging work without one.',
      canRetry: false,
      failureKind: 'no-key',
    })
    return
  }

  const credential = await loadCredential(provider)
  if (!credential) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'Your saved key is missing. Re-enter it in Profile.',
      canRetry: false,
      failureKind: 'key-invalid',
    })
    return
  }

  const model = (await setting('provider_model')) || cheapestModel(provider).id

  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  const outcome = await runScanWithFallback({
    provider,
    model,
    credential,
    imagesBase64: [base64],
    localSignalsBlock: opts.fixBlock ?? '',
    jsonSchema: wireSchemaFor(provider),
  })

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

  let result: ScanResult | null = null
  try {
    const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
    const foodDb = await loadFoodDb(nutritionDb)
    result = await runPipeline(
      outcome.value.raw,
      {
        db: nutritionDb,
        sourceContext: { ifctDb, userDb },
        priors: EMPTY_PRIORS,
        baselines: SEEDED_BASELINES,
        path: 'cloud',
        now: Date.now(),
      },
      foodDb,
    )
  } catch {
    result = null
  }

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

  setPhase({
    kind: 'ready',
    photoUri,
    result,
    bands: result.items.map((i) => i.band),
    meta: {
      provider,
      model,
      inputTokens: outcome.value.inputTokens + (opts.priorMeta?.inputTokens ?? 0),
      outputTokens: outcome.value.outputTokens + (opts.priorMeta?.outputTokens ?? 0),
      costUsd: outcome.value.costUsd + (opts.priorMeta?.costUsd ?? 0),
      promptVersion: outcome.value.promptVersion,
    },
    webLookups: {},
  })

  // Fire-and-forget: refinement upgrades rows underneath the review screen.
  void refineMisses(result, outcome.value.raw, provider, model, credential)
}

/** How many corpus misses we will pay to look up per scan. */
const MAX_LOOKUPS_PER_SCAN = 2

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
): Promise<void> {
  const payload = validatePayload(rawPayload)
  // Two triggers: the corpus missed entirely, or the model saw a BRAND (a logo
  // counts — golden arches on the wrapper). A branded item that matched some
  // generic corpus row still deserves the brand's own published numbers.
  const misses = result.items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item, index }) =>
        item.resolution === 'miss' || payload?.items[index]?.brand != null,
    )
    .slice(0, MAX_LOOKUPS_PER_SCAN)

  await Promise.all(
    misses.map(async ({ item, index }) => {
      const rowId = item.row.id
      setWebLookup(rowId, { status: 'running' })

      const source = payload?.items[index]
      const lookup = await runWebLookup(
        provider,
        {
          model,
          itemName: source?.name ?? item.row.displayName,
          brand: source?.brand ?? null,
          visualContext: source?.legible_label_text ?? null,
        },
        credential,
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
      // Unambiguous single match: apply it. The row visibly upgrades from
      // amber AI-estimate to a cited source — that is the payoff moment.
      if (parsed.data.options.length === 1 && !parsed.data.question) {
        applyWebOption(rowId, parsed.data.options[0]!, parsed.data.source_url)
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

  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  await analyze(photoUri, lastCapture.base64, { fixBlock, priorMeta, keepFraction })
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
  setPhase({ kind: 'ready', photoUri, result, bands, meta: null, webLookups })
}

/**
 * Barcode: corpus GTIN hit costs NOTHING — no model call, no network. A miss
 * falls to one web search when a key exists, and to a clear pointer at the
 * label scanner when it does not.
 */
export async function startBarcodeScan(gtin: string): Promise<void> {
  setPhase({ kind: 'analyzing', photoUri: '', stage: 'matching' })

  let food: Awaited<ReturnType<typeof resolveByBarcode>> = null
  try {
    const [nutritionDb, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), db()])
    food = await resolveByBarcode(nutritionDb, gtin, { ifctDb, userDb })
  } catch {
    food = null
  }

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
  const provider = (await setting('provider')) as ProviderId | 'none' | ''
  const credential = provider && provider !== 'none' ? await loadCredential(provider) : null
  if (!credential || !provider || provider === 'none') {
    setPhase({
      kind: 'failed',
      photoUri: '',
      message: 'This barcode is not in the bundled database. The Food label mode reads the printed panel directly and works without a key.',
      canRetry: false,
    })
    return
  }

  const model = (await setting('provider_model')) || cheapestModel(provider).id
  const lookup = await runWebLookup(
    provider,
    { model, itemName: `the packaged food product with barcode (GTIN/UPC/EAN) ${gtin}`, brand: null },
    credential,
  )
  const parsed = lookup.ok ? WebLookupResultZ.safeParse(lookup.raw) : null
  const opt = parsed?.success && parsed.data.found ? parsed.data.options[0] : undefined
  if (!opt) {
    setPhase({
      kind: 'failed',
      photoUri: '',
      message: 'Could not find this barcode in the database or online. Try the Food label mode — it reads the printed panel directly.',
      canRetry: false,
    })
    return
  }

  const grams = opt.serving_g ?? 100
  const per100 = grams > 0 ? 100 / grams : 0
  readyFromRows(
    [
      {
        id: `row_${Date.now()}`,
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
        sourceUrl: parsed!.success ? parsed!.data.source_url : null,
        gramPathway: 'packaged_exact',
        bandHalfPct: 0.1,
        isEstimate: false,
        assumptions: [],
      },
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
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch {
    setPhase({ kind: 'failed', photoUri, message: 'Could not read the photo. Try taking it again.', canRetry: false })
    return
  }
  lastCapture = { photoUri, base64 }

  const provider = (await setting('provider')) as ProviderId | 'none' | ''
  const credential = provider && provider !== 'none' ? await loadCredential(provider) : null
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

  const model = (await setting('provider_model')) || cheapestModel(provider).id
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })

  const outcome = await runLabelScan(provider, { model, imageBase64: base64 }, credential)
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
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch {
    setPhase({ kind: 'failed', photoUri, message: 'Could not read the photo. Try taking it again.', canRetry: false })
    return
  }
  lastCapture = { photoUri, base64 }

  const provider = (await setting('provider')) as ProviderId | 'none' | ''
  const credential = provider && provider !== 'none' ? await loadCredential(provider) : null
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
  const model = (await setting('provider_model')) || cheapestModel(provider).id

  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  const outcome = await runReceiptScan(provider, { model, imageBase64: base64 }, credential)
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
      ),
    })),
  )

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

  readyFromRows(rows, photoUri, 'receipt-scan', RECEIPT_SCAN_PROMPT_VERSION, webLookups)
}

/**
 * Free-text "Other" answer on a question card: one more search, seeded with
 * what the user typed.
 */
export async function lookupOther(rowId: string, typed: string): Promise<void> {
  const provider = (await setting('provider')) as ProviderId | 'none' | ''
  if (!provider || provider === 'none') return
  const credential = await loadCredential(provider)
  if (!credential) return
  const model = (await setting('provider_model')) || cheapestModel(provider).id

  setWebLookup(rowId, { status: 'running' })
  const lookup = await runWebLookup(provider, { model, itemName: typed, brand: null }, credential)
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
    applyWebOption(rowId, parsed.data.options[0]!, parsed.data.source_url)
  }
}
