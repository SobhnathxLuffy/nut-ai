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
 */

const OPENAI_PREFIX = 'https://api.openai.com/v1'

/** Accept full-endpoint pastes and reduce them to the base. */
export function normalizeBaseUrl(input: string): string {
  return input
    .trim()
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '')
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
