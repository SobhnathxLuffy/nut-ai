import type { CorrectionIntent } from '@nutai/core-schema'
import type { ProviderId } from '@nutai/prompt'
import { loadCredential } from '../../credentials'
import { withBaseUrl } from '../../base-url'
import { classify, classifyTransportError, SCHEMA_MALFORMED_JSON, serializeBody } from '../wire/errors'
import { extractJsonObject } from '../wire/json'
import { correctionRequestFor } from '../transports'

/**
 * The Fix-Result correction call (QA Wave 4 god-file split).
 */

export async function runCorrectionIntent(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; baseUrl?: string | null; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; intent: CorrectionIntent } | { ok: false; error: { kind: any; message: string; retryable: boolean; httpStatus?: number } }> {
  // P2-3: this call used to have no timeout and no abort — a hung gateway
  // froze the Fix-Result flow forever while the caller awaited it.
  const timeoutMs = req.timeoutMs ?? 30_000
  try {
    const credObj = await loadCredential(req.provider)
    if (!credObj || !credObj.value) {
      return { ok: false, error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false } }
    }

    const built = correctionRequestFor(req.provider, {
      baseUrl: req.baseUrl,
      credentialValue: credObj.value,
      model: req.model,
      systemPrompt: req.systemPrompt,
      userPrompt: req.userPrompt,
    })
    // withBaseUrl rewrites ONLY OpenAI-prefixed URLs onto the reseller base;
    // Anthropic/Gemini pass through untouched.
    const url = withBaseUrl(built.url, req.baseUrl)
    const headers = built.headers

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
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let json: Record<string, any>
    try {
      json = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: SCHEMA_MALFORMED_JSON }
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
