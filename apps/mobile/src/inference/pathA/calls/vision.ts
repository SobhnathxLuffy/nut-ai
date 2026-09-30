import {
  buildExerciseEstimateInstruction,
  buildLabelScanRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  EXERCISE_ESTIMATE_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import { withBaseUrl } from '../../base-url'
import { classify, classifyTransportError, SCHEMA_MALFORMED_JSON, serializeBody } from '../wire/errors'
import { extractJsonObject } from '../wire/json'
import type { Credential, WebLookupOutcome } from '../wire/types'
import { visionTextFor } from '../transports'
import { ESTIMATE_TIMEOUT_MS, LOOKUP_TIMEOUT_MS } from '@nutai/prompt'

/**
 * Vision-JSON one-shots (QA Wave 4 god-file split): label transcription,
 * receipt transcription and the free-text exercise estimate. One request, one
 * JSON object fished out of the provider envelope defensively; validated by
 * the caller.
 *
 * GATEWAY ROUTING: with a custom base URL the request is BUILT and PARSED in
 * the OpenAI dialect no matter which provider is named — the same rule as the
 * scan path. Native builders/envelopes are used only on official endpoints.
 */

/** The provider id whose WIRE SHAPE a call should use. A base URL means OpenAI dialect, always. */
function wireDialect(provider: ProviderId, baseUrl?: string | null): ProviderId {
  return baseUrl ? 'openai' : provider
}

async function postVisionJson(
  provider: ProviderId,
  built: { url: string; headers: Record<string, string>; body: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
  baseUrl?: string | null,
  secret?: string,
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
    if (!res.ok) return { ok: false, error: classify(res.status, text, { secret }) }

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: SCHEMA_MALFORMED_JSON }
    }

    const out = visionTextFor(provider)(j)
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
 * Nutrition-label transcription: one image in, one LabelPayload-shaped JSON
 * out. No tools, no structured-output mode; validated by the caller.
 */
export async function runLabelScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  const dialect = wireDialect(provider, baseUrl)
  return postVisionJson(
    dialect,
    buildLabelScanRequest(dialect, input, credential),
    fetchImpl,
    timeoutMs,
    baseUrl,
    credential.value,
  )
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
  timeoutMs = ESTIMATE_TIMEOUT_MS,
): Promise<WebLookupOutcome> {
  const dialect = wireDialect(provider, input.baseUrl)
  const built = buildTextJsonRequest(
    dialect,
    { model: input.model, instruction: buildExerciseEstimateInstruction(input.description, input.weightKg) },
    credential,
    EXERCISE_ESTIMATE_PROMPT_VERSION,
  )
  return postVisionJson(dialect, built, fetchImpl, timeoutMs, input.baseUrl, credential.value)
}

/** Receipt transcription: same transport, different instruction and validator. */
export async function runReceiptScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  baseUrl?: string | null,
): Promise<WebLookupOutcome> {
  const dialect = wireDialect(provider, baseUrl)
  return postVisionJson(
    dialect,
    buildReceiptScanRequest(dialect, input, credential),
    fetchImpl,
    timeoutMs,
    baseUrl,
    credential.value,
  )
}

export { postVisionJson }
