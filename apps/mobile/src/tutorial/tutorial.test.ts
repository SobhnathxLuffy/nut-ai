import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The key module reaches for the expo kv singleton — the unit suite runs on
// the node environment with the store mocked (same pattern as persist.test.ts).
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))

import { markTutorialSeen, readTutorialSeen, shouldAutoShowTutorial, TUTORIAL_SEEN_KEY } from './key'
import { PROFILE_GROUPS } from '../settings/profile-groups'

/**
 * The post-onboarding walkthrough (owner item #3) — the completion-STATE
 * contract. Shown ONCE, replayable from Profile, never trapping, and never
 * armed by the backup-restore path.
 *
 * Seams under test (agreed up front):
 *   1. `shouldAutoShowTutorial(seen)` — the pure auto-launch policy;
 *   2. `readTutorialSeen` / `markTutorialSeen` — the durable seen marker;
 *   3. source sweeps of the wiring points (the screens sit behind expo
 *      imports the node environment cannot load — the established wave3
 *      source-sweep pattern).
 */

const here = dirname(fileURLToPath(import.meta.url))
const app = (...parts: string[]) => readFileSync(join(here, '..', '..', 'app', ...parts), 'utf8')
const repoSrc = () => readFileSync(join(here, '..', 'data', 'repo.ts'), 'utf8')

let store: Map<string, string>

beforeEach(async () => {
  vi.clearAllMocks()
  store = new Map()
  const { default: Storage } = await import('expo-sqlite/kv-store')
  // vi.mocked narrows to the REAL module's signatures (the vi.mock factory is
  // runtime-only), so the implementations must match them exactly.
  vi.mocked(Storage.getItem).mockImplementation(async (key: string) => store.get(key) ?? null)
  type SetItemValue = Parameters<typeof Storage.setItem>[1]
  vi.mocked(Storage.setItem).mockImplementation(async (key: string, value: SetItemValue) => {
    store.set(key, typeof value === 'string' ? value : '')
  })
})

describe('shown-once semantics (the auto-launch policy)', () => {
  it('auto-launches on a fresh completion only — the seen flag suppresses it', () => {
    expect(shouldAutoShowTutorial(null)).toBe(true)
    expect(shouldAutoShowTutorial('true')).toBe(false)
    // A corrupt value is not a "seen" — showing a skippable card twice is the
    // smaller failure than never showing it.
    expect(shouldAutoShowTutorial('corrupt')).toBe(true)
  })

  it('the seen key lives in the same kv-store vocabulary as the onboarding keys', () => {
    expect(TUTORIAL_SEEN_KEY).toBe('tutorial.seen.v1')
  })

  it('marks seen durably and idempotently — replaying can never re-arm it', async () => {
    await markTutorialSeen()
    await markTutorialSeen()
    expect(store.get(TUTORIAL_SEEN_KEY)).toBe('true')
    expect(shouldAutoShowTutorial(await readTutorialSeen())).toBe(false)
  })

  it('exposes no un-arm path: the module never deletes the seen key', async () => {
    await markTutorialSeen()
    const keyModule = await import('./key')
    for (const value of Object.values(keyModule)) {
      if (typeof value === 'function') {
        expect(value.name).not.toMatch(/clear|delete|remove|reset/i)
      }
    }
    expect(store.get(TUTORIAL_SEEN_KEY)).toBe('true')
  })

  it('a full walkthrough dismissal (skip OR finish) always marks seen', () => {
    const src = readFileSync(join(here, 'Tutorial.tsx'), 'utf8')
    // The ONE dismiss helper both Skip and Finish ride: the call site is
    // unique (the import does not count as a call).
    expect(src).toContain('markTutorialSeen')
    expect(src).toContain('router.back()')
    expect((src.match(/markTutorialSeen\(/g) ?? []).length).toBe(1)
  })
})

describe('wiring — where the tutorial may and may not launch from', () => {
  it('launches from the onboarding plan-reveal completion, after the tabs replace', () => {
    const plan = app('onboarding', 'plan.tsx')
    expect(plan).toContain('persistOnboarding')
    expect(plan).toContain("router.replace('/(tabs)'")
    expect(plan).toContain('shouldAutoShowTutorial')
    expect(plan).toContain("router.push('/tutorial'")
    // Order: the tabs replace precedes the tutorial push, so hardware Back
    // from the walkthrough lands on Home (never trapped, §8.2).
    expect(plan.indexOf("router.replace('/(tabs)'")).toBeLessThan(plan.indexOf("router.push('/tutorial'"))
  })

  it('the restore path never arms the walkthrough (restoring users know the app)', () => {
    const restore = app('onboarding', 'restore.tsx')
    const backup = readFileSync(join(here, '..', 'data', 'backup.ts'), 'utf8')
    expect(restore.toLowerCase()).not.toContain('tutorial')
    expect(backup.toLowerCase()).not.toContain('tutorial')
  })

  it('no tabs-mount gate exists — the only auto-launch is the plan completion', () => {
    const tabsLayout = app('(tabs)', '_layout.tsx')
    expect(tabsLayout.toLowerCase()).not.toContain('tutorial')
  })

  it('is replayable from the Profile About group, following the row contract', () => {
    const about = PROFILE_GROUPS.find((g) => g.key === 'about')
    expect(about).toBeDefined()
    const row = about!.rows.find((r) => r.key === 'tutorial')
    expect(row).toMatchObject({ label: 'Replay the tutorial', route: '/tutorial' })
    expect(row!.icon.length).toBeGreaterThan(0)
    // Every route stays unique — the wave3-profile uniqueness contract.
    const routes = PROFILE_GROUPS.flatMap((g) => g.rows.map((r) => r.route))
    expect(routes).toHaveLength(new Set(routes).size)
  })

  it('resetEverything clears the seen marker alongside the onboarding keys', () => {
    const src = repoSrc()
    expect(src).toContain('TUTORIAL_SEEN_KEY')
    expect(src).toContain('ONBOARDING_DRAFT_KEY')
    expect(src).toContain('removeItem(TUTORIAL_SEEN_KEY)')
    expect(src).toContain('removeItem(ONBOARDING_DRAFT_KEY)')
  })

  it('registers app/tutorial.tsx as a route that renders the shared component', () => {
    const route = app('tutorial.tsx')
    expect(route).toContain('../src/tutorial/Tutorial')
    expect(route).toMatch(/export default/)
  })
})

describe('the walkthrough screen is built from the design-system primitives', () => {
  const src = readFileSync(join(here, 'Tutorial.tsx'), 'utf8')

  it('uses Screen, Card, Label, Button and Icon — no hand-rolled siblings', () => {
    expect(src).toContain("from '../components/Screen'")
    expect(src).toContain("from '../components/Icon'")
    expect(src).toMatch(/<Screen\b/)
    expect(src).toMatch(/<Card\b/)
    expect(src).toMatch(/<Button\b/)
    expect(src).toMatch(/<Label\b/)
  })

  it('Skip is visible on every card, Back appears after the first, Finish on the last', () => {
    expect(src).toContain("last ? 'Finish' : 'Next'")
    expect(src).toContain('Skip')
    expect(src).toContain('index > 0')
  })

  it('carries the progress indicator "Card N of M" and decorative dots', () => {
    expect(src).toContain('Card ${index + 1} of ${TUTORIAL_CARDS.length}')
    expect(src).toMatch(/accessibilityElementsHidden/)
  })
})
