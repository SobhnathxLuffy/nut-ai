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

export function classify(status: number, body: string): ScanFailure {
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

export const SCHEMA_MALFORMED_JSON: ScanFailure = {
  kind: 'schema-violation',
  message: 'The provider returned malformed JSON.',
  retryable: false,
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
    if (provider === 'anthropic') {
      return { raw, inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 }
    }
    if (provider === 'openai') {
      return { raw, inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 }
    }
    return { raw, inputTokens: j.usageMetadata?.promptTokenCount ?? 0, outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0 }
  } catch {
    return null
  }
}
