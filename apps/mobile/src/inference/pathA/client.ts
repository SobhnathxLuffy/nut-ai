import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildExerciseEstimateInstruction,
  buildLabelScanRequest,
  buildOpenAIRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupInstruction,
  buildWebLookupRequest,
  computeScanCost,
  cheapestModel,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
  PROVIDER_MODELS,
  WEB_LOOKUP_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import { withBaseUrl } from '../base-url'

/**
 * Path A — the cloud inference client.
 *
 * SPEC-accuracy-engine.md §3, PLAN.md D10. A thin wrapper over React Native's
 * `fetch`, deliberately NOT the vendor Node SDKs: those assume Node runtime
 * features Hermes does not guarantee. Non-streaming, one request in, one JSON
 * object out — which removes the single largest RN fetch/ReadableStream risk from
 * the core feature.
 *
 * This is the ONLY place in the app that reads an API key, and the key travels to
 * exactly one destination: the provider the user named.
 */

/** One prior assistant-conversation turn, replayed to the provider in order. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Providers differ on message-array constraints (Anthropic requires strictly
 * alternating roles starting with 'user'), and a history assembled from UI
 * state can contain consecutive same-role turns (e.g. a tool-card reply has no
 * text turn). Merging consecutive same-role turns keeps every wire format
 * legal without ever dropping content.
 */
export function normalizeHistory(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const turn of turns) {
    if (!turn.content?.trim()) continue
    const last = out.length > 0 ? out[out.length - 1] : null
    if (last && last.role === turn.role) {
      out[out.length - 1] = { role: last.role, content: `${last.content}\n\n${turn.content}` }
    } else {
      out.push({ role: turn.role, content: turn.content })
    }
  }
  return out
}

/**
 * Six distinct states, never a generic toast.
 *
 * Every one of these gets its own copy and its own retry policy, because "an
 * error occurred" tells a user nothing about whether to wait, pay, re-enter a
 * key, or switch paths.
 */
export type ScanFailureKind =
  | 'key-invalid'
  | 'quota-exhausted'
  | 'model-unavailable'
  | 'error-retryable'
  | 'offline'
  | 'content-refusal'
  | 'schema-violation'
  /**
   * A request that may or may not have been billed. NEVER auto-retried: no
   * provider offers an idempotency key for this endpoint, so a naive retry
   * double-bills the user for one photo.
   */
  | 'timeout-ambiguous'
  /**
   * P2-1: the failure happened INSIDE the app, not on the network — a request
   * the JS engine could not even prepare (oversized base64 payload), or an
   * unexpected local error. Retryable:false: retrying a request that can never
   * succeed burned time and credits on every attempt.
   */
  | 'internal-error'

export interface ScanFailure {
  kind: ScanFailureKind
  message: string
  retryable: boolean
  httpStatus?: number
}

export interface ScanSuccess {
  raw: unknown
  inputTokens: number
  outputTokens: number
  /**
   * P2-9: null when the model id is not in the catalogue (every custom
   * reseller id) — the honest "cost unknown", never a silent 0.
   */
  costUsd: number | null
  latencyMs: number
  promptVersion: string
}

export type ScanOutcome = { ok: true; value: ScanSuccess } | { ok: false; error: ScanFailure }

export interface Credential {
  kind: 'api_key' | 'oauth'
  value: string
}

export interface ScanRequest {
  provider: ProviderId
  model: string
  credential: Credential
  imagesBase64: readonly string[]
  localSignalsBlock: string
  jsonSchema: unknown
  /**
   * The original wire schema, carried ONLY on the structural-400 retry (see
   * runScanWithFallback) so the request can ship it as instruction text while
   * structured-output mode stays off. Ignored when jsonSchema is non-null.
   */
  instructionSchema?: unknown
  timeoutMs?: number
  /** Optional OpenAI-compatible base URL (resellers). Only rewrites OpenAI calls. */
  baseUrl?: string | null
}

const DEFAULT_TIMEOUT_MS = 45_000

function classify(status: number, body: string): ScanFailure {
  if (status === 401 || status === 403) {
    return { kind: 'key-invalid', message: 'That key was rejected by the provider.', retryable: false, httpStatus: status }
  }
  if (status === 402) {
    return { kind: 'quota-exhausted', message: 'Your provider account is out of credit.', retryable: false, httpStatus: status }
  }
  if (status === 404) {
    return { kind: 'model-unavailable', message: 'That model is not available on your account.', retryable: false, httpStatus: status }
  }
  if (status === 429) {
    return { kind: 'error-retryable', message: 'The provider is rate-limiting. Try again shortly.', retryable: true, httpStatus: status }
  }
  if (status >= 500) {
    return { kind: 'error-retryable', message: 'The provider had a server error.', retryable: true, httpStatus: status }
  }
  if (/content_policy|moderation|inappropriate|safety/i.test(body)) {
    return { kind: 'content-refusal', message: 'The provider declined to analyze this image.', retryable: false, httpStatus: status }
  }
  return { kind: 'error-retryable', message: `Unexpected response (${status}).`, retryable: true, httpStatus: status }
}

/**
 * Transport-error taxonomy (P2-1, P3-1). A fetch rejection IS the offline shape
 * on every engine React Native runs — `TypeError: Network request failed` on
 * Hermes, `TypeError: Failed to fetch` on web — so 'offline' stays reserved for
 * exactly that: a fetch rejection without a response. An abort is the
 * may-have-been-billed timeout. A RangeError is the JS engine giving up on the
 * payload itself — our bug, never the network's, and never retryable.
 * Classification is by error TYPE, never by sniffing message text.
 */
export function classifyTransportError(err: unknown): ScanFailure {
  const name = (err as Error)?.name ?? ''
  if (name === 'AbortError') {
    return {
      kind: 'timeout-ambiguous',
      message: 'The request timed out. It may still have been charged, so we will not retry automatically.',
      retryable: false,
    }
  }
  if (name === 'RangeError') {
    return {
      kind: 'internal-error',
      message: 'Something failed inside the app while preparing this request — not the network. This one is on us.',
      retryable: false,
    }
  }
  return { kind: 'offline', message: 'No connection to the provider.', retryable: true }
}

/**
 * Serialize a request body OUTSIDE any transport try/catch (P2-1): a payload
 * the JS engine cannot even stringify (an oversized base64 image) used to be
 * caught by the transport catch and misfiled as 'offline — retry forever'. It
 * is an internal error: nothing was sent, nothing was charged, and retrying
 * cannot help.
 */
export function serializeBody(body: unknown): { ok: true; text: string } | { ok: false; error: ScanFailure } {
  try {
    return { ok: true, text: JSON.stringify(body) }
  } catch (err) {
    console.error('request serialization failed', err)
    return {
      ok: false,
      error: {
        kind: 'internal-error',
        message: 'We could not prepare this request — the photo may be too large. Nothing was sent and nothing was charged.',
        retryable: false,
      },
    }
  }
}

/**
 * The ONE fenced-JSON extractor (P2-10, P2-3): parses clean JSON directly,
 * and on failure strips markdown fences and isolates the outermost braces.
 * Scan, label, receipt, web-lookup and correction paths all share it, so a
 * degraded gateway that wraps its answer in ``` fences costs the same on
 * every path — one fenced reply no longer loses a billed scan.
 */
export function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    // fall through to fence stripping
  }
  const fenced = text.replace(/```(?:json)?/g, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Pull the JSON payload out of each provider's differently-shaped envelope. */
function extractPayload(provider: ProviderId, json: unknown): { raw: unknown; inputTokens: number; outputTokens: number } | null {
  // The content string is whatever the model wrote. With structured-output
  // mode it is clean JSON; in degraded (json_object / instruction-contract)
  // mode it is USUALLY clean — but a malformed payload must read as a shape
  // failure, NOT escape as a thrown parse error and get misfiled as offline
  // by runScan's catch-all.
  const safeParse = (text: unknown): unknown => {
    if (typeof text !== 'string') return text
    // P2-10: the scan path now shares the fenced extractor with the label,
    // receipt and web paths — a fenced reply parses instead of dying.
    const parsed = extractJsonObject(text)
    return parsed === null ? undefined : parsed
  }
  const j = json as Record<string, any>
  try {
    if (provider === 'anthropic') {
      const text = j.content?.[0]?.text
      const raw = safeParse(text)
      if (raw === undefined) return null
      return {
        raw,
        inputTokens: j.usage?.input_tokens ?? 0,
        outputTokens: j.usage?.output_tokens ?? 0,
      }
    }
    if (provider === 'openai') {
      const text = j.choices?.[0]?.message?.content
      const raw = safeParse(text)
      if (raw === undefined) return null
      return {
        raw,
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
      }
    }
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text
    const raw = safeParse(text)
    if (raw === undefined) return null
    return {
      raw,
      inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0,
    }
  } catch {
    return null
  }
}

export async function runScan(req: ScanRequest, fetchImpl: typeof fetch = fetch): Promise<ScanOutcome> {
  const input = {
    model: req.model,
    imagesBase64: req.imagesBase64,
    localSignalsBlock: req.localSignalsBlock,
    jsonSchema: req.jsonSchema,
    instructionSchema: req.instructionSchema,
  }

  const built =
    req.provider === 'anthropic'
      ? buildAnthropicRequest(input, req.credential)
      : req.provider === 'openai'
        ? buildOpenAIRequest(input, req.credential.value)
        : buildGeminiRequest(input, req.credential.value)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const started = Date.now()
  const url = withBaseUrl(built.url, req.baseUrl)
  // P2-1: serialization lives OUTSIDE the transport try — an un-stringifiable
  // body is an internal error, not a network outage.
  const serialized = serializeBody(built.body)
  if (!serialized.ok) return { ok: false, error: serialized.error }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: serialized.text,
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }

    const extracted = extractPayload(req.provider, json)
    if (!extracted || extracted.raw == null) {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned an unexpected shape.', retryable: false } }
    }

    return {
      ok: true,
      value: {
        raw: extracted.raw,
        inputTokens: extracted.inputTokens,
        outputTokens: extracted.outputTokens,
        // Real token counts, never an estimate, so the ledger shows an actual
        // dollar figure rather than a guess.
        costUsd: computeScanCost(req.provider, req.model, extracted.inputTokens, extracted.outputTokens),
        latencyMs: Date.now() - started,
        promptVersion: built.promptVersion,
      },
    }
  } catch (err) {
    // P2-1: the try block contains ONLY fetch and response reads, so anything
    // caught here is transport-shaped. By type, not by message (P3-1).
    return { ok: false, error: classifyTransportError(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The scan with a structural safety net.
 *
 * A provider that rejects our schema DIALECT (a structural 400, before auth or
 * billing) should not brick scanning: the same request is retried once with no
 * structured-output mode at all, relying on the prompt plus client-side Zod.
 * That retry costs nothing extra — a structurally rejected request is never
 * billed. Auth failures (401/403) and everything else pass through untouched.
 */
export async function runScanWithFallback(
  req: ScanRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanOutcome & { usedSchemaFallback?: boolean }> {
  const first = await runScan(req, fetchImpl)
  const structural =
    !first.ok && (first as any).error?.httpStatus === 400 && req.jsonSchema != null
  if (!structural) return first

  // Second attempt: structured-output mode OFF, but the schema ships as TEXT
  // in the instruction (instructionSchema). A degraded scan that still knows
  // the field contract beats a free-form answer that drifts — the drift was
  // exactly what failed client-side Zod on reseller gateways.
  const second = await runScan(
    { ...req, jsonSchema: null, instructionSchema: req.jsonSchema },
    fetchImpl,
  )
  return second.ok ? { ...second, usedSchemaFallback: true } : first
}

/**
 * Nutrition-label transcription: one image in, one LabelPayload-shaped JSON
 * out. No tools, no structured-output mode; validated by the caller.
 */
export async function runLabelScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildLabelScanRequest(provider, input, credential), fetchImpl, timeoutMs, baseUrl)
}

/**
 * Free-text exercise estimate — the one exercise path a model owns, labeled
 * as such in the UI. Text in, {label, duration_min, calories_kcal} out.
 */
export async function runExerciseEstimate(
  provider: ProviderId,
  input: { model: string; description: string; weightKg: number | null; baseUrl?: string | null },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<WebLookupOutcome> {
  const built = buildTextJsonRequest(
    provider,
    { model: input.model, instruction: buildExerciseEstimateInstruction(input.description, input.weightKg) },
    credential,
    EXERCISE_ESTIMATE_PROMPT_VERSION,
  )
  return postVisionJson(provider, built, fetchImpl, timeoutMs, input.baseUrl)
}

/** Receipt transcription: same transport, different instruction and validator. */
export async function runReceiptScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildReceiptScanRequest(provider, input, credential), fetchImpl, timeoutMs, baseUrl)
}

async function postVisionJson(
  provider: ProviderId,
  built: { url: string; headers: Record<string, string>; body: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const url = withBaseUrl(built.url, baseUrl)
  const serialized = serializeBody(built.body)
  if (!serialized.ok) return { ok: false, error: serialized.error }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: serialized.text,
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }

    let out: string | null = null
    if (provider === 'anthropic') {
      const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
      out = texts.length ? texts[texts.length - 1].text : null
    } else if (provider === 'openai') {
      out = j.choices?.[0]?.message?.content ?? null
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned no text.', retryable: false } }
    }

    const parsed = extractJsonObject(out)
    if (parsed == null || typeof parsed !== 'object') {
      return { ok: false, error: { kind: 'schema-violation', message: 'No JSON in the response.', retryable: false } }
    }
    return { ok: true, raw: parsed }
  } catch (err) {
    return { ok: false, error: classifyTransportError(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The web-lookup refinement call — the provider's server-side search tool.
 *
 * No structured-output mode here (it does not compose with search on every
 * provider), so the JSON is fished out of prose defensively: last text block,
 * markdown fences stripped, outermost braces isolated. The caller validates
 * with WebLookupResultZ — this function only transports.
 */
export interface WebLookupOutcome {
  ok: boolean
  raw?: unknown
  error?: ScanFailure
}

export async function runWebLookup(
  provider: ProviderId,
  input: { model: string; itemName: string; brand: string | null; visualContext?: string | null },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  // The OpenAI lookup rides the Responses API, which virtually no reseller
  // proxies (aicredits, OpenRouter: 404). On a custom base URL the same
  // instruction is sent through PLAIN chat completions instead — the model
  // answers from what it reliably knows and is told to say found:false when
  // unsure, which rescues major branded products without ever hallucinating a
  // source. Official-endpoint lookups keep the real server-side search tool.
  const onReseller = provider === 'openai' && !!baseUrl
  const built = onReseller
    ? {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          authorization: `Bearer ${credential.value}`,
          'content-type': 'application/json',
        },
        body: {
          model: input.model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content:
                buildWebLookupInstruction(input) +
                '\n\nYou have NO live search tool in this conversation. Use only product nutrition facts ' +
                'you are highly confident about from training (major brands, chain restaurants, packaged staples). ' +
                'When you are not confident the product matches, set "found" to false. NEVER invent a source_url — set it to null.',
            },
          ],
          response_format: { type: 'json_object' },
        },
        promptVersion: WEB_LOOKUP_PROMPT_VERSION,
      }
    : buildWebLookupRequest(provider, input, credential)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const url = withBaseUrl(built.url, baseUrl)
  const serialized = serializeBody(built.body)
  if (!serialized.ok) return { ok: false, error: serialized.error }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: serialized.text,
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }
    let out: string | null = null
    if (provider === 'anthropic') {
      // Content is a block ARRAY interleaving tool use and text; the answer is
      // the LAST text block, not the first.
      const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
      out = texts.length ? texts[texts.length - 1].text : null
    } else if (provider === 'openai') {
      // Chat-completions shape (official scans AND the reseller fallback above)
      // takes priority; the Responses API shape is the official-endpoint form.
      out =
        j.choices?.[0]?.message?.content ??
        (() => {
          const msg = (j.output ?? []).find((o: any) => o?.type === 'message')
          return msg?.content?.map((c: any) => c?.text ?? '').join('') ?? j.output_text ?? null
        })()
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned no text.', retryable: false } }
    }

    const parsed = extractJsonObject(out)
    if (parsed == null || typeof parsed !== 'object') {
      return { ok: false, error: { kind: 'schema-violation', message: 'No JSON in the response.', retryable: false } }
    }
    return { ok: true, raw: parsed }
  } catch (err) {
    return { ok: false, error: classifyTransportError(err) }
  } finally {
    clearTimeout(timer)
  }
}


import type { CorrectionIntent } from '@nutai/core-schema'
import { loadCredential } from '../credentials'

export async function runCorrectionIntent(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; baseUrl?: string | null; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; intent: CorrectionIntent } | { ok: false; error: ScanFailure }> {
  // P2-3: this call used to have no timeout and no abort — a hung gateway
  // froze the Fix-Result flow forever while the caller awaited it.
  const timeoutMs = req.timeoutMs ?? 30_000
  try {
    const credObj = await loadCredential(req.provider)
    if (!credObj || !credObj.value) {
      return { ok: false, error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false } }
    }
    const cred = credObj.value

    const payload: Record<string, any> = {
      model: req.model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt }
      ],
      response_format: { type: 'json_object' }
    }

    let url = ''
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (req.provider === 'openai') {
      url = withBaseUrl('https://api.openai.com/v1/chat/completions', req.baseUrl)
      headers['Authorization'] = `Bearer ${cred}`
    } else if (req.provider === 'google') {
      // P2-12: the key travels in the x-goog-api-key header — the same shape
      // the scan path already uses — never in the URL query string, where it
      // would land in network-inspector logs, proxies and crash breadcrumbs.
      url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`
      headers['x-goog-api-key'] = cred
      // Google uses a different schema for messages
      payload.messages = undefined as any
      ;(payload as any).contents = [
        { role: 'user', parts: [{ text: req.systemPrompt + "\n\n" + req.userPrompt }] }
      ]
      ;(payload as any).generationConfig = { responseMimeType: "application/json" }
    } else if (req.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages'
      headers['x-api-key'] = cred
      headers['anthropic-version'] = '2023-06-01'
      payload.messages = [{ role: 'user', content: req.userPrompt }]
      ;(payload as any).system = req.systemPrompt
    } else {
      return { ok: false, error: { kind: 'error-retryable', message: 'Unsupported provider', retryable: false } }
    }

    const serialized = serializeBody(payload)
    if (!serialized.ok) return { ok: false, error: serialized.error }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: serialized.text,
        signal: controller.signal,
      })
    } catch (err) {
      // P3-1: classification by error TYPE — an abort is the may-have-been-
      // billed timeout, a RangeError is internal, and a fetch rejection is
      // offline. The old err.message?.includes('fetch') sniffing mislabeled
      // parse failures as network hiccups and invited pointless retries.
      return { ok: false, error: classifyTransportError(err) }
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let json: Record<string, any>
    try {
      json = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false } }
    }

    let rawResult = ''

    if (req.provider === 'openai') {
      rawResult = json.choices?.[0]?.message?.content
    } else if (req.provider === 'google') {
      rawResult = json.candidates?.[0]?.content?.parts?.[0]?.text
    } else if (req.provider === 'anthropic') {
      rawResult = json.content?.[0]?.text
    }

    if (!rawResult) {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned no correction content.', retryable: false } }
    }

    // P2-3: fenced extraction shared with every other path, and a parse miss
    // reads as schema-violation (retryable:false) — the UI offers the billed
    // full re-analysis as an EXPLICIT choice instead of silently re-running it.
    const parsed = extractJsonObject(rawResult)
    if (parsed == null || typeof parsed !== 'object') {
      return { ok: false, error: { kind: 'schema-violation', message: 'The correction answer was not valid JSON.', retryable: false } }
    }
    return { ok: true, intent: parsed as CorrectionIntent }
  } catch (err: any) {
    return { ok: false, error: classifyTransportError(err) }
  }
}

export async function runAssistantChatApi(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; timeoutMs?: number; history?: ChatTurn[]; baseUrl?: string | null; /** P2-8: cross-provider fallbacks join the chain ONLY when this is explicitly set. */ allowCrossProvider?: boolean },
  fetchImpl: typeof fetch = fetch
) {
  // WEB-007 fix: fallback models used to be hardcoded (`gpt-4o`,
  // `claude-3-5-sonnet-20240620`). Dated snapshots silently EXPIRE — the
  // "safe" cross-provider path kept failing with model-unavailable long after
  // the provider retired the snapshot. Fallbacks are now derived from the live
  // catalogue via cheapestModel(), so a model change lands in exactly one
  // place: PROVIDER_MODELS in @nutai/prompt.
  //
  // P2-8: the chain used to hand the request to OTHER providers' cheapest
  // models unconditionally — spending the user's OTHER saved keys on a 429/5xx
  // while the header still showed the configured model. The chain now tries
  // the same provider's cheaper alternates first; cross-provider entries join
  // ONLY when req.allowCrossProvider is explicitly true (the settings opt-in),
  // and any answer that came from a fallback is tagged `answeredVia` so the
  // UI can disclose exactly who answered.
  const sameProvider = [...PROVIDER_MODELS[req.provider]]
    .sort((a, b) => a.approxScanCostUsd - b.approxScanCostUsd)
    .filter((m) => m.id !== req.model)
    .slice(0, 2)
    .map((m) => ({ provider: req.provider as ProviderId, model: m.id }))
  const crossProvider: { provider: ProviderId; model: string }[] = req.allowCrossProvider
    ? (['openai', 'anthropic', 'google'] as ProviderId[])
        .filter((p) => p !== req.provider)
        .map((p) => ({ provider: p, model: cheapestModel(p).id }))
    : []
  const fallbacks: { provider: ProviderId; model: string }[] = [
    { provider: req.provider, model: req.model },
    ...sameProvider,
    ...crossProvider,
  ]
  let primaryError: Awaited<ReturnType<typeof runAssistantChatApiSingle>> | null = null;
  let lastError: Awaited<ReturnType<typeof runAssistantChatApiSingle>> | null = null;
  for (let i = 0; i < fallbacks.length; i++) {
    const res = await runAssistantChatApiSingle({ ...req, provider: fallbacks[i]!.provider, model: fallbacks[i]!.model }, fetchImpl);
    if (res.ok) {
      if (i === 0) return res;
      // A fallback answered: carry the disclosure so the UI can say who
      // actually produced this answer.
      return { ...res, answeredVia: { provider: fallbacks[i]!.provider, model: fallbacks[i]!.model } };
    }
    // A definitive rejection on the PRIMARY (rejected key, unknown model) is
    // the answer — silently retrying on another provider would hide the real
    // problem from the user. Preserve the short-circuit.
    if (i === 0 && (res as any).error?.retryable === false) {
      return res;
    }
    if (i === 0) {
      primaryError = res;
      continue;
    }
    // Chain fix: a fallback provider without a saved key is "unavailable",
    // not "the answer" — skip it and keep trying instead of aborting the
    // whole chain with "No credentials for X".
    if ((res as any).error?.kind === 'key-invalid') {
      continue;
    }
    lastError = res;
  }
  return primaryError || lastError
    || { ok: false, error: { kind: 'error-retryable', message: 'All providers failed', retryable: true } };
}

export async function runAssistantChatApiSingle(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; timeoutMs?: number; history?: ChatTurn[]; baseUrl?: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; text: string; answeredVia?: { provider: ProviderId; model: string } } | { ok: false; error: ScanFailure }> {
  try {
    const credObj = await loadCredential(req.provider)
    if (!credObj || !credObj.value) {
      return { ok: false, error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false } }
    }
    const cred = credObj.value

    // Multi-turn memory: prior turns are replayed before the current user
    // message, normalized per provider. Empty history reproduces the old
    // single-turn payloads byte-for-byte.
    const history = normalizeHistory(req.history ?? [])
    const historyMessages = history.map((t) => ({ role: t.role, content: t.content }))
    const historyContents = history.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    }))

    const payload = {
      model: req.model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...historyMessages,
        { role: 'user', content: req.userPrompt }
      ],
    }

    let url = ''
    let headers: any = {}
    let bodyStr = ''

    if (req.provider === 'openai') {
      url = withBaseUrl('https://api.openai.com/v1/chat/completions', req.baseUrl)
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred}`,
      }
      bodyStr = JSON.stringify(payload)
    } else if (req.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages'
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': cred,
        'anthropic-version': '2023-06-01',
      }
      bodyStr = JSON.stringify({
        model: payload.model,
        system: payload.messages.find((m) => m.role === 'system')?.content,
        messages: payload.messages.filter((m) => m.role !== 'system'),
        // 2048, not 1024: reasoning models spend the budget on thinking before
        // the visible answer starts, and 1024 truncated exactly those answers.
        max_tokens: 2048,
      })
    } else if (req.provider === 'google') {
      // P2-12: key in the x-goog-api-key header, matching the scan and stream
      // paths — never in the URL query string, which leaks into logs.
      url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`
      headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': cred,
      }
      bodyStr = JSON.stringify({
        contents: [
          ...historyContents,
          { role: 'user', parts: [{ text: `${req.systemPrompt}\n\n${req.userPrompt}` }] }
        ],
        generationConfig: { maxOutputTokens: 2048 },
      })
    } else {
      return { ok: false, error: { kind: 'error-retryable', message: 'Unsupported provider', retryable: false } }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), req.timeoutMs || 15000)
    let resp;
    try {
      resp = await fetchImpl(url, { method: 'POST', headers, body: bodyStr, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    const json = await resp.json()

    if (!resp.ok) {
      const isAuth = resp.status === 401 || resp.status === 403;
      return { ok: false, error: { kind: isAuth ? 'key-invalid' : 'error-retryable', message: json?.error?.message || 'API Error', retryable: !isAuth, httpStatus: resp.status } }
    }
    let text = ''
    if (req.provider === 'openai') {
      text = json.choices?.[0]?.message?.content || ''
    } else if (req.provider === 'anthropic') {
      text = json.content?.[0]?.text || ''
    } else if (req.provider === 'google') {
      text = json.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }

    return { ok: true, text }
  } catch (e: any) {
    // Classified by error TYPE, not message sniffing (P3-1). A chat timeout
    // is retryable — unlike a vision scan it is cheap, and the fallback chain
    // exists precisely to absorb it. A RangeError is ours, never the network's.
    if (e?.name === 'AbortError') {
      return { ok: false, error: { kind: 'error-retryable', message: 'The model took too long to answer.', retryable: true } }
    }
    if (e?.name === 'RangeError') {
      return { ok: false, error: { kind: 'internal-error', message: 'Something failed inside the app while preparing this request.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'No connection to the provider.', retryable: true } }
  }
}

/* ------------------------------------------------------------------ *
 * Streaming chat — word-by-word answers with visible reasoning.
 *
 * The scan path stays deliberately non-streaming (one request, one JSON
 * object). The CHATBOT is the opposite: a silent 20-second wait reads as a
 * broken app, and reasoning models spend most of that time thinking. Both
 * problems share one fix — stream.
 *
 * Transport is XMLHttpRequest, NOT fetch: React Native's fetch cannot read an
 * incremental body, while XHR's onprogress hands us growing responseText on
 * every platform (RN, web, Node+undici in tests). The SSE wire formats are
 * parsed per provider into two lanes — visible text and reasoning — because
 * DeepSeek/Qwen/GLM-style gateways put thinking in `reasoning_content`, and
 * showing it is the difference between "it froze" and "it's thinking".
 * ------------------------------------------------------------------ */

export interface SseDelta {
  text?: string
  reasoning?: string
}

/**
 * Pure per-provider SSE delta parser. Fed raw network chunks, returns the
 * deltas they completed. Keeps a trailing-partial-line buffer internally, so
 * chunk boundaries can split anywhere — including mid-JSON.
 */
export function createSseDeltaParser(
  provider: ProviderId,
): (chunk: string) => SseDelta[] {
  let rest = ''

  const deltaFromOpenAi = (obj: any): SseDelta | null => {
    const d = obj?.choices?.[0]?.delta
    if (!d) return null
    const text = typeof d.content === 'string' ? d.content : ''
    // Reasoning lane: DeepSeek (reasoning_content), Qwen/GLM gateways (reasoning).
    const reasoning =
      typeof d.reasoning_content === 'string'
        ? d.reasoning_content
        : typeof d.reasoning === 'string'
          ? d.reasoning
          : ''
    if (!text && !reasoning) return null
    return text ? { text } : { reasoning }
  }

  const deltaFromAnthropic = (obj: any): SseDelta | null => {
    if (obj?.type !== 'content_block_delta') return null
    if (obj.delta?.type === 'text_delta' && typeof obj.delta.text === 'string') return { text: obj.delta.text }
    if (obj.delta?.type === 'thinking_delta' && typeof obj.delta.thinking === 'string') return { reasoning: obj.delta.thinking }
    return null
  }

  const deltasFromGoogle = (obj: any): SseDelta[] => {
    const parts = obj?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return []
    const out: SseDelta[] = []
    for (const p of parts) {
      if (typeof p?.text !== 'string' || !p.text) continue
      // Gemini 2.5 thinking summaries arrive as parts flagged thought: true.
      out.push(p.thought === true ? { reasoning: p.text } : { text: p.text })
    }
    return out
  }

  return (chunk: string): SseDelta[] => {
    rest += chunk
    const deltas: SseDelta[] = []
    let nl: number
    while ((nl = rest.indexOf('\n')) !== -1) {
      const line = rest.slice(0, nl).replace(/\r$/, '')
      rest = rest.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let obj: any
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      if (provider === 'openai') {
        const d = deltaFromOpenAi(obj)
        if (d) deltas.push(d)
      } else if (provider === 'anthropic') {
        const d = deltaFromAnthropic(obj)
        if (d) deltas.push(d)
      } else {
        deltas.push(...deltasFromGoogle(obj))
      }
    }
    return deltas
  }
}

/** Extract (text, reasoning) from a NON-streamed completion body — the path a
 * gateway that ignores stream:true comes back on. */
export function extractFullCompletion(provider: ProviderId, j: any): SseDelta {
  if (provider === 'openai') {
    const msg = j?.choices?.[0]?.message
    return {
      text: typeof msg?.content === 'string' ? msg.content : '',
      reasoning:
        typeof msg?.reasoning_content === 'string'
          ? msg.reasoning_content
          : typeof msg?.reasoning === 'string'
            ? msg.reasoning
            : '',
    }
  }
  if (provider === 'anthropic') {
    let text = ''
    let reasoning = ''
    for (const block of j?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') text += block.text
      if (block?.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking
    }
    return { text, reasoning }
  }
  let text = ''
  let reasoning = ''
  for (const p of j?.candidates?.[0]?.content?.parts ?? []) {
    if (typeof p?.text !== 'string') continue
    if (p.thought === true) reasoning += p.text
    else text += p.text
  }
  return { text, reasoning }
}

export interface AssistantStreamHandlers {
  /** Called on the UI thread for every parsed delta, in arrival order. */
  onDelta?: (d: SseDelta) => void
  /** Filled with an abort function the caller can invoke to cancel the stream. */
  abortRef?: { current: null | (() => void) }
}

export interface AssistantStreamOutcome {
  ok: boolean
  text: string
  reasoning: string
  error?: ScanFailure
  /** True when at least one visible text delta arrived before the failure. */
  partial?: boolean
  /**
   * P2-6: the caller (or the screen going away) aborted this stream before it
   * produced an answer. The caller must NOT fire the legacy fallback call —
   * that would re-request exactly what the user just cancelled, and bill for
   * an answer nobody will read.
   */
  cancelled?: boolean
}

const STREAM_MAX_BYTES = 256_000

/**
 * One streaming chat completion. NO provider fallback chain here — that lives
 * in the caller, which decides between a failed stream and the legacy
 * non-streaming call. XHR, because RN fetch cannot stream.
 */
export async function runAssistantChatApiStream(
  req: {
    provider: ProviderId
    model: string
    systemPrompt: string
    userPrompt: string
    history?: ChatTurn[]
    baseUrl?: string | null
    /** Guards the "no bytes at all" case; streaming itself is unbounded. */
    stallTimeoutMs?: number
  },
  handlers: AssistantStreamHandlers = {},
  xhrFactory: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<AssistantStreamOutcome> {
  const credObj = await loadCredential(req.provider)
  if (!credObj || !credObj.value) {
    return {
      ok: false,
      text: '',
      reasoning: '',
      error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false },
    }
  }
  const cred = credObj.value

  const history = normalizeHistory(req.history ?? [])
  let url = ''
  let headers: Record<string, string> = {}
  let bodyStr = ''

  if (req.provider === 'openai') {
    url = withBaseUrl('https://api.openai.com/v1/chat/completions', req.baseUrl)
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cred}` }
    bodyStr = JSON.stringify({
      model: req.model,
      stream: true,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: req.userPrompt },
      ],
    })
  } else if (req.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': cred,
      'anthropic-version': '2023-06-01',
    }
    bodyStr = JSON.stringify({
      model: req.model,
      system: req.systemPrompt,
      messages: [
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: req.userPrompt },
      ],
      max_tokens: 2048,
      stream: true,
    })
  } else if (req.provider === 'google') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse`
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': cred }
    bodyStr = JSON.stringify({
      contents: [
        ...history.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }],
        })),
        { role: 'user', parts: [{ text: `${req.systemPrompt}\n\n${req.userPrompt}` }] },
      ],
      generationConfig: { maxOutputTokens: 2048 },
    })
  } else {
    return {
      ok: false,
      text: '',
      reasoning: '',
      error: { kind: 'error-retryable', message: 'Unsupported provider', retryable: false },
    }
  }

  return await new Promise<AssistantStreamOutcome>((resolve) => {
    const xhr = xhrFactory()
    const parse = createSseDeltaParser(req.provider)

    let processed = 0
    let text = ''
    let reasoning = ''
    let sawSse = false
    let nonSseBody = ''
    let tooLarge = false
    let settled = false

    const finish = (outcome: AssistantStreamOutcome) => {
      if (settled) return
      settled = true
      if (handlers.abortRef) handlers.abortRef.current = null
      resolve(outcome)
    }

    let stall: ReturnType<typeof setTimeout> | null = null
    // Set just before the stall guard aborts the request, so onabort — which
    // abort() fires synchronously — defers to the stall's own finish() and the
    // real diagnosis is not replaced by 'cancelled'.
    let stallFired = false
    // Arms (or re-arms) the stall timer. Fired whenever NO bytes arrive for
    // stallTimeoutMs — either before the first byte (gateway accepted the
    // connection and went silent) or mid-stream (gateway stalled partway).
    const armStall = () => {
      if (!req.stallTimeoutMs) return
      if (stall) clearTimeout(stall)
      stall = setTimeout(() => {
        stallFired = true
        xhr.abort()
        finish({
          ok: false,
          text,
          reasoning,
          partial: text.length > 0,
          error: {
            kind: 'error-retryable',
            message:
              processed === 0
                ? 'The model did not start answering in time.'
                : 'The answer stalled partway through.',
            retryable: true,
          },
        })
      }, req.stallTimeoutMs)
    }
    armStall()

    if (handlers.abortRef) handlers.abortRef.current = () => xhr.abort()

    xhr.open('POST', url, true)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.responseType = 'text'

    xhr.onprogress = () => {
      if (settled) return
      const full = xhr.responseText
      const chunk = full.slice(processed)
      processed = full.length
      // Re-arm: a fresh stallTimeoutMs window for every received chunk, so
      // mid-stream stalls are covered too, not just the pre-first-byte case.
      armStall()
      if (full.length > STREAM_MAX_BYTES) {
        tooLarge = true
        xhr.abort()
        return
      }
      if (!chunk) return

      if (!sawSse && !nonSseBody) {
        const head = chunk.trimStart()
        // SSE events open with "data:"/"event:" (or a leading ":" comment).
        if (head.startsWith('data:') || head.startsWith('event:') || head.startsWith(':')) {
          sawSse = true
        } else {
          // Plain JSON body — the gateway ignored stream:true. Snapshot the
          // first chunk only; settleFromFullBody parses the accumulated body
          // once load fires. (Assigning AND appending here would double the
          // first chunk — the 'AB' -> 'AAB' bug.)
          nonSseBody = chunk
          return
        }
      }
      if (nonSseBody) {
        nonSseBody += chunk
        return
      }

      for (const d of parse(chunk)) {
        if (d.text) text += d.text
        if (d.reasoning) reasoning += d.reasoning
        handlers.onDelta?.(d)
      }
    }

    const settleFromFullBody = (status: number) => {
      const body = nonSseBody || xhr.responseText
      if (status >= 400) {
        finish({ ok: false, text, reasoning, partial: text.length > 0, error: classify(status, body) })
        return
      }
      let j: any
      try {
        j = JSON.parse(body)
      } catch {
        finish({
          ok: false,
          text,
          reasoning,
          partial: text.length > 0,
          error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false },
        })
        return
      }
      const full = extractFullCompletion(req.provider, j)
      if (full.text) {
        text += full.text
        handlers.onDelta?.({ text: full.text })
      }
      if (full.reasoning) {
        reasoning += full.reasoning
        handlers.onDelta?.({ reasoning: full.reasoning })
      }
      finish({ ok: true, text, reasoning })
    }

    xhr.onload = () => {
      if (stall) {
        clearTimeout(stall)
        stall = null
      }
      if (settled) return
      if (nonSseBody || xhr.status >= 400) {
        settleFromFullBody(xhr.status)
        return
      }
      // Flush any complete final line the stream ended without a newline on.
      for (const d of parse('\n')) {
        if (d.text) text += d.text
        if (d.reasoning) reasoning += d.reasoning
        handlers.onDelta?.(d)
      }
      if (text.length === 0 && reasoning.length === 0) {
        // Some gateways return 200 with an empty stream when the upstream
        // failed. Let the caller fall back rather than render a blank bubble.
        finish({
          ok: false,
          text: '',
          reasoning: '',
          error: { kind: 'schema-violation', message: 'The provider returned an empty stream.', retryable: true },
        })
        return
      }
      finish({ ok: true, text, reasoning })
    }

    xhr.onerror = () => {
      if (stall) {
        clearTimeout(stall)
        stall = null
      }
      finish({
        ok: false,
        text,
        reasoning,
        partial: text.length > 0,
        error: { kind: 'offline', message: 'No connection to the provider.', retryable: true },
      })
    }

    xhr.onabort = () => {
      if (stall) {
        clearTimeout(stall)
        stall = null
      }
      if (settled) return
      // The stall guard aborted: it finishes with the real diagnosis right
      // after abort() returns — do not race it with 'cancelled'.
      if (stallFired) return
      if (tooLarge) {
        finish({
          ok: false,
          text,
          reasoning,
          partial: text.length > 0,
          error: { kind: 'schema-violation', message: 'The answer was too long to receive.', retryable: true },
        })
        return
      }
      // Caller-invoked abort (screen closed / stop pressed): surface as a
      // cancelled stream, keeping whatever already streamed in. The cancelled
      // flag (P2-6) is what stops the caller from re-requesting the identical
      // answer through the legacy non-streaming call.
      finish({
        ok: false,
        text,
        reasoning,
        partial: text.length > 0,
        cancelled: true,
        error: { kind: 'error-retryable', message: 'cancelled', retryable: true },
      })
    }

    xhr.send(bodyStr)
  })
}
