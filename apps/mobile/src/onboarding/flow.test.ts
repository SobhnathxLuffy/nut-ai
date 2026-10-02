import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOW, nextRoute, stepIndex, TOTAL_STEPS } from './flow'
import type { OnboardingAnswers } from './store'

/**
 * Wave 3 — UI/UX report Ch 8.1: "Onboarding: 22 screens to 12".
 *
 * This file pins the CONTRACT of the merge, not the pixels:
 *
 *   1. The flow is exactly the twelve steps, in the report's order (plan is the
 *      terminal step because its CTA persists and exits — notifications sits
 *      just before it, as in the pre-merge flow).
 *   2. The progress rail is continuous: every next hop is the next FLOW entry,
 *      and the last step is the reveal. No screen can reset the count.
 *   3. DATA INTEGRITY — the non-negotiable: the merged flow captures EXACTLY
 *      the same answer fields the plan generation consumes as the 22-screen
 *      flow did. Enumerated from the store type, asserted from the screens'
 *      own source (setAnswer / field: / field= forms), before-vs-after diff
 *      encoded as an exact set.
 *   4. The twelve dead routes are actually dead — nothing in app/, src/ or
 *      e2e/ deep-links to a screen that no longer exists.
 */

const here = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(here, '../..')
const ONBOARDING_DIR = join(APP_ROOT, 'app/onboarding')

/** The twelve screens + the uncounted alternate entry, as files on disk. */
const EXPECTED_FILES = [
  '_layout.tsx',
  'accomplish.tsx',
  'activity.tsx',
  'body.tsx',
  'desired-weight.tsx',
  'diet.tsx',
  'health.tsx',
  'index.tsx',
  'notifications.tsx',
  'plan.tsx',
  'projection.tsx',
  'provider.tsx',
  'restore.tsx',
  'rollover.tsx',
].sort()

/** Screens absorbed by a merge or cut as motivational interstitials. */
const DEAD_ROUTES = [
  'sex', 'workouts', 'birth', 'height', 'weight', 'professional',
  'blocker', 'apikey', 'trend', 'potential', 'thanks', 'generate',
] as const

/**
 * Every OnboardingAnswers field a SCREEN must still capture after the merge.
 * `goal` is deliberately absent: it is DERIVED (inferredGoal) — no screen may
 * ask it, before or after the merge.
 */
const EXPECTED_FIELDS: ReadonlySet<keyof OnboardingAnswers> = new Set([
  'sex',
  'workoutsPerWeek',
  'worksWithProfessional',
  'dietStyle',
  'blocker',
  'accomplish',
  'birthYear',
  'birthMonth',
  'birthDay',
  'heightCm',
  'weightKg',
  'units',
  'desiredWeightKg',
  'provider',
  'providerModel',
  'healthConnected',
  'rolloverCalories',
] satisfies ReadonlyArray<keyof OnboardingAnswers>)

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full)
  }
  return out
}

/** Fields the onboarding screens write, harvested from their own source. */
function capturedFields(): Set<string> {
  const files = walk(ONBOARDING_DIR)
  const fields = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    // Three capture forms, one per screen family:
    //   setAnswer('field', …)                 — imperative screens
    //   field: 'field'                        — questionGroup/yesNoGroup specs
    //   field="field"                         — OptionScreen JSX prop
    for (const m of source.matchAll(/setAnswer\(\s*'([A-Za-z]+)'/g)) fields.add(m[1]!)
    for (const m of source.matchAll(/field:\s*'([A-Za-z]+)'/g)) fields.add(m[1]!)
    for (const m of source.matchAll(/field="([A-Za-z]+)"/g)) fields.add(m[1]!)
  }
  return fields
}

describe('Ch 8.1: the flow is twelve steps', () => {
  it('FLOW is exactly the twelve screens, in the report order', () => {
    expect([...FLOW]).toEqual([
      'index', 'activity', 'diet', 'accomplish', 'body', 'desired-weight',
      'provider', 'health', 'projection', 'rollover', 'notifications', 'plan',
    ])
    expect(TOTAL_STEPS).toBe(12)
  })

  it('the onboarding directory is exactly the 12 screens + restore + layout', () => {
    expect(readdirSync(ONBOARDING_DIR).sort()).toEqual(EXPECTED_FILES)
  })

  it('the rail runs 1..12 with no gaps — welcome counts, the reveal finishes', () => {
    expect(stepIndex('index')).toBe(1)
    expect(stepIndex('activity')).toBe(2)
    expect(stepIndex('plan')).toBe(12)
    for (const step of FLOW) expect(stepIndex(step)).toBeGreaterThan(0)
  })

  it('every next hop is the next FLOW entry — the rail can never jump or reset', () => {
    for (let i = 0; i < FLOW.length - 1; i++) {
      expect(nextRoute(FLOW[i]!)).toBe(`/onboarding/${FLOW[i + 1]}`)
    }
    // The terminal step's fallback is the plan itself (it never routes on).
    expect(nextRoute('plan')).toBe('/onboarding/plan')
  })
})

describe('Ch 8.1: data integrity — the merge drops zero fields', () => {
  it('the screens capture EXACTLY the fields the plan generation consumes', () => {
    const captured = capturedFields()
    expect([...captured].sort()).toEqual([...EXPECTED_FIELDS].sort())
  })

  it('no screen asks the goal — it is derived from the two weights', () => {
    // inferredGoal() reads weightKg/desiredWeightKg; a screen writing `goal`
    // would reintroduce the contradiction the flow deliberately removed.
    expect(capturedFields().has('goal')).toBe(false)
  })

  it('the twelve dead routes are referenced nowhere in app/, src/ or e2e/', () => {
    const trees = ['app', 'src', 'e2e'].map((t) => join(APP_ROOT, t))
    const offenders: string[] = []
    for (const route of DEAD_ROUTES) {
      for (const tree of trees) {
        for (const file of walk(tree)) {
          const source = readFileSync(file, 'utf8')
          if (source.includes(`/onboarding/${route}`)) {
            offenders.push(`${route} referenced in ${file}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the deleted chart components went with their screens', () => {
    const charts = readFileSync(join(here, '../components/onboarding/Charts.tsx'), 'utf8')
    expect(charts).toContain('export function ProjectionChart')
    expect(charts).not.toContain('TrendComparisonChart')
    expect(charts).not.toContain('TransitionChart')
    // ProgressChart survives — the plan reveal still uses it.
    expect(charts).toContain('export function ProgressChart')
  })
})
