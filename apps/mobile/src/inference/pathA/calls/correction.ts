import type { CorrectionIntent } from '@nutai/core-schema'
import type { ProviderId } from '@nutai/prompt'
import { loadCredential } from '../../credentials'
import { withBaseUrl } from '../../base-url'
import { classify, classifyTransportError, SCHEMA_MALFORMED_JSON, serializeBody } from '../wire/errors'
import { extractJsonObject } from '../wire/json'
import { correctionRequestFor } from '../transports'
import { CORRECTION_TIMEOUT_MS, GATEWAY_SCAN_TIMEOUT_MS } from '@nutai/prompt'
import { foldSseToEnvelope } from './scan'

/**
 * The Fix-Result correction call (QA Wave 4 god-file split).
 *
 * GATEWAY ROUTING: a custom base URL speaks the OpenAI-compatible dialect for
 * EVERY provider (same rule as the scan path) — request built and response
 * parsed with the openai transport. Native dialects only on official endpoints.
 * Gateway calls STREAM (stream:true + SSE fold, 180 s ceiling) so the ~30 s
 * non-streaming gateway wall cannot kill the Fix-Result parser (F5).
 */

export async function runCorrectionIntent(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; baseUrl?: string | null; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; intent: CorrectionIntent } | { ok: false; error: { kind: any; message: string; retryable: boolean; httpStatus?: number } }> {
  // P2-3: this call used to have no timeout and no abort — a hung gateway
  // froze the Fix-Result flow forever while the caller awaited it.
  // F5 fix: on a GATEWAY the call streams with the raised 180 s ceiling — the
  // same gateway cuts non-streaming completions at ~30 s (the scan path
  // documents the wall), so "describe an edit" timed out far more often than
  // scan ever did. Official endpoints keep the non-streaming 30 s contract.
  const viaGateway = Boolean(req.baseUrl)
  const timeoutMs = req.timeoutMs ?? (viaGateway ? GATEWAY_SCAN_TIMEOUT_MS : CORRECTION_TIMEOUT_MS)
  // The wire dialect follows the base URL, not the provider label.
  const dialect: ProviderId = viaGateway ? 'openai' : req.provider
  try {
    const credObj = await loadCredential(req.provider)
    if (!credObj || !credObj.value) {
      return { ok: false, error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false } }
    }

    const built = correctionRequestFor(dialect, {
      baseUrl: req.baseUrl,
      credentialValue: credObj.value,
      model: req.model,
      systemPrompt: req.systemPrompt,
      userPrompt: req.userPrompt,
    })
    // On a gateway the built URL is already OpenAI-rooted, so withBaseUrl
    // re-hosts it; native URLs (no base URL) pass through untouched.
    const url = withBaseUrl(built.url, req.baseUrl)
    const headers = built.headers

    // F5: the stream flag rides the body for gateway calls only, exactly as
    // the scan path does — buffered SSE reads as one text and folds back into
    // the chat-completions envelope below.
    if (viaGateway && built.body && typeof built.body === 'object') {
      ;(built.body as Record<string, unknown>)['stream'] = true
    }
    const serialized = serializeBody(built.body)
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
    if (!res.ok) return { ok: false, error: classify(res.status, text, { secret: credObj.value, model: req.model }) }

    // F5: GATEWAY SSE FOLD — a stream:true answer arrives as Server-Sent
    // Events; fold it into the envelope every parser below already reads.
    // Non-SSE bodies (gateway ignored stream:true) fall through untouched.
    const folded = viaGateway ? foldSseToEnvelope(text) : null
    let json: Record<string, any>
    if (folded) {
      json = folded.envelope as Record<string, any>
    } else {
      try {
        json = JSON.parse(text) as Record<string, any>
      } catch {
        return { ok: false, error: SCHEMA_MALFORMED_JSON }
      }
    }

    let rawResult = ''
    if (dialect === 'openai') {
      rawResult = json.choices?.[0]?.message?.content
    } else if (dialect === 'google') {
      rawResult = json.candidates?.[0]?.content?.parts?.[0]?.text
    } else if (dialect === 'anthropic') {
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
