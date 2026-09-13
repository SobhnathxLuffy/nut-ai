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
  EXERCISE_ESTIMATE_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'

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
  timeoutMs?: number
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
  if (/refus|safety|policy/i.test(body)) {
    return { kind: 'content-refusal', message: 'The provider declined to analyze this image.', retryable: false, httpStatus: status }
  }
  return { kind: 'error-retryable', message: `Unexpected response (${status}).`, retryable: true, httpStatus: status }
}

/** Pull the JSON payload out of each provider's differently-shaped envelope. */
function extractPayload(provider: ProviderId, json: unknown): { raw: unknown; inputTokens: number; outputTokens: number } | null {
  const j = json as Record<string, any>
  try {
    if (provider === 'anthropic') {
      const text = j.content?.[0]?.text
      return {
        raw: typeof text === 'string' ? JSON.parse(text) : text,
        inputTokens: j.usage?.input_tokens ?? 0,
        outputTokens: j.usage?.output_tokens ?? 0,
      }
    }
    if (provider === 'openai') {
      const text = j.choices?.[0]?.message?.content
      return {
        raw: typeof text === 'string' ? JSON.parse(text) : text,
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
      }
    }
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text
    return {
      raw: typeof text === 'string' ? JSON.parse(text) : text,
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

  try {
    const res = await fetchImpl(built.url, {
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

  const second = await runScan({ ...req, jsonSchema: null }, fetchImpl)
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
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildLabelScanRequest(provider, input, credential), fetchImpl, timeoutMs)
}

/**
 * Free-text exercise estimate — the one exercise path a model owns, labeled
 * as such in the UI. Text in, {label, duration_min, calories_kcal} out.
 */
export async function runExerciseEstimate(
  provider: ProviderId,
  input: { model: string; description: string; weightKg: number | null },
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
  return postVisionJson(provider, built, fetchImpl, timeoutMs)
}

/** Receipt transcription: same transport, different instruction and validator. */
export async function runReceiptScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildReceiptScanRequest(provider, input, credential), fetchImpl, timeoutMs)
}

async function postVisionJson(
  provider: ProviderId,
  built: { url: string; headers: Record<string, string>; body: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<WebLookupOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(built.url, {
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
): Promise<WebLookupOutcome> {
  const built = buildWebLookupRequest(provider, input, credential)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(built.url, {
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
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string },
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
      url = 'https://api.openai.com/v1/chat/completions'
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
