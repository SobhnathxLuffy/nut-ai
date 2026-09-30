/**
 * Optional OpenAI-compatible base-URL override for API resellers and proxies
 * (aicredits.in, OpenRouter, a local gateway, ...). These services expose the
 * OpenAI wire format on their own host, so pointing the app at them is a URL
 * swap — the request bodies are already OpenAI-shaped.
 *
 * PURE on purpose: string logic only, no settings I/O, so the Node test suite
 * can exercise it directly. The async settings reader lives in data/repo.ts.
 *
 * Scope: the override rewrites only URLs that start with the official OpenAI
 * prefix. Anthropic and Gemini endpoints pass through untouched — resellers
 * almost universally speak the OpenAI dialect, and silently redirecting a
 * Claude/Gemini call to an endpoint that does not implement THAT dialect would
 * turn a working setup into a confusing 404.
 *
 * P2-11: bad pastes used to produce wrong diagnoses downstream — a scheme-less
 * 'aicredits.in/v1' became a relative-URL fetch failure reported as 'offline',
 * a missing /v1 404ed as 'model not available', and plain http:// was accepted
 * silently for a key-bearing request. normalizeBaseUrl now repairs all three
 * shapes (scheme added, http upgraded to https off-localhost), and
 * baseUrlWarning flags the one remaining ambiguity — a non-localhost host with
 * no /v1 suffix — for the settings screen to surface at paste time.
 */

const OPENAI_PREFIX = 'https://api.openai.com/v1'

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i

/** Accept full-endpoint pastes, repair scheme, and reduce them to the base. */
export function normalizeBaseUrl(input: string): string {
  let v = input
    .trim()
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '')
  if (!v) return ''
  // A paste without a scheme means https — nobody resells over plaintext.
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`
  // Key-bearing requests never travel over http except to a loopback gateway.
  if (/^http:\/\//i.test(v)) {
    try {
      const host = new URL(v).host
      if (!LOCAL_HOST.test(host)) v = v.replace(/^http:\/\//i, 'https://')
    } catch {
      // Unparseable — leave as-is; the fetch will fail and be diagnosed then.
    }
  }
  return v
}

/**
 * Paste-quality warning for the settings UI, computed from the RAW draft so it
 * reflects what the user typed. Null when there is nothing to flag: empty,
 * localhost (where /v1-less gateways are common), or a host that already ends
 * in /v1.
 */
export function baseUrlWarning(input: string): string | null {
  const v = normalizeBaseUrl(input)
  if (!v) return null
  let host = ''
  try {
    host = new URL(v).host
  } catch {
    return null
  }
  if (LOCAL_HOST.test(host)) return null
  if (!/\/v1$/i.test(v)) {
    return 'Most OpenAI-compatible resellers expose the API under /v1. Double-check that this base URL ends in /v1 — for aicredits.in that is https://aicredits.in/v1.'
  }
  return null
}

/**
 * Rewrite an official OpenAI URL onto the user's base. `.../v1/chat/completions`
 * becomes `<base>/chat/completions`, so the user pastes exactly what reseller
 * dashboards print (their "API base URL", which conventionally ends in /v1).
 */
export function withBaseUrl(defaultUrl: string, baseUrl: string | null | undefined): string {
  if (!baseUrl) return defaultUrl
  const base = normalizeBaseUrl(baseUrl)
  if (!base || !defaultUrl.startsWith(OPENAI_PREFIX)) return defaultUrl
  return base + defaultUrl.slice(OPENAI_PREFIX.length)
}
