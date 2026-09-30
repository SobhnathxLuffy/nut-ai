import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildExerciseEstimateInstruction,
  buildLabelScanRequest,
  buildOpenAIRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupRequest,
  computeScanCost,
  cheapestModel,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
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
  costUsd: number
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

/** Pull the JSON payload out of each provider's differently-shaped envelope. */
function extractPayload(provider: ProviderId, json: unknown): { raw: unknown; inputTokens: number; outputTokens: number } | null {
  // The content string is whatever the model wrote. With structured-output
  // mode it is clean JSON; in degraded (json_object / instruction-contract)
  // mode it is USUALLY clean — but a malformed payload must read as a shape
  // failure, NOT escape as a thrown parse error and get misfiled as offline
  // by runScan's catch-all.
  const safeParse = (text: unknown): unknown => {
    if (typeof text !== 'string') return text
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
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

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
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
    const aborted = (err as Error)?.name === 'AbortError'
    if (aborted) {
      // The request MAY have been billed. Never auto-retry — no provider offers
      // an idempotency key here, so a retry can double-charge for one photo. The
      // user is told, and chooses.
      return {
        ok: false,
        error: {
          kind: 'timeout-ambiguous',
          message: 'The request timed out. It may still have been charged, so we will not retry automatically.',
          retryable: false,
        },
      }
    }
    return { ok: false, error: { kind: 'offline', message: 'No connection to the provider.', retryable: true } }
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
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
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

    const fenced = out.replace(/```(?:json)?/g, '').trim()
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { ok: false, error: { kind: 'schema-violation', message: 'No JSON in the response.', retryable: false } }
    }
    try {
      return { ok: true, raw: JSON.parse(fenced.slice(start, end + 1)) }
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The response JSON did not parse.', retryable: false } }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout-ambiguous', message: 'The scan timed out.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'No connection to the provider.', retryable: true } }
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
  const built = buildWebLookupRequest(provider, input, credential)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // NOTE: the OpenAI lookup rides the Responses API, which most resellers do
  // not proxy. A reseller 404 here fails gracefully in the background — the
  // scan itself is never affected.
  const url = withBaseUrl(built.url, baseUrl)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
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
      // Responses API: output[] items; the message item holds output_text parts.
      const msg = (j.output ?? []).find((o: any) => o?.type === 'message')
      out = msg?.content?.map((c: any) => c?.text ?? '').join('') ?? j.output_text ?? null
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) {
      return { ok: false, error: { kind: 'schema-violation', message: 'The provider returned no text.', retryable: false } }
    }

    const fenced = out.replace(/```(?:json)?/g, '').trim()
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { ok: false, error: { kind: 'schema-violation', message: 'No JSON in the response.', retryable: false } }
    }
    try {
      return { ok: true, raw: JSON.parse(fenced.slice(start, end + 1)) }
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'The response JSON did not parse.', retryable: false } }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout-ambiguous', message: 'The lookup timed out.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'No connection to the provider.', retryable: true } }
  } finally {
    clearTimeout(timer)
  }
}


import type { CorrectionIntent } from '@nutai/core-schema'
import { loadCredential } from '../credentials'

export async function runCorrectionIntent(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; baseUrl?: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; intent: CorrectionIntent } | { ok: false; error: ScanFailure }> {
  try {
    const credObj = await loadCredential(req.provider)
    if (!credObj || !credObj.value) {
      return { ok: false, error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false } }
    }
    const cred = credObj.value

    const payload = {
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
      url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${cred}`
      // Google uses a different schema for messages
      payload.messages = undefined as any
      ;(payload as any).contents = [
        { role: 'user', parts: [{ text: req.systemPrompt + "\\n\\n" + req.userPrompt }] }
      ]
      ;(payload as any).generationConfig = { responseMimeType: "application/json" }
    } else if (req.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages'
      headers['x-api-key'] = cred
      headers['anthropic-version'] = '2023-06-01'
      payload.messages = [{ role: 'user', content: req.userPrompt }]
      ;(payload as any).system = req.systemPrompt
    }

    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, error: { kind: 'key-invalid', message: 'Invalid API key', retryable: false } }
      return { ok: false, error: { kind: 'error-retryable', message: `Server error: ${res.status}`, retryable: true } }
    }

    const json = await res.json()
    let rawResult = ''
    
    if (req.provider === 'openai') {
      rawResult = json.choices?.[0]?.message?.content
    } else if (req.provider === 'google') {
      rawResult = json.candidates?.[0]?.content?.parts?.[0]?.text
    } else if (req.provider === 'anthropic') {
      rawResult = json.content?.[0]?.text
    }

    if (!rawResult) {
      return { ok: false, error: { kind: 'error-retryable', message: 'No content in response', retryable: true } }
    }

    const parsed = JSON.parse(rawResult)
    return { ok: true, intent: parsed as CorrectionIntent }
  } catch (err: any) {
    if (err.name === 'AbortError' || err.message?.includes('fetch')) {
      return { ok: false, error: { kind: 'offline', message: err.message, retryable: true } }
    }
    return { ok: false, error: { kind: 'error-retryable', message: err.message, retryable: true } }
  }
}

export async function runAssistantChatApi(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; timeoutMs?: number; history?: ChatTurn[]; baseUrl?: string | null },
  fetchImpl: typeof fetch = fetch
) {
  // WEB-007 fix: fallback models used to be hardcoded (`gpt-4o`,
  // `claude-3-5-sonnet-20240620`). Dated snapshots silently EXPIRE — the
  // "safe" cross-provider path kept failing with model-unavailable long after
  // the provider retired the snapshot. Fallbacks are now derived from the live
  // catalogue via cheapestModel(), so a model change lands in exactly one
  // place: PROVIDER_MODELS in @nutai/prompt.
  const fallbacks: { provider: ProviderId, model: string }[] = [
    { provider: req.provider, model: req.model },
    ...(['openai', 'anthropic', 'google'] as ProviderId[])
      .filter((p) => p !== req.provider)
      .map((p) => ({ provider: p, model: cheapestModel(p).id })),
  ];
  let primaryError: Awaited<ReturnType<typeof runAssistantChatApiSingle>> | null = null;
  let lastError: Awaited<ReturnType<typeof runAssistantChatApiSingle>> | null = null;
  for (let i = 0; i < fallbacks.length; i++) {
    const res = await runAssistantChatApiSingle({ ...req, provider: fallbacks[i].provider, model: fallbacks[i].model }, fetchImpl);
    if (res.ok) {
      return res;
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
): Promise<{ ok: true; text: string } | { ok: false; error: ScanFailure }> {
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
        max_tokens: 1024,
      })
    } else if (req.provider === 'google') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${cred}`
      headers = {
        'Content-Type': 'application/json',
      }
      bodyStr = JSON.stringify({
        contents: [
          ...historyContents,
          { role: 'user', parts: [{ text: `${req.systemPrompt}\n\n${req.userPrompt}` }] }
        ]
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
    return { ok: false, error: { kind: 'error-retryable', message: e.message, retryable: true } }
  }
}
