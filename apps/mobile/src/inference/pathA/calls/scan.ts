import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildOpenAIRequest,
  computeScanCost,
} from '@nutai/prompt'
import { withBaseUrl } from '../../base-url'
import { classify, DEFAULT_TIMEOUT_MS, extractScanPayload, SCHEMA_MALFORMED_JSON, serializeBody } from '../wire/errors'
import type { ScanOutcome, ScanRequest } from '../wire/types'
import { scanPayloadExtractors } from '../transports'

/**
 * The scan call (QA Wave 4 god-file split).
 *
 * Non-streaming by design: one request in, one JSON object out — which removes
 * the single largest RN fetch/ReadableStream risk from the core feature.
 */

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
      return { ok: false, error: SCHEMA_MALFORMED_JSON }
    }

    const extracted = extractScanPayload(req.provider, json, scanPayloadExtractors)
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
    return { ok: false, error: classifyTransport(err) }
  } finally {
    clearTimeout(timer)
  }
}

// Local import indirection kept minimal for the barrel's test mocking story.
import { classifyTransportError as classifyTransport } from '../wire/errors'

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
