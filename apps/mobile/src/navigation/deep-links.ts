/**
 * The nutai:// deep-link map — UI/UX report §7.2 / Table 7.1 (Wave 4c):
 * "Router-level handler: widget + notification taps."
 *
 * STRATEGY — alias route files, NOT a Linking subscription. The scheme is
 * declared in `app.config.ts` (`scheme: 'nutai'`), and expo-router registers
 * it with the OS (and the web router) automatically: a `nutai://camera` tap is
 * delivered to the `/camera` route file on cold start AND warm start with zero
 * custom code. Only the SEMANTIC aliases (`scan`, `log`, `home`) name no route
 * file of their own, so each gets a tiny alias file (`app/scan.tsx` …) that
 * redirects through this table to the real screen.
 *
 * Why not `Linking.addEventListener('url')` in `app/_layout.tsx` (rejected
 * design, wave4-spec §3.3): a root subscription RACES expo-router's own scheme
 * dispatch — an unknown path hits the not-found screen first and flashes a 404
 * before the subscription can redirect — and Android delivers the initial URL
 * twice (`getInitialURL` + the event), forcing debounce hacks. Route files ride
 * the router's existing linking for cold start, warm start AND web paths, so
 * there is nothing to race and nothing to debounce.
 *
 * This module stays pure (no React Native imports) so the root vitest suite
 * can lock the whole map; the redirect component lives next door in
 * DeepLinkRedirect.tsx.
 */

/** The URL scheme declared in app.config.ts — single source of truth for tests. */
export const DEEP_LINK_SCHEME = 'nutai'

export interface DeepLinkRoute {
  /**
   * The alias segment after `nutai://` — the word a widget row or a
   * notification action emits. Always singular, lowercase, no slashes.
   */
  path: string
  /** The REAL expo-router route the alias resolves to (verified route files). */
  route: string
  /** Why the alias exists — kept honest so README and tests agree. */
  description: string
}

/**
 * The complete alias → route map. Entries whose alias already matches a real
 * route file (`train`, `workout`, `assistant`, `progress`, `weight` →
 * `/log-weight`) need NO alias file: expo-router links them directly. The
 * first three do, and their files hardcode the alias they own.
 */
export const DEEP_LINK_ROUTES: readonly DeepLinkRoute[] = [
  {
    path: 'scan',
    route: '/camera',
    description: 'Hero action — a widget or notification tap lands straight on the camera.',
  },
  {
    path: 'log',
    route: '/food',
    description: 'The Food write-surface tab — the (tabs) group is URL-transparent.',
  },
  {
    path: 'home',
    route: '/',
    description: 'The Home tab.',
  },
  {
    path: 'train',
    route: '/train',
    description: 'Direct route — the Train tab needs no alias file.',
  },
  {
    path: 'workout',
    route: '/workout',
    description: 'Direct route — the active-workout screen.',
  },
  {
    path: 'assistant',
    route: '/assistant',
    description: 'Direct route — the AI assistant.',
  },
  {
    path: 'progress',
    route: '/progress',
    description: 'Direct route — the Progress tab.',
  },
  {
    path: 'weight',
    route: '/log-weight',
    description: 'Direct route — the log-weight modal.',
  },
]

/**
 * Resolve a `nutai://<alias>` URL to its real route.
 *
 * - Scheme and host are case-insensitive (`NUTAI://SCAN`, `nutai://Log`).
 * - Query (`?date=…`) and hash (`#widget`) are stripped, as is a trailing
 *   slash (`nutai://log/`).
 * - Returns `null` for non-nutai URLs, a bare `nutai://`, or any path that is
 *   not in the map (those fall through to `app/+not-found.tsx` on the router
 *   side — a friendly screen, not a crash).
 */
export function resolveDeepLink(url: string): string | null {
  const schemeEnd = url.indexOf('://')
  if (schemeEnd <= 0) return null
  const scheme = url.slice(0, schemeEnd).toLowerCase()
  if (scheme !== DEEP_LINK_SCHEME) return null

  let rest = url.slice(schemeEnd + 3)
  const queryAt = rest.indexOf('?')
  if (queryAt !== -1) rest = rest.slice(0, queryAt)
  const hashAt = rest.indexOf('#')
  if (hashAt !== -1) rest = rest.slice(0, hashAt)
  // Trailing-slash tolerance only — a real sub-path (`nutai://log/123`) stays
  // unknown on purpose rather than guessing which segment is the alias.
  rest = rest.replace(/\/+$/, '')
  if (rest.length === 0) return null

  const path = rest.toLowerCase()
  return DEEP_LINK_ROUTES.find((entry) => entry.path === path)?.route ?? null
}
