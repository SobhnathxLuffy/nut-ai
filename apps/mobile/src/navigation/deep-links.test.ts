import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEEP_LINK_ROUTES, DEEP_LINK_SCHEME, resolveDeepLink } from './deep-links'

/**
 * Wave 4c — the nutai:// deep-link handler (UI/UX report §7.2 / Table 7.1).
 *
 * The resolver is pure, so every behaviour of the scheme map locks here in the
 * plain-Node vitest environment; the router wiring is additionally pinned by
 * source inspection (the alias files + the not-found fallback) following the
 * repo precedent (wave3.test.ts's DayTimeline assertions). Browser behaviour
 * is covered by e2e/wave4.spec.ts against the exported bundle.
 */

/** Repo paths, resolved relative to this test file. */
const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '../../app')
const readApp = (name: string) => readFileSync(join(appDir, name), 'utf8')

/**
 * Candidate route files for a route string. `/` is the (tabs) index; any other
 * segment may live top-level (app/camera.tsx) or inside the URL-transparent
 * (tabs) group (app/(tabs)/food.tsx) — both spell the same URL.
 */
function routeFileCandidates(route: string): string[] {
  if (route === '/') return [join(appDir, '(tabs)', 'index.tsx')]
  const segment = route.slice(1)
  return [join(appDir, `${segment}.tsx`), join(appDir, '(tabs)', `${segment}.tsx`)]
}

describe('resolveDeepLink: the nutai:// alias map', () => {
  it('resolves every table entry exactly (table-mapping exactness)', () => {
    expect(DEEP_LINK_ROUTES).toHaveLength(9)
    for (const entry of DEEP_LINK_ROUTES) {
      expect(resolveDeepLink(`${DEEP_LINK_SCHEME}://${entry.path}`)).toBe(entry.route)
    }
  })

  it('maps the known aliases to their real routes', () => {
    expect(resolveDeepLink('nutai://scan')).toBe('/camera')
    expect(resolveDeepLink('nutai://log')).toBe('/food')
    expect(resolveDeepLink('nutai://home')).toBe('/')
    expect(resolveDeepLink('nutai://day')).toBe('/day-detail')
    expect(resolveDeepLink('nutai://train')).toBe('/train')
    expect(resolveDeepLink('nutai://workout')).toBe('/workout')
    expect(resolveDeepLink('nutai://assistant')).toBe('/assistant')
    expect(resolveDeepLink('nutai://progress')).toBe('/progress')
    expect(resolveDeepLink('nutai://weight')).toBe('/log-weight')
  })

  it('is case-insensitive for both scheme and host', () => {
    expect(resolveDeepLink('NUTAI://SCAN')).toBe('/camera')
    expect(resolveDeepLink('Nutai://Log')).toBe('/food')
    expect(resolveDeepLink('nutai://Progress')).toBe('/progress')
    expect(resolveDeepLink('NUTAI://Weight')).toBe('/log-weight')
  })

  it('strips query strings, hashes and trailing slashes', () => {
    expect(resolveDeepLink('nutai://log?date=2026-10-05')).toBe('/food')
    // The day alias carries its target day in the query — resolution maps the
    // alias; the route file owns the param (a bare nutai://day lands on today).
    expect(resolveDeepLink('nutai://day?date=2026-10-05')).toBe('/day-detail')
    expect(resolveDeepLink('nutai://scan#widget')).toBe('/camera')
    expect(resolveDeepLink('nutai://log/')).toBe('/food')
    expect(resolveDeepLink('nutai://scan/?src=widget#tap')).toBe('/camera')
  })

  it('returns null for unknown paths, sub-paths, non-nutai URLs and a bare scheme', () => {
    expect(resolveDeepLink('nutai://nope')).toBeNull()
    // A real route name is NOT an alias — the resolver only maps the table;
    // nutai://camera is linked directly by expo-router's own route matching.
    expect(resolveDeepLink('nutai://camera')).toBeNull()
    expect(resolveDeepLink('nutai://log/123')).toBeNull()
    expect(resolveDeepLink('https://nutai.example/scan')).toBeNull()
    expect(resolveDeepLink('https://example.com')).toBeNull()
    expect(resolveDeepLink('nutai://')).toBeNull()
    expect(resolveDeepLink('nutai:///')).toBeNull()
    expect(resolveDeepLink('nutai:log')).toBeNull()
    expect(resolveDeepLink('')).toBeNull()
  })
})

describe('the map points only at real routes (source inspection)', () => {
  it('every mapped route has a route file in app/ or app/(tabs)/', () => {
    for (const entry of DEEP_LINK_ROUTES) {
      const found = routeFileCandidates(entry.route).some((candidate) => existsSync(candidate))
      expect(found, `route ${entry.route} (alias "${entry.path}") matches no route file`).toBe(true)
    }
  })

  it('the three semantic aliases have alias route files that redirect through DeepLinkRedirect', () => {
    for (const name of ['scan.tsx', 'log.tsx', 'home.tsx']) {
      const source = readApp(name)
      expect(source).toContain('DeepLinkRedirect')
      expect(source).toContain('export default')
    }
  })

  it('unknown links land on the +not-found Empty fallback with a way home', () => {
    const source = readApp('+not-found.tsx')
    expect(source).toContain('Empty')
    expect(source).toContain("This link doesn't go anywhere")
    expect(source).toContain('Go home')
    // The Go-home action routes back to the Home tab (typed-routes `as never`
    // cast convention).
    expect(source).toContain('router.replace')
  })
})
