/**
 * P3-D15: the ONE home for provider endpoint constants.
 *
 * Provider endpoints used to be hardcoded inline across 6+ files
 * (providers.ts, vision-json.ts, web-lookup.ts, label-scan.ts, the pathA
 * transports, validate.ts) — adding a provider meant touching all of them and
 * the copies could drift. Everything that names a provider URL or id imports
 * from here.
 */

/** Prefix that withBaseUrl may rewrite to the user's reseller base URL. */
export const OPENAI_PREFIX = 'https://api.openai.com/v1'

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models'

export const OPENAI_CHAT_URL = `${OPENAI_PREFIX}/chat/completions`
export const OPENAI_RESPONSES_URL = `${OPENAI_PREFIX}/responses`
export const OPENAI_MODELS_URL = `${OPENAI_PREFIX}/models`

export const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export function googleModelUrl(
  model: string,
  method: 'generateContent' | 'streamGenerateContent' = 'generateContent',
): string {
  const suffix = method === 'streamGenerateContent' ? '?alt=sse' : ''
  return `${GOOGLE_BASE_URL}/models/${encodeURIComponent(model)}:${method}${suffix}`
}

/**
 * The provider ids the app understands, in display order. `repo.ts` used to
 * re-hardcode this list — a new provider now extends it in exactly one place.
 */
export const PROVIDER_IDS = ['anthropic', 'openai', 'google'] as const

/**
 * The example reseller base URL shown as a placeholder in settings. It is
 * EXAMPLE COPY for the flagship reseller, not a default: nothing in the app
 * ever talks to this host unless the user types it in.
 */
export const RESELLER_BASE_URL_PLACEHOLDER = 'https://aicredits.in/v1'
