import { ANTHROPIC_OAUTH_BETA, type ProviderId } from '@nutai/prompt'
import { withBaseUrl } from '../base-url'
import type { Credential, ScanFailure } from './client'
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_MODELS_URL, GOOGLE_BASE_URL, OPENAI_CHAT_URL, OPENAI_MODELS_URL } from '@nutai/prompt'
import { VALIDATION_TIMEOUT_MS } from '@nutai/prompt'

/**
 * Credential validation.
 *
 * THE BUG THIS FILE REPLACES: the first version validated by sending the real
 * scan request with an empty image list and a placeholder `{ type: 'object' }`
 * schema. That fails for structural reasons before authentication is ever
 * considered — OpenAI's strict mode requires `additionalProperties: false` plus
 * an explicit `required` array, Gemini rejects an empty response schema, and
 * Anthropic's structured-output mode wants a real schema too. Every provider
 * returned 400, which got reported as "your key was rejected". Valid keys failed.
 *
 * For OpenAI and Google the probe is the MODEL RETRIEVE endpoint: free,
 * non-billing, and answers both questions that matter in one call — does this
 * credential authenticate, and does this account actually have this model.
 *
 * Anthropic needs more care, because it accepts two credential shapes and they
 * probe DIFFERENT endpoints:
 *
 *   - console API key       -> `x-api-key` against GET /v1/models/{id} (free)
 *   - `claude setup-token`  -> `Authorization: Bearer` + the OAuth beta header
 *                              against a 1-token POST /v1/messages
 *
 * The bearer probe deliberately uses /v1/messages — the endpoint scans actually
 * hit — because a setup-token's scopes are for inference, and whether some OTHER
 * endpoint accepts them is exactly the kind of guess that produced the last bug.
 * A pass here means the scan request will authenticate, full stop. Cost is one
 * output token, drawn from the subscription for setup-tokens.
 *
 * Both shapes are tried in either order (wrong-tab pastes are the most common
 * mistake), and EVERY attempt's status+body lands in `detail` — an earlier
 * version kept only the last attempt, which hid the bearer failure behind the
 * x-api-key fallback's 401 and made the real problem invisible in the UI.
 */

export interface ValidationOk {
  ok: true
  /** Which header shape the provider actually accepted. */
  usedShape: 'x-api-key' | 'bearer' | 'header'
  modelId: string
}

export interface ValidationErr {
  ok: false
  error: ScanFailure
  /** Raw status and body snippet. Surfaced in the UI so failures are diagnosable. */
  detail: string
  /**
   * Actionable next step for a specific, detectable failure — currently the
   * reseller-key shape pasted with no custom base URL set (HTTP 401 from the
   * OFFICIAL endpoint is what that always produces). Optional; the UI renders
   * it under the error text.
   */
  hint?: string
}

export type ValidationResult = ValidationOk | ValidationErr

const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Does this look like a key minted by OpenAI itself?
 *
 * Official shapes: `sk-proj-…`, `sk-svcacct-…`, `sk-None-…`, `sk-admin-…`, and
 * the legacy `sk-…T3BlbkFJ…` (that fragment is base64 of ">OpenAI<" and appears
 * in every legacy service key). Anything else — `sk-live-…`, `sk-or-v1-…`,
 * `sk-xyz-…` — is somebody else's key format. Deliberately conservative: this
 * only decides whether a 401 gets a reseller hint, never whether a key is
 * accepted. The provider remains the authority on what is real.
 */
function looksLikeOfficialOpenAiKey(key: string): boolean {
  return /^sk-(proj|svcacct|None|admin)-/.test(key) || /^sk-[A-Za-z0-9]{20}T3BlbkFJ/.test(key)
}

const RESELLER_HINT =
  "This key's shape does not match an official OpenAI key. If it came from an " +
  'OpenAI-compatible reseller (aicredits.in, OpenRouter, a proxy), enter their ' +
  'base URL — for aicredits.in that is https://aicredits.in/v1 — in the Using a ' +
  'reseller section below, then verify again. Your key was sent to api.openai.com, ' +
  'which rejected it.'

// P2-11: with a base URL SET, a 404 used to diagnose 'that model is not
// available on your account' — the wrong hunt. On a reseller, a 404 on both the
// retrieve AND the chat-completions probe almost always means the base URL is
// missing its /v1 suffix (the app appends /chat/completions onto exactly what
// you pasted). Say so instead of blaming the model.
const RESELLER_404_HINT =
  'The endpoint was not found (HTTP 404) on your custom base URL. Check that ' +
  'your base URL ends in /v1 — for aicredits.in that is https://aicredits.in/v1 — ' +
  'then verify again. If it already does, confirm the exact path your reseller ' +
  "prints for the OpenAI-compatible API."

function classify(status: number, _body: string): ScanFailure {
  if (status === 401 || status === 403) {
    return { kind: 'key-invalid', message: 'The provider rejected this credential.', retryable: false, httpStatus: status }
  }
  if (status === 402) {
    return { kind: 'quota-exhausted', message: 'The account has no credit.', retryable: false, httpStatus: status }
  }
  if (status === 404) {
    return { kind: 'model-unavailable', message: 'That model is not available on this account.', retryable: false, httpStatus: status }
  }
  if (status === 429) {
    return { kind: 'error-retryable', message: 'Rate limited. Try again shortly.', retryable: true, httpStatus: status }
  }
  if (status >= 500) {
    return { kind: 'error-retryable', message: 'The provider had a server error.', retryable: true, httpStatus: status }
  }
  return {
    kind: 'error-retryable',
    message: `Unexpected ${status} from the provider.`,
    retryable: true,
    httpStatus: status,
  }
}

async function attempt(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  postBody?: unknown,
): Promise<{ status: number; body: string } | { aborted: true } | { offline: true }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: postBody === undefined ? 'GET' : 'POST',
      headers,
      body: postBody === undefined ? undefined : JSON.stringify(postBody),
      signal: controller.signal,
    })
    const body = await res.text()
    return { status: res.status, body: body.slice(0, 400) }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { aborted: true }
    return { offline: true }
  } finally {
    clearTimeout(timer)
  }
}

export async function validateCredential(
  provider: ProviderId,
  model: string,
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = VALIDATION_TIMEOUT_MS,
  baseUrl?: string | null,
): Promise<ValidationResult> {
  // ---- Anthropic: two shapes, each probing the endpoint it would really use --
  if (provider === 'anthropic') {
    // Each shape probes differently. x-api-key: free GET on the model-retrieve
    // endpoint. bearer: a 1-token POST to /v1/messages, because that is the
    // endpoint scans use and the only one a setup-token is guaranteed scoped for.
    const probes: Record<'x-api-key' | 'bearer', () => ReturnType<typeof attempt>> = {
      'x-api-key': () =>
        attempt(
          `${ANTHROPIC_MODELS_URL}/${encodeURIComponent(model)}`,
          { 'x-api-key': credential.value, 'anthropic-version': ANTHROPIC_VERSION },
          fetchImpl,
          timeoutMs,
        ),
      bearer: () =>
        attempt(
          ANTHROPIC_MESSAGES_URL,
          {
            authorization: `Bearer ${credential.value}`,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta': ANTHROPIC_OAUTH_BETA,
            'content-type': 'application/json',
          },
          fetchImpl,
          timeoutMs,
          { model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] },
        ),
    }

    // A credential pasted into the wrong tab is the single most common mistake
    // here, so the other shape is always tried before blaming the user.
    const order: Array<'x-api-key' | 'bearer'> =
      credential.kind === 'oauth' ? ['bearer', 'x-api-key'] : ['x-api-key', 'bearer']

    const details: string[] = []
    for (const shape of order) {
      const r = await probes[shape]()
      if ('offline' in r) {
        return {
          ok: false,
          error: { kind: 'offline', message: 'No connection to Anthropic.', retryable: true },
          detail: 'Network request failed before reaching the provider.',
        }
      }
      if ('aborted' in r) {
        return {
          ok: false,
          error: { kind: 'timeout-ambiguous', message: 'The check timed out.', retryable: false },
          detail: `No response within ${timeoutMs / 1000}s.`,
        }
      }
      if (r.status >= 200 && r.status < 300) return { ok: true, usedShape: shape, modelId: model }
      details.push(`${shape}: HTTP ${r.status} — ${r.body}`)
      // A 404 means auth worked but the model is wrong; trying the other header
      // shape cannot help, so stop and say so.
      if (r.status === 404) {
        return { ok: false, error: classify(404, r.body), detail: details.join('\n') }
      }
    }
    return { ok: false, error: classify(401, details.join('\n')), detail: details.join('\n') }
  }

  // ---- OpenAI --------------------------------------------------------------
  if (provider === 'openai') {
    const retrieveUrl = withBaseUrl(
      `${OPENAI_MODELS_URL}/${encodeURIComponent(model)}`,
      baseUrl,
    )
    const r = await attempt(
      retrieveUrl,
      { authorization: `Bearer ${credential.value}` },
      fetchImpl,
      timeoutMs,
    )
    if ('offline' in r) {
      return {
        ok: false,
        error: { kind: 'offline', message: 'No connection to OpenAI.', retryable: true },
        detail: 'Network request failed before reaching the provider.',
      }
    }
    if ('aborted' in r) {
      return {
        ok: false,
        error: { kind: 'timeout-ambiguous', message: 'The check timed out.', retryable: false },
        detail: `No response within ${timeoutMs / 1000}s.`,
      }
    }
    if (r.status >= 200 && r.status < 300) return { ok: true, usedShape: 'bearer', modelId: model }

    // On a reseller base the per-model retrieve endpoint is the one OpenAI-
    // compatible route gateways most often skip, while chat completions — the
    // endpoint scans actually hit — works. Same philosophy as the Anthropic
    // bearer probe: before declaring failure, ask the endpoint that matters.
    // Cost is one output token on whatever model was typed.
    if (baseUrl && r.status === 404) {
      const c = await attempt(
        withBaseUrl(OPENAI_CHAT_URL, baseUrl),
        { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
        fetchImpl,
        timeoutMs,
        { model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] },
      )
      if (!('offline' in c) && !('aborted' in c)) {
        if (c.status >= 200 && c.status < 300) {
          return { ok: true, usedShape: 'bearer', modelId: model }
        }
        return {
          ok: false,
          error: classify(c.status, c.body),
          detail: `GET ${retrieveUrl} → HTTP ${r.status} — ${r.body}\nPOST chat/completions → HTTP ${c.status} — ${c.body}`,
          // Both reseller routes 404ed: the paste is almost certainly missing
          // its /v1 suffix (P2-11).
          ...(c.status === 404 ? { hint: RESELLER_404_HINT } : {}),
        }
      }
      // The fallback probe could not reach the network; report the retrieve
      // result below rather than inventing a verdict.
    }

    const hint =
      !baseUrl && r.status === 401 && !looksLikeOfficialOpenAiKey(credential.value)
        ? RESELLER_HINT
        : baseUrl && r.status === 404
          ? RESELLER_404_HINT
          : undefined
    return {
      ok: false,
      error: classify(r.status, r.body),
      detail: `HTTP ${r.status} — ${r.body}`,
      ...(hint ? { hint } : {}),
    }
  }

  // ---- Google --------------------------------------------------------------
  const r = await attempt(
    `${GOOGLE_BASE_URL}/models/${encodeURIComponent(model)}`,
    { 'x-goog-api-key': credential.value },
    fetchImpl,
    timeoutMs,
  )
  if ('offline' in r) {
    return {
      ok: false,
      error: { kind: 'offline', message: 'No connection to Google.', retryable: true },
      detail: 'Network request failed before reaching the provider.',
    }
  }
  if ('aborted' in r) {
    return {
      ok: false,
      error: { kind: 'timeout-ambiguous', message: 'The check timed out.', retryable: false },
      detail: `No response within ${timeoutMs / 1000}s.`,
    }
  }
  // P2-12 companion: the key travels in the x-goog-api-key HEADER (as on the
  // scan path) — the shape label must say so, not the retired query-param form.
  if (r.status >= 200 && r.status < 300) return { ok: true, usedShape: 'header', modelId: model }
  return { ok: false, error: classify(r.status, r.body), detail: `HTTP ${r.status} — ${r.body}` }
}
