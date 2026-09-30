import { cheapestModel, PROVIDER_MODELS, type ProviderId } from '@nutai/prompt'
import { loadCredential } from '../../credentials'
import type { ChatTurn, ScanFailure } from '../wire/types'
import { chatRequestFor } from '../transports'
import { withBaseUrl } from '../../base-url'

/**
 * Assistant chat, non-streaming (QA Wave 4 god-file split).
 */

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

export async function runAssistantChatApi(
  req: { provider: ProviderId; model: string; systemPrompt: string; userPrompt: string; timeoutMs?: number; history?: ChatTurn[]; baseUrl?: string | null; /** P2-8: cross-provider fallbacks join the chain ONLY when this is explicitly set. */ allowCrossProvider?: boolean },
  fetchImpl: typeof fetch = fetch
) {
  // WEB-007 fix: fallback models used to be hardcoded (`gpt-4o`,
  // `claude-3-5-sonnet-20240620`). Dated snapshots silently EXPIRE — the
  // "safe" cross-provider path kept failing with model-unavailable long after
  // the provider retired the snapshot. Fallbacks are now derived from the live
  // catalogue via cheapestModel(), so a model change lands in exactly one
  // place: PROVIDER_MODELS in @nutai/prompt.
  //
  // P2-8: the chain used to hand the request to OTHER providers' cheapest
  // models unconditionally — spending the user's OTHER saved keys on a 429/5xx
  // while the header still showed the configured model. The chain now tries
  // the same provider's cheaper alternates first; cross-provider entries join
  // ONLY when req.allowCrossProvider is explicitly true (the settings opt-in),
  // and any answer that came from a fallback is tagged `answeredVia` so the
  // UI can disclose exactly who answered.
  const sameProvider = [...PROVIDER_MODELS[req.provider]]
    .sort((a, b) => a.approxScanCostUsd - b.approxScanCostUsd)
    .filter((m) => m.id !== req.model)
    .slice(0, 2)
    .map((m) => ({ provider: req.provider as ProviderId, model: m.id }))
  const crossProvider: { provider: ProviderId; model: string }[] = req.allowCrossProvider
    ? (['openai', 'anthropic', 'google'] as ProviderId[])
        .filter((p) => p !== req.provider)
        .map((p) => ({ provider: p, model: cheapestModel(p).id }))
    : []
  const fallbacks: { provider: ProviderId; model: string }[] = [
    { provider: req.provider, model: req.model },
    ...sameProvider,
    ...crossProvider,
  ]
  let primaryError: Awaited<ReturnType<typeof runAssistantChatApiSingle>> | null = null;
  let lastError: Awaited<ReturnType<typeof runAssistantChatApiSingle>> | null = null;
  for (let i = 0; i < fallbacks.length; i++) {
    const res = await runAssistantChatApiSingle({ ...req, provider: fallbacks[i]!.provider, model: fallbacks[i]!.model }, fetchImpl);
    if (res.ok) {
      if (i === 0) return res;
      // A fallback answered: carry the disclosure so the UI can say who
      // actually produced this answer.
      return { ...res, answeredVia: { provider: fallbacks[i]!.provider, model: fallbacks[i]!.model } };
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
): Promise<{ ok: true; text: string; answeredVia?: { provider: ProviderId; model: string } } | { ok: false; error: ScanFailure }> {
  try {
    const credObj = await loadCredential(req.provider)
    if (!credObj || !credObj.value) {
      return { ok: false, error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false } }
    }

    // Multi-turn memory: prior turns are replayed before the current user
    // message, normalized per provider. Empty history reproduces the old
    // single-turn payloads byte-for-byte.
    const history = normalizeHistory(req.history ?? [])

    const built = chatRequestFor(req.provider, {
      baseUrl: req.baseUrl,
      credentialValue: credObj.value,
      model: req.model,
      systemPrompt: req.systemPrompt,
      history,
      userPrompt: req.userPrompt,
    })
    const url = withBaseUrl(built.url, req.baseUrl)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), req.timeoutMs || 15000)
    let resp;
    try {
      resp = await fetchImpl(url, { method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: controller.signal })
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
    // Classified by error TYPE, not message sniffing (P3-1). A chat timeout
    // is retryable — unlike a vision scan it is cheap, and the fallback chain
    // exists precisely to absorb it. A RangeError is ours, never the network's.
    if (e?.name === 'AbortError') {
      return { ok: false, error: { kind: 'error-retryable', message: 'The model took too long to answer.', retryable: true } }
    }
    if (e?.name === 'RangeError') {
      return { ok: false, error: { kind: 'internal-error', message: 'Something failed inside the app while preparing this request.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'No connection to the provider.', retryable: true } }
  }
}
