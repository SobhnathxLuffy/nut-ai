import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOW, isStep, stepIndex, TOTAL_STEPS } from './flow'
import type { OnboardingAnswers } from './store'

/**
 * Owner mandate 2026-10 — the STEPWISE REBUILD (deliberate contract revision,
 * 2026-10-05).
 *
 * The owner first asked for ONE page; on seeing it they asked to go back to
 * one focused question per step. This file pins the CONTRACT of the rebuild,
 * not the pixels:
 *
 *   1. The flow is exactly TWELVE steps on ONE route (app/onboarding/index.tsx
 *      hosts them as internal state) + the plan reveal (/onboarding/plan).
 *      Steps are not routes — the header chevron and Android hardware Back
 *      step between them with state intact.
 *   2. The rail is continuous and labelled: "Step N of 12" with N = 1..12;
 *      the reveal comes after the last step's "See my plan".
 *   3. DATA INTEGRITY — the non-negotiable: the stepwise flow captures
 *      EXACTLY the answer fields the plan generation consumes (plus the new
 *      independent heightUnit). The harvest walks the route files AND the
 *      shared onboarding components.
 *   4. The dead routes are actually dead — nothing in app/, src/ or e2e/
 *      deep-links to a screen that no longer exists. The step ids inside the
 *      host are internal state, never '/onboarding/<id>' paths.
 *   5. RESUME: a draft ('onboarding.draft.v1') persists on every change and
 *      is only read while onboarding is unfinished; completion clears it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(here, '../..')
const ONBOARDING_DIR = join(APP_ROOT, 'app/onboarding')
const COMPONENTS_DIR = join(APP_ROOT, 'src/components/onboarding')

/** The step host + the reveal + the uncounted alternate entry. */
const EXPECTED_FILES = ['_layout.tsx', 'index.tsx', 'plan.tsx', 'restore.tsx'].sort()

/** Screens absorbed into the step host, plus the older merge casualties. */
const DEAD_ROUTES = [
  // absorbed by the stepwise rebuild (owner mandate 2026-10):
  'activity', 'diet', 'accomplish', 'body', 'desired-weight', 'provider',
  'health', 'projection', 'rollover', 'notifications',
  // absorbed by the original 22→12 merge:
  'sex', 'workouts', 'birth', 'height', 'weight', 'professional',
  'blocker', 'apikey', 'trend', 'potential', 'thanks', 'generate',
] as const

/**
 * Every OnboardingAnswers field a SCREEN must still capture after the rebuild.
 * `goal` is deliberately absent: it is DERIVED (inferredGoal) — no screen may
 * ask it, before or after the rebuild. `heightUnit` is NEW: the owner-mandated
 * decoupling of height units from weight units.
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
  'heightUnit',
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

/**
 * Fields the onboarding surfaces write, harvested from their own source —
 * route files AND the shared section components (the step bodies live in
 * src/components/onboarding/).
 */
function capturedFields(): Set<string> {
  const files = [...walk(ONBOARDING_DIR), ...walk(COMPONENTS_DIR)]
  const fields = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    // Three capture forms:
    //   setAnswer('field', …)                 — imperative screens/sections
    //   field: 'field'                        — questionGroup/yesNoGroup specs
    //   field="field"                         — OptionScreen JSX prop
    for (const m of source.matchAll(/setAnswer\(\s*'([A-Za-z]+)'/g)) fields.add(m[1]!)
    for (const m of source.matchAll(/field:\s*'([A-Za-z]+)'/g)) fields.add(m[1]!)
    for (const m of source.matchAll(/field="([A-Za-z]+)"/g)) fields.add(m[1]!)
  }
  return fields
}

describe('owner mandate 2026-10: the flow is TWELVE steps + the reveal', () => {
  it('FLOW is exactly the stepwise sequence', () => {
    expect([...FLOW]).toEqual([
      'welcome', 'sex', 'activity', 'diet', 'accomplish', 'birth',
      'height', 'weight', 'goal-weight', 'provider', 'preferences', 'health',
    ])
    expect(TOTAL_STEPS).toBe(12)
  })

  it('the onboarding directory is exactly the host + plan + restore + layout', () => {
    expect(readdirSync(ONBOARDING_DIR).sort()).toEqual(EXPECTED_FILES)
  })

  it('the rail runs 1..12 and isStep rejects anything outside the machine', () => {
    for (let i = 0; i < FLOW.length; i++) expect(stepIndex(FLOW[i]!)).toBe(i + 1)
    expect(isStep('welcome')).toBe(true)
    expect(isStep('health')).toBe(true)
    expect(isStep('projection')).toBe(false)
    expect(isStep('index')).toBe(false)
    expect(isStep(0)).toBe(false)
  })
})

describe('data integrity — the rebuild drops zero fields, asks no goal', () => {
  it('the steps capture EXACTLY the fields the plan generation consumes (+ heightUnit)', () => {
    const captured = capturedFields()
    expect([...captured].sort()).toEqual([...EXPECTED_FIELDS].sort())
  })

  it('no screen asks the goal — it is derived from the two weights', () => {
    // inferredGoal() reads weightKg/desiredWeightKg; a screen writing `goal`
    // would reintroduce the contradiction the flow deliberately removed.
    expect(capturedFields().has('goal')).toBe(false)
  })

  it('the dead routes are referenced nowhere in app/, src/ or e2e/', () => {
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
    // ProjectionChart survives the rebuild — it renders on the goal-weight
    // step instead of owning a screen.
    expect(charts).toContain('export function ProjectionChart')
    expect(charts).not.toContain('TrendComparisonChart')
    expect(charts).not.toContain('TransitionChart')
    // ProgressChart survives — the plan reveal still uses it.
    expect(charts).toContain('export function ProgressChart')
  })
})

describe('the step host (app/onboarding/index.tsx)', () => {
  const host = readFileSync(join(ONBOARDING_DIR, 'index.tsx'), 'utf8')

  it('renders one focused step at a time from the machine, never a route per step', () => {
    // Every step is a case of the host; steps are internal state.
    for (const step of FLOW) {
      expect(host, `case for step ${step}`).toMatch(new RegExp(`case '${step}':`))
    }
    // No step id ever becomes a route path.
    for (const step of FLOW) {
      expect(host).not.toContain(`/onboarding/${step}`)
    }
  })

  it('"See my plan" exists ONLY on the final step; the reveal route is behind it', () => {
    const finalCase = host.slice(host.indexOf("case 'health':"))
    expect(finalCase).toContain("cta=\"See my plan\"")
    expect(finalCase).toContain("'/onboarding/plan'")
    // No other case may open the reveal or carry the final CTA (prose mentions
    // in the header comment don't count — this is the JSX prop).
    const beforeFinal = host.slice(0, host.indexOf("case 'health':"))
    expect(beforeFinal).not.toContain("'/onboarding/plan'")
    expect(beforeFinal).not.toContain('cta="See my plan"')
  })

  it('hardware Back steps back with state intact; step 1 keeps default behaviour', () => {
    expect(host).toContain('BackHandler.addEventListener')
    expect(host).toMatch(/step === FLOW\[0\]\) return false/)
  })

  it('restores the draft on mount (done key unset only), hydrated before writing', () => {
    expect(host).toContain('loadDraft')
    expect(host).toContain('replaceAnswers')
    expect(host).toContain('ONBOARDING_DONE_KEY')
    // The draft write is gated on hydration — a mount-time save must not be
    // able to clobber the snapshot with empty answers.
    expect(host).toMatch(/if \(!hydrated\) return/)
  })

  it('the restore entry survives on the welcome step (e2e harness depends on it)', () => {
    const welcomeCase = host.slice(host.indexOf("case 'welcome':"), host.indexOf("case 'sex':"))
    expect(welcomeCase).toContain('Restore from a backup')
    expect(welcomeCase).toContain("'/onboarding/restore'")
  })

  it('picker steps commit shown defaults on Continue, clamped to the pickers\' range', () => {
    expect(host).toMatch(/setAnswer\('birthYear', 2000\)/)
    expect(host).toMatch(/a\.heightCm \?\? BODY_DEFAULT_CM/)
    expect(host).toMatch(/a\.weightKg \?\? BODY_DEFAULT_KG/)
    expect(host).toMatch(/setAnswer\('desiredWeightKg', a\.weightKg \?\? BODY_DEFAULT_KG\)/)
    expect(host).toContain('isRealBirthDate')
    // Both picker steps clamp the committed value (HEIGHT_MIN_CM/MAX,
    // WEIGHT_MIN_KG/MAX mirror the wheels/ruler ranges).
    expect(host).toMatch(/clamp\((Number\.isFinite\(raw\) \? raw : BODY_DEFAULT_CM), HEIGHT_MIN_CM, HEIGHT_MAX_CM\)/)
    expect(host).toMatch(/clamp\((Number\.isFinite\(raw\) \? raw : BODY_DEFAULT_KG), WEIGHT_MIN_KG, WEIGHT_MAX_KG\)/)
  })
})

describe('the draft (src/onboarding/draft.ts) — transient, guarded, cleared on completion', () => {
  const draftSrc = readFileSync(join(here, 'draft.ts'), 'utf8')
  const persistSrc = readFileSync(join(here, 'persist.ts'), 'utf8')

  it('lives under its own versioned kv key, documented as not-for-backup', () => {
    expect(draftSrc).toContain("ONBOARDING_DRAFT_KEY = 'onboarding.draft.v1'")
    expect(draftSrc).toMatch(/NOT part of the backup\s*\n?\s*\*? EXPORT_TABLES|never.*EXPORT_TABLES|TRANSIENT AND DERIVABLE/)
  })

  it('validates the step against the flow before resuming', () => {
    expect(draftSrc).toContain('isStep')
  })

  it('persistOnboarding clears the draft after the done key is set', () => {
    expect(persistSrc).toMatch(/await Storage\.setItem\(ONBOARDING_DONE_KEY, 'true'\)/)
    expect(persistSrc).toMatch(/await clearDraft\(\)/)
    const donePos = persistSrc.indexOf("await Storage.setItem(ONBOARDING_DONE_KEY, 'true')")
    const clearPos = persistSrc.indexOf('await clearDraft()')
    expect(clearPos).toBeGreaterThan(donePos)
  })

  it("the dead 'reminders.enabled' settings row stays dead (T5-a)", () => {
    // T4-copyfix found persist.ts writing 'reminders.enabled' with no reader —
    // the notifications system owns reminder state (src/notifications). Per
    // the persist.ts header note, a written-but-unread field is a bug.
    expect(persistSrc).not.toContain("'reminders.enabled'")
  })
})
