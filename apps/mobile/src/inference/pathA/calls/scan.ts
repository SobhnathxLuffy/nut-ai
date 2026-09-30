import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildOpenAIRequest,
  computeScanCost,
  DEFAULT_SCAN_MAX_TOKENS,
  type ProviderId,
} from '@nutai/prompt'
import { withBaseUrl } from '../../base-url'
import {
  classify,
  DEFAULT_TIMEOUT_MS,
  extractScanPayload,
  fishPayloadFromResponse,
  finishReasonFromEnvelope,
  isLengthTruncated,
  SCHEMA_MALFORMED_JSON,
  serializeBody,
  TRUNCATION_FAILURE,
  usageFromEnvelope,
} from '../wire/errors'
import type { ScanOutcome, ScanRequest, ScanSuccess } from '../wire/types'
import { scanPayloadExtractors } from '../transports'

/**
 * The scan call (QA Wave 4 god-file split).
 *
 * Non-streaming by design: one request in, one JSON object out — which removes
 * the single largest RN fetch/ReadableStream risk from the core feature.
 *
 * MODEL-AGNOSTIC RESELLER ROUTING: a custom base URL (aicredits.in, OpenRouter,
 * a local gateway, ...) speaks the OpenAI-compatible chat/completions dialect
 * REGARDLESS of which provider is named in settings — resellers proxy Gemini
 * and Claude models behind the same OpenAI wire format, so provider='google'
 * with a base URL must reach {base}/chat/completions with a Bearer header and
 * the model id VERBATIM ('gemini-2.5-flash' and 'google/gemini-2.5-flash' are
 * both tried exactly as typed, no catalogue gating, no rewriting). Native
 * endpoints (Google generativelanguage / Anthropic api) are used ONLY when no
 * base URL is configured. The response is then parsed with the OpenAI envelope
 * (choices[0].message.content), never the native one.
 */

/**
 * One attempt, carrying the raw response TEXT alongside the outcome so
 * runScanWithFallback can fish JSON out of a failed response WITHOUT firing a
 * second billed request. Never surfaced through runScan's public outcome.
 */
interface ScanAttempt {
  outcome: ScanOutcome
  responseText: string | null
}

/**
 * Ceiling for the truncation-escalation retry (DEFAULT doubled, then capped).
 * The cap is what keeps the escalation inside every catalogue model's output
 * limit — a raised budget that the provider itself rejects would trade one
 * honest failure for a different one. Local to this module: the escalation
 * is runScanWithFallback's private concern; callers shape it via req.maxTokens.
 */
const TRUNCATION_ESCALATION_MAX_TOKENS = 16384

async function runScanAttempt(req: ScanRequest, fetchImpl: typeof fetch): Promise<ScanAttempt> {
  const viaGateway = !!req.baseUrl
  const input = {
    model: req.model,
    imagesBase64: req.imagesBase64,
    localSignalsBlock: req.localSignalsBlock,
    jsonSchema: req.jsonSchema,
    instructionSchema: req.instructionSchema,
    // Per-attempt output budget, threaded into every builder's
    // `?? DEFAULT_SCAN_MAX_TOKENS`. Undefined = the catalogue default; the
    // truncation-escalation retry below passes the RAISED value here.
    maxTokens: req.maxTokens,
  }

  // ROUTING: on a custom base URL every provider rides the OpenAI builder —
  // model id verbatim, Bearer auth — and the answer is read from the
  // chat-completions envelope. buildOpenAIRequest produces an
  // OPENAI_PREFIX-rooted URL, which withBaseUrl re-hosts onto the user's base.
  const built = viaGateway
    ? buildOpenAIRequest(input, req.credential.value)
    : req.provider === 'anthropic'
      ? buildAnthropicRequest(input, req.credential)
      : req.provider === 'openai'
        ? buildOpenAIRequest(input, req.credential.value)
        : buildGeminiRequest(input, req.credential.value)

  // The ENVELOPE the response arrives in follows the request dialect, not the
  // provider label: a gateway scan (any provider) answers in OpenAI shape.
  const envelope: ProviderId = viaGateway ? 'openai' : req.provider
  const classifyOpts = { secret: req.credential.value, model: req.model }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const started = Date.now()
  const url = withBaseUrl(built.url, req.baseUrl)
  // P2-1: serialization lives OUTSIDE the transport try — an un-stringifiable
  // body is an internal error, not a network outage.
  const serialized = serializeBody(built.body)
  if (!serialized.ok) return { outcome: { ok: false, error: serialized.error }, responseText: null }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: built.headers,
      body: serialized.text,
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) return { outcome: { ok: false, error: classify(res.status, text, classifyOpts) }, responseText: text }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { outcome: { ok: false, error: SCHEMA_MALFORMED_JSON }, responseText: text }
    }

    // HONEST TRUNCATION, checked BEFORE anything parses or fishes: the
    // envelope's own finish marker is the provider telling us the completion
    // was cut off by the output-token budget (the live aicredits.in case — a
    // thinking model burned max_tokens on reasoning and returned ~100 visible
    // tokens of half a JSON object, which used to parse-fail into a generic
    // "could not recognise food"). A half payload is garbage by construction:
    // it is failed AS truncated — never fished, never half-accepted — and
    // surfaced as retryable because the retry is REAL, not an invitation to
    // tap the button again: runScanWithFallback escalates once to a doubled
    // budget, and the orchestrator's instruction-schema rescue is the layer
    // behind that.
    const finishReason = finishReasonFromEnvelope(json)
    if (isLengthTruncated(finishReason)) {
      return { outcome: { ok: false, error: TRUNCATION_FAILURE }, responseText: text }
    }

    const extracted = extractScanPayload(envelope, json, scanPayloadExtractors)
    if (extracted && extracted.raw != null) {
      return {
        outcome: {
          ok: true,
          value: {
            raw: extracted.raw,
            inputTokens: extracted.inputTokens,
            outputTokens: extracted.outputTokens,
            // Real token counts, never an estimate, so the ledger shows an actual
            // dollar figure rather than a guess. Null cost = unknown model id.
            costUsd: computeScanCost(req.provider, req.model, extracted.inputTokens, extracted.outputTokens),
            latencyMs: Date.now() - started,
            promptVersion: built.promptVersion,
            finishReason,
          },
        },
        responseText: text,
      }
    }

    // GRACEFUL DEGRADATION before giving up on a BILLED 200: the extractor
    // found nothing parsable (empty content, an unexpected shape, a gateway
    // that answered in its own dialect) — fish a JSON object out of any prose
    // the response still carries, through the same fenced-JSON extractor the
    // web-lookup path uses. An error envelope is never mistaken for a payload.
    const fished = fishPayloadFromResponse(json)
    if (fished != null) {
      const usage = usageFromEnvelope(envelope, json)
      return {
        outcome: {
          ok: true,
          value: {
            raw: fished,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: computeScanCost(req.provider, req.model, usage.inputTokens, usage.outputTokens),
            latencyMs: Date.now() - started,
            promptVersion: built.promptVersion,
            finishReason,
          },
        },
        responseText: text,
      }
    }

    return {
      outcome: { ok: false, error: { kind: 'schema-violation', message: 'The provider returned an unexpected shape.', retryable: false } },
      responseText: text,
    }
  } catch (err) {
    // P2-1: the try block contains ONLY fetch and response reads, so anything
    // caught here is transport-shaped. By type, not by message (P3-1).
    return { outcome: { ok: false, error: classifyTransport(err) }, responseText: null }
  } finally {
    clearTimeout(timer)
  }
}

export async function runScan(req: ScanRequest, fetchImpl: typeof fetch = fetch): Promise<ScanOutcome> {
  return (await runScanAttempt(req, fetchImpl)).outcome
}

// Local import indirection kept minimal for the barrel's test mocking story.
import { classifyTransportError as classifyTransport } from '../wire/errors'

/**
 * The scan with a truncation escalation AND a structural safety net.
 *
 * TRUNCATION ESCALATION (thinking models): a completion that comes back
 * finish-reason 'length' burned the attempt's output budget on reasoning and
 * was failed honestly as kind 'truncated'. The SAME budget would truncate
 * again, so exactly ONE escalated retry runs at min(base*2, 16384) — still
 * inside every catalogue model's output cap — with the request's schema mode
 * untouched. This is a BUDGET fix, not a structured-output fallback, so
 * usedSchemaFallback stays absent on success. If the escalated attempt also
 * truncates there is no second escalation here: the failure falls through to
 * the fishing last-resort below, and the orchestrator's instruction-schema
 * rescue (shouldRetryWithInstructionSchema accepts 'truncated') becomes the
 * next layer — whose own runScanWithFallback escalates again. Worst case for
 * one user scan is therefore 4 bounded billed attempts, each recorded.
 *
 * STRUCTURAL SAFETY NET: a provider that rejects our schema DIALECT (a
 * structural 400, before auth or billing) should not brick scanning: the same
 * request is retried once with no structured-output mode at all, relying on
 * the prompt plus client-side Zod. That retry costs nothing extra — a
 * structurally rejected request is never billed. The two nets are mutually
 * exclusive BY CONSTRUCTION: a truncation is an HTTP 200 envelope failure
 * (TRUNCATION_FAILURE carries no httpStatus), a dialect rejection is a
 * classify() 400 — the same first outcome can never qualify for both. Auth
 * failures (401/403), timeouts and every other failure pass through with no
 * retry at all.
 */
export async function runScanWithFallback(
  req: ScanRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanOutcome & { usedSchemaFallback?: boolean }> {
  const started = Date.now()
  const first = await runScanAttempt(req, fetchImpl)
  const truncated = !first.outcome.ok && first.outcome.error.kind === 'truncated'

  // The escalated retry doubles the REQUEST'S OWN base (not a hardcoded
  // default — an explicit req.maxTokens raises the whole chain with it) and
  // caps at 16384 so a mis-typed override can never push past what catalogue
  // models accept. At most ONE escalation here: if the raised budget also
  // truncates, budget is no longer the diagnosis and more attempts belong to
  // the orchestrator's rescue, not to this function.
  const escalated = truncated
    ? await runScanAttempt(
        { ...req, maxTokens: Math.min((req.maxTokens ?? DEFAULT_SCAN_MAX_TOKENS) * 2, TRUNCATION_ESCALATION_MAX_TOKENS) },
        fetchImpl,
      )
    : null
  // Success on the raised budget returns as-is; usedSchemaFallback stays
  // ABSENT — the escalated attempt reused the request's own schema mode, so
  // it must not read as a structured-output fallback downstream.
  if (escalated?.outcome.ok) return escalated.outcome

  const structural =
    // eslint-disable-next-line no-restricted-syntax -- httpStatus is carrier info the outcome union deliberately does not surface
    !first.outcome.ok && (first.outcome as any).error?.httpStatus === 400 && req.jsonSchema != null
  // A truncation does NOT return early: its second attempt already ran (the
  // escalation above), and the fishing last-resort below still applies to
  // both bodies before the honest failure is surfaced.
  if (!structural && !truncated) return first.outcome

  // Second attempt in play. When the STRUCTURAL net fired: structured-output
  // mode OFF, but the schema ships as TEXT in the instruction
  // (instructionSchema) — a degraded scan that still knows the field contract
  // beats a free-form answer that drifts, which is exactly what failed
  // client-side Zod on reseller gateways. When the TRUNCATION escalation
  // fired instead, that attempt IS the second one — no new request.
  const second = structural
    ? await runScanAttempt(
        { ...req, jsonSchema: null, instructionSchema: req.jsonSchema },
        fetchImpl,
      )
    : escalated
  if (structural && second?.outcome.ok) return { ...second.outcome, usedSchemaFallback: true }

  // LAST RESORT before surfacing the failure: the retry ALSO failed. Fish a
  // JSON object out of any prose in EITHER response body — no new request, no
  // billing — before giving up. Error-envelope bodies ({"error":...}) are
  // rejected by the fisher, and auth failures never reach this path (they do
  // not trigger the retry), so a genuine credential problem can never be
  // converted into a fake payload.
  const usageEnvelope: ProviderId = req.baseUrl ? 'openai' : req.provider
  for (const attempt of [second, first]) {
    if (attempt == null || !attempt.responseText) continue
    let parsedBody: unknown = attempt.responseText
    try {
      parsedBody = JSON.parse(attempt.responseText)
    } catch {
      // Prose or HTML error body — the fisher works on the raw text instead.
    }
    const fished = fishPayloadFromResponse(parsedBody)
    if (fished != null) {
      const usage = usageFromEnvelope(usageEnvelope, parsedBody)
      const value: ScanSuccess = {
        raw: fished,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: computeScanCost(req.provider, req.model, usage.inputTokens, usage.outputTokens),
        latencyMs: Date.now() - started,
        promptVersion: '',
      }
      return { ok: true, value, usedSchemaFallback: true }
    }
  }
  return first.outcome
}
