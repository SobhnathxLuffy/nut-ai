import { buildWebLookupRequest, type ProviderId } from '@nutai/prompt'
import { withBaseUrl } from '../../base-url'
import { classify, classifyTransportError, SCHEMA_MALFORMED_JSON, serializeBody } from '../wire/errors'
import { extractJsonObject } from '../wire/json'
import type { Credential, WebLookupOutcome } from '../wire/types'
import { lookupTextFor } from '../transports'
import { openAiResellerLookupRequest } from '../transports/openai'
import { postVisionJson } from './vision'
import { LOOKUP_TIMEOUT_MS } from '@nutai/prompt'

/**
 * The web-lookup refinement call (QA Wave 4 god-file split) — the provider's
 * server-side search tool.
 *
 * No structured-output mode here (it does not compose with search on every
 * provider), so the JSON is fished out of prose defensively: last text block,
 * markdown fences stripped, outermost braces isolated. The caller validates
 * with WebLookupResultZ — this function only transports.
 */
export async function runWebLookup(
  provider: ProviderId,
  input: { model: string; itemName: string; brand: string | null; visualContext?: string | null },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  // The OpenAI lookup rides the Responses API, which virtually no reseller
  // proxies (aicredits, OpenRouter: 404). On a custom base URL the same
  // instruction is sent through PLAIN chat completions instead (the reseller
  // transport's fallback builder).
  if (provider === 'openai' && !!baseUrl) {
    const built = openAiResellerLookupRequest({ ...input, credentialValue: credential.value })
    return postVisionJson(provider, built, fetchImpl, timeoutMs, baseUrl)
  }

  const built = buildWebLookupRequest(provider, input, credential)
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
      return { ok: false, error: SCHEMA_MALFORMED_JSON }
    }
    const out = lookupTextFor(provider)(j)
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
