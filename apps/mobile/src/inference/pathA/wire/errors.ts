import type { ProviderId } from '@nutai/prompt'
import { extractJsonObject } from './json'
import type { ScanFailure } from './types'
import { SCAN_TIMEOUT_MS } from '@nutai/prompt'

/**
 * Shared error taxonomy and payload extraction (QA Wave 4 god-file split).
 *
 * Everything here is provider-AGNOSTIC on purpose: the classification of an
 * HTTP status or a thrown error, and the fenced-JSON contract, are the same
 * no matter which transport produced them.
 */

/** P3-D16: the 45s scan/vision ceiling is named in the shared timeouts module. */
export const DEFAULT_TIMEOUT_MS = SCAN_TIMEOUT_MS

export interface ClassifyOpts {
  /** The credential value. Redacted from any surfaced body text — NEVER logged. */
  secret?: string
  /** The model id, so a gateway rejection can name the model it refused. */
  model?: string
}

/**
 * Remove credential material from provider text before it reaches the UI. A
 * misbehaving gateway can ECHO the request's Authorization header back in its
 * error body — that echo must never survive into a failure message.
 */
export function redactSecrets(text: string, secret?: string): string {
  let out = text
  if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]')
  // Generic shapes too: Bearer headers, OpenAI-style sk- keys, Google AIza keys.
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
  out = out.replace(/(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,})/g, '[redacted]')
  return out
}

/** First ~160 chars of a provider error body, whitespace-flattened, key-free. */
function shortBodySnippet(body: string, secret?: string): string {
  const flat = redactSecrets(String(body ?? ''), secret).replace(/\s+/g, ' ').trim()
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat
}

/**
 * Honest errors: a non-auth failure surfaces the HTTP status AND a short slice
 * of the provider's own error text, so the failure screen says "Gateway
 * rejected model gemini-2.5-flash (HTTP 400): model not found" instead of a
 * generic line that sends the user hunting. Auth failures (401/403) and the
 * billing state (402) stay generic ON PURPOSE: their bodies add nothing the
 * user can act on, and the fewer places credential-adjacent text can leak
 * through, the better.
 */
export function classify(status: number, body: string, opts?: ClassifyOpts): ScanFailure {
  if (status === 401 || status === 403) {
    return { kind: 'key-invalid', message: 'That key was rejected by the provider.', retryable: false, httpStatus: status }
  }
  if (status === 402) {
    return { kind: 'quota-exhausted', message: 'Your provider account is out of credit.', retryable: false, httpStatus: status }
  }
  const snippet = shortBodySnippet(body, opts?.secret)
  const detail = ` (HTTP ${status})${snippet ? `: ${snippet}` : ''}`
  if (status === 404) {
    const message = opts?.model
      ? `No model named "${opts.model}" on this endpoint${detail}`
      : `That model is not available on your account${detail}`
    return { kind: 'model-unavailable', message, retryable: false, httpStatus: status }
  }
  if (status === 429) {
    return { kind: 'error-retryable', message: `The provider is rate-limiting. Try again shortly.${detail}`, retryable: true, httpStatus: status }
  }
  if (status >= 500) {
    return { kind: 'error-retryable', message: `The provider had a server error.${detail}`, retryable: true, httpStatus: status }
  }
  if (/content_policy|moderation|inappropriate|safety/i.test(body)) {
    return { kind: 'content-refusal', message: `The provider declined to analyze this image.${detail}`, retryable: false, httpStatus: status }
  }
  // 400, 413 and every other status: name the model when we know it — on a
  // reseller gateway the model id is the single most common cause.
  const head = opts?.model ? `Gateway rejected model ${opts.model}` : 'The provider rejected the request'
  return { kind: 'error-retryable', message: `${head}${detail}`, retryable: true, httpStatus: status }
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

export const SCHEMA_MALFORMED_JSON: ScanFailure = {
  kind: 'schema-violation',
  message: 'The provider returned malformed JSON.',
  retryable: false,
}

/**
 * Collect every plausible completion-text slot from ANY provider envelope —
 * OpenAI chat (message.content string OR array of typed parts, legacy .text),
 * Anthropic (content blocks), Gemini (candidates parts), Responses API
 * (output items). The scan path fishes these when its own extractor finds
 * nothing: a gateway that answers in a DIFFERENT dialect than the request
 * still carried the model's answer somewhere, and the request was billed.
 */
function textCandidates(json: unknown): string[] {
  const j = json as Record<string, any> | null
  if (!j || typeof j !== 'object') return []
  const out: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v)
    else if (Array.isArray(v)) {
      const joined = v
        .map((p) => (typeof p?.text === 'string' ? p.text : typeof p === 'string' ? p : ''))
        .join('')
      if (joined.trim()) out.push(joined)
    }
  }
  for (const c of Array.isArray(j.choices) ? j.choices : []) {
    push(c?.message?.content)
    push(c?.text)
  }
  for (const b of Array.isArray(j.content) ? j.content : []) push(b?.text)
  for (const cand of Array.isArray(j.candidates) ? j.candidates : []) {
    for (const p of Array.isArray(cand?.content?.parts) ? cand.content.parts : []) push(p?.text)
  }
  for (const o of Array.isArray(j.output) ? j.output : []) {
    for (const part of Array.isArray(o?.content) ? o.content : []) push(part?.text)
  }
  push(j.output_text)
  return out
}

/**
 * A cleanly-parsed ERROR envelope is not a payload: gateways return
 * {"error":{...}} with HTTP 200 or inside 4xx bodies, and accepting it would
 * convert a real failure into garbage that fails validation downstream.
 */
function isPlausiblePayload(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const err = (v as Record<string, unknown>).error
  return !(typeof err === 'string' || (err != null && typeof err === 'object'))
}

/**
 * Last-resort JSON fishing for the SCAN path: try every text slot of the
 * response (or a raw prose body) through the ONE shared fenced-JSON extractor
 * (the same one runWebLookup uses). Returns the first plain-object payload
 * that is not an error envelope, or null. Never runs on auth failures.
 */
export function fishPayloadFromResponse(source: unknown): unknown | null {
  const candidates = typeof source === 'string' ? [source] : textCandidates(source)
  for (const text of candidates) {
    const parsed = extractJsonObject(text)
    if (isPlausiblePayload(parsed)) return parsed
  }
  return null
}

/**
 * Token usage out of whichever envelope shape the response came in — used by
 * the fishing fallbacks, where the REQUEST dialect and the RESPONSE envelope
 * may disagree. NaN-safe: a missing/odd usage reads as 0, never NaN.
 */
export function usageFromEnvelope(
  provider: ProviderId,
  json: unknown,
): { inputTokens: number; outputTokens: number } {
  const j = (json ?? {}) as Record<string, any>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (provider === 'anthropic') {
    return { inputTokens: num(j.usage?.input_tokens), outputTokens: num(j.usage?.output_tokens) }
  }
  if (provider === 'openai') {
    return { inputTokens: num(j.usage?.prompt_tokens), outputTokens: num(j.usage?.completion_tokens) }
  }
  return { inputTokens: num(j.usageMetadata?.promptTokenCount), outputTokens: num(j.usageMetadata?.candidatesTokenCount) }
}

/**
 * Pull the JSON payload out of each provider's differently-shaped envelope.
 * The per-provider branches live in the transports; this dispatcher stays
 * shared because the scan call must not know provider shapes.
 */
export function extractScanPayload(
  provider: ProviderId,
  json: unknown,
  extractors: Record<ProviderId, (j: Record<string, any>) => { text: unknown } | null>,
): { raw: unknown; inputTokens: number; outputTokens: number } | null {
  // The content string is whatever the model wrote. With structured-output
  // mode it is clean JSON; in degraded (json_object / instruction-contract)
  // mode it is USUALLY clean — but a malformed payload must read as a shape
  // failure, NOT escape as a thrown parse error and get misfiled as offline
  // by runScan's catch-all.
  const safeParse = (text: unknown): unknown => {
    if (typeof text !== 'string') return text
    // P2-10: the scan path shares the fenced extractor with the label,
    // receipt and web paths — a fenced reply parses instead of dying.
    const parsed = extractJsonObject(text)
    return parsed === null ? undefined : parsed
  }
  const j = json as Record<string, any>
  try {
    const extracted = extractors[provider]?.(j)
    if (!extracted) return null
    const raw = safeParse(extracted.text)
    if (raw === undefined) return null
    const usage = usageFromEnvelope(provider, j)
    return { raw, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
  } catch {
    return null
  }
}
