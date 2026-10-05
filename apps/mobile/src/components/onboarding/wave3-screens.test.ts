import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cmToFtIn, ftInToCm } from '../../data/height-units'

/**
 * Owner mandate 2026-10 source pins for the STEPWISE onboarding rebuild
 * (deliberate contract revision, 2026-10-05 — supersedes the single-page pins).
 *
 * The owner asked one focused question per step again. The step host
 * (app/onboarding/index.tsx) owns the chrome and the step machine; the step
 * bodies live in src/components/onboarding/OnboardingSections.tsx with the
 * controls extracted verbatim from the pre-merge steps. app/ routes and RN
 * component modules sit behind expo-router/react-native imports the
 * plain-Node vitest environment cannot load (the established pattern), so
 * their contracts are pinned against source; the runtime side is covered by
 * the Playwright e2e walk.
 *
 * Height units are DECOUPLED from weight units: `units` drives the weight
 * pickers only; `heightUnit` drives the height pickers. All four combinations
 * (kg/cm, kg/ft+in, lb/cm, lb/ft+in) must work, canonical answers stay metric.
 */

const here = dirname(fileURLToPath(import.meta.url))
const screen = (name: string): string => readFileSync(join(here, '../../../app/onboarding', name), 'utf8')
const section = (name: string): string => readFileSync(join(here, name), 'utf8')

const HOST = screen('index.tsx')
const SECTIONS = section('OnboardingSections.tsx')

describe('stepwise host — one focused question per step, honest CTAs', () => {
  it('every step body renders through the step switch', () => {
    for (const section of [
      'UnitsSection',
      'SexSection',
      'ActivitySection',
      'DietSection',
      'AccomplishSection',
      'BirthSection',
      'HeightSection',
      'WeightSection',
      'DesiredWeightSection',
      'ProviderSection',
      'PreferencesSection',
      'HealthSection',
    ]) {
      expect(HOST, `${section} is a step body`).toContain(section)
    }
  })

  it('intermediate steps keep the default "Continue"; only the last step says "See my plan"', () => {
    // OnboardingScreen's CTA default is 'Continue' — no intermediate case may
    // override it with a plan-reveal or finish wording.
    for (const banned of ['Let\'s get started', 'Start Nut AI', 'Finish']) {
      expect(HOST, `no "${banned}" on question steps`).not.toContain(banned)
    }
    const finalCase = HOST.slice(HOST.indexOf("case 'health':"))
    expect(finalCase).toContain('cta="See my plan"')
  })

  it('the grouped gate hint stays honest on merged question steps', () => {
    expect(HOST).toContain('Answer every question to continue')
  })

  it('the restore entry stays on the welcome step (e2e harness depends on it)', () => {
    const welcomeCase = HOST.slice(HOST.indexOf("case 'welcome':"), HOST.indexOf("case 'sex':"))
    expect(welcomeCase).toContain('Restore from a backup')
  })
})

describe('resume — the draft is the one new persistence piece', () => {
  it('the host hydrates from the draft before it ever writes one', () => {
    expect(HOST).toContain('loadDraft')
    expect(HOST).toContain('replaceAnswers')
    expect(HOST).toContain('saveDraft')
    expect(HOST).toMatch(/if \(!hydrated\) return/)
  })
})

describe('independent units — height decoupled from weight', () => {
  it('the old combined toggle is gone', () => {
    expect(SECTIONS).not.toContain('lb · ft, in')
    expect(SECTIONS).not.toContain('kg · cm')
  })

  it('two independent toggles, each the only writer of its answer', () => {
    // Weight: the 'units' answer (user_profile.units + weight.displayUnit
    // semantics unchanged). Height: the new 'heightUnit' answer.
    expect(SECTIONS).toMatch(/label: 'kg'/)
    expect(SECTIONS).toMatch(/label: 'lb'/)
    expect(SECTIONS).toMatch(/setAnswer\('units', u\)/)
    expect(SECTIONS).toMatch(/label: 'cm'/)
    expect(SECTIONS).toMatch(/label: 'ft \+ in'/)
    expect(SECTIONS).toMatch(/setAnswer\('heightUnit', u\)/)
    // Each step carries its OWN toggle; the welcome step carries both.
    expect(SECTIONS).toContain('WeightUnitToggle')
    expect(SECTIONS).toContain('HeightUnitToggle')
    const welcome = HOST.slice(HOST.indexOf("case 'welcome':"), HOST.indexOf("case 'sex':"))
    expect(welcome).toContain('<UnitsSection />')
  })

  it('all four combinations convert at the picker boundary only — canonical stays cm/kg', () => {
    // The height pickers write canonical cm through the shared helpers.
    expect(SECTIONS).toMatch(/onChange=\{\(v\) => setAnswer\('heightCm', ftInToCm\(v, inch\)\)\}/)
    expect(SECTIONS).toMatch(/onChange=\{\(v\) => setAnswer\('heightCm', ftInToCm\(ft, v\)\)\}/)
    expect(SECTIONS).toMatch(/onChange=\{\(v\) => setAnswer\('heightCm', v\)\}/)
    // The weight pickers write canonical kg (lb converted at the boundary).
    expect(SECTIONS).toMatch(/setAnswer\('weightKg', imperial \? lbToKg\(v\) : v\)/)
    // Display reads derive from canonical — switching units converts, never resets.
    expect(SECTIONS).toMatch(/const \{ ft, inch \} = cmToFtIn\(cm\)/)
    expect(SECTIONS).toMatch(/const shownWeight = imperial \? kgToLb\(kg\) : kg/)
  })

  it('the height unit flows through persistence as its own settings key', () => {
    const persist = readFileSync(join(here, '../../onboarding/persist.ts'), 'utf8')
    expect(persist).toMatch(/\['height\.displayUnit', answers\.heightUnit\]/)
    // The weight path is untouched.
    expect(persist).toMatch(/answers\.units === 'imperial' \? 'lb' : 'kg'/)
  })
})

describe('height clamp consistency — one canonical range for every commit path (T5-fix2, review nice-to-have 6)', () => {
  // The bug: the ft/in EditableValue accepted 8 ft 11 in = 271.8 cm while the
  // step's Continue clamps to 250 cm — the committed value silently differed
  // from the shown one at the extremes.
  it('the ft/in EditableValue commit clamps with the SAME bounds the host Continue clamps', () => {
    // Single source of truth: the bounds live in OnboardingSections (next to
    // the sections that commit heights); the host imports them.
    expect(SECTIONS).toMatch(/export const HEIGHT_MIN_CM = 60\.96/)
    expect(SECTIONS).toMatch(/export const HEIGHT_MAX_CM = 250/)
    expect(HOST).toMatch(/import \{[^}]*HEIGHT_MIN_CM,[^}]*\} from '\.\.\/\.\.\/src\/components\/onboarding\/OnboardingSections'/)
    expect(HOST).toMatch(/import \{[^}]*HEIGHT_MAX_CM,[^}]*\} from '\.\.\/\.\.\/src\/components\/onboarding\/OnboardingSections'/)
    expect(SECTIONS).toMatch(
      /setAnswer\('heightCm', clamp\(ftInToCm\(Math\.floor\(total \/ 12\), total % 12\), HEIGHT_MIN_CM, HEIGHT_MAX_CM\)\)/,
    )
    // The host's Continue clamp is unchanged (the flow pins already cover its
    // shape) — the two paths now share the constants instead of diverging.
    expect(HOST).toMatch(/clamp\(Number\.isFinite\(raw\) \? raw : BODY_DEFAULT_CM, HEIGHT_MIN_CM, HEIGHT_MAX_CM\)/)
  })

  it('the bounds are coherent with the ft/in conversion math they clamp', () => {
    // The floor IS the ft wheel's bottom (2 ft); the ceiling stays the cm
    // wheel's top, and the ft/in input range (24–107 in) can no longer commit
    // past it: 8 ft 2 in fits, 8 ft 3 in clamps back.
    expect(ftInToCm(2, 0)).toBeCloseTo(60.96, 10)
    expect(cmToFtIn(250)).toEqual({ ft: 8, inch: 2 })
    expect(ftInToCm(8, 2)).toBeLessThanOrEqual(250)
    expect(ftInToCm(8, 3)).toBeGreaterThan(250)
  })
})

describe('grouped question steps keep the grouped gate + radiogroup semantics', () => {
  it('the question groups survive the split (sex / workouts+professional / diet+blocker / rollover)', () => {
    expect(SECTIONS).toMatch(/field: 'sex'/)
    expect(SECTIONS).toMatch(/field: 'workoutsPerWeek'/)
    expect(SECTIONS).toMatch(/field: 'worksWithProfessional'/)
    expect(SECTIONS).toMatch(/field: 'dietStyle'/)
    expect(SECTIONS).toMatch(/field: 'blocker'/)
    expect(SECTIONS).toMatch(/field: 'rolloverCalories'/)
  })

  it('question groups carry radiogroup semantics (a11y + e2e scoping)', () => {
    const src = readFileSync(join(here, 'OptionScreen.tsx'), 'utf8')
    expect(src).toContain('accessibilityRole="radiogroup"')
    expect(src).toContain('accessibilityLabel={g.label}')
  })
})

describe('body steps — the pickers stay verbatim', () => {
  it('birth wheels, height wheels and the weight ruler are one per step', () => {
    expect(SECTIONS).toContain('WheelHighlight')
    expect(SECTIONS).toMatch(/label="Month"/)
    expect(SECTIONS).toMatch(/label="Feet"/)
    expect(SECTIONS).toContain('RulerPicker')
    expect(SECTIONS).toContain('EditableValue')
  })

  it('every numeric field is written by a section or by the Continue commit', () => {
    for (const field of ['birthYear', 'birthMonth', 'birthDay', 'heightCm', 'weightKg']) {
      expect(SECTIONS).toMatch(new RegExp(`setAnswer\\('${field}'`))
    }
    // Defaults commit on Continue (the host), clamped to the picker ranges.
    expect(HOST).toMatch(/BODY_DEFAULT_CM/)
    expect(HOST).toMatch(/BODY_DEFAULT_KG/)
  })

  it('the keyboard cannot hide the docked CTA (AGENTS §8.3)', () => {
    const chrome = readFileSync(join(here, 'Chrome.tsx'), 'utf8')
    expect(chrome).toContain('KeyboardAvoidingView')
    expect(chrome).toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/)
  })

  it('the chrome states "Step N of M" beside the progress bar', () => {
    const chrome = readFileSync(join(here, 'Chrome.tsx'), 'utf8')
    expect(chrome).toMatch(/Step \{step\} of \{total\}/)
    expect(chrome).toContain('accessibilityRole="progressbar"')
  })

  it('step transitions are announced: header role on the title, live region on the step caption (T4-c P1-2)', () => {
    const chrome = readFileSync(join(here, 'Chrome.tsx'), 'utf8')
    expect(chrome).toMatch(/accessibilityRole="header" style=\{\[styles\.title/)
    expect(chrome).toMatch(/accessibilityLiveRegion="polite"/)
  })

  it('wheels expose their current value to screen readers (T4-c P1-1)', () => {
    const controls = readFileSync(join(here, 'Controls.tsx'), 'utf8')
    expect(controls).toMatch(
      /accessibilityValue=\{\{\s*min: items\[0\]\?\.value \?\? 0,\s*max: items\[items\.length - 1\]\?\.value \?\? 0,\s*now: value,\s*\}\}/,
    )
    expect(controls).toContain('accessibilityLiveRegion="polite"')
  })
})

describe('provider step — the shared CredentialForm stays inline', () => {
  it('the form is embedded, remounting per provider', () => {
    expect(SECTIONS).toContain('CredentialForm')
    expect(SECTIONS).toMatch(/key=\{realProvider\}/)
  })

  it('a verified key reports the model id; no-key means provider none, persisted eagerly', () => {
    expect(SECTIONS).toMatch(/setAnswer\('providerModel', modelId\)/)
    expect(SECTIONS).toMatch(/putSetting\('provider', 'none'\)/)
    expect(SECTIONS).toContain('No key for now')
  })

  it('the provider step gates on the verified key or the skip choice', () => {
    expect(SECTIONS).toMatch(/const ready = a\.provider === 'none' \|\| \(realProvider != null && saved\)/)
    expect(HOST).toMatch(/ctaDisabled=\{!providerReady\}/)
    expect(HOST).toContain('onReadyChange={setProviderReady}')
  })

  it('the gate re-arms from the durable provider row after Back or a draft resume', () => {
    // The section remounts per visit (the host renders ONE step at a time), so
    // its "verified" flag must reconcile from the settings row verify() writes
    // eagerly — a component-level flag would re-lock Continue with a working
    // key. The row unlocks only when it names the CURRENTLY selected provider.
    expect(SECTIONS).toMatch(/const persisted = await setting\('provider'\)/)
    expect(SECTIONS).toMatch(/if \(alive && persisted === a\.provider\) setSaved\(true\)/)
  })
})

describe('goal-weight step — the direction preview and the honest underweight note', () => {
  it('one chart, following the real goal direction; the note never blocks', () => {
    expect(SECTIONS).toContain('ProjectionChart')
    expect(SECTIONS).toMatch(/inferredGoal\(a\) === 'gain'/)
    expect(SECTIONS).not.toContain('TrendComparisonChart')
    expect(SECTIONS).not.toContain('TransitionChart')
    expect(SECTIONS).toContain('below a BMI of 18.5')
    // Non-blocking: the step's gate never references the underweight flag.
    const goalCase = HOST.slice(HOST.indexOf("case 'goal-weight':"), HOST.indexOf("case 'provider':"))
    expect(goalCase).not.toMatch(/underweight|UNDERWEIGHT/)
  })

  it('the fused chart carries BOTH moments: the comparison and the early milestones', () => {
    const src = readFileSync(join(here, 'Charts.tsx'), 'utf8')
    expect(src).toMatch(/Without a plan/)
    expect(src).toContain('First 30 days')
    // Milestone dots at 3 days, a week, a month — the old potential screen's job.
    expect(src).toMatch(/milestone\(18\)/)
    expect(src).toMatch(/milestone\(32\)/)
    expect(src).toMatch(/milestone\(62\)/)
  })
})

describe('preferences step — rollover + reminders copy verbatim', () => {
  it('the rollover question is a real group; the cap copy survives', () => {
    expect(SECTIONS).toContain('restrict-then-binge')
    expect(SECTIONS).toMatch(/ROLLOVER_CAP_KCAL/)
  })

  it('the reminders copy keeps its honesty (permission requested later, not now)', () => {
    expect(SECTIONS).toContain("A nudge when you'd usually log")
    expect(SECTIONS).toContain('worth sending, not now')
  })

  it('the reminders lie stays dead on the plan reveal (T4-copyfix / T5-a)', () => {
    const plan = screen('plan.tsx')
    expect(SECTIONS).not.toContain('learned from when you actually log')
    expect(plan).not.toContain('learned from when you actually log')
    // The plan bullet now repeats the truthful phrasing: optional, off by
    // default, times chosen later in Profile → Notifications.
    expect(plan).toContain('optional and off by default')
    expect(plan).toContain('Profile → Notifications')
  })
})

describe('health step — Android honesty (T4-b / T5-a)', () => {
  it('no working Health Connect sync is promised; the step is optional', () => {
    // The old note promised unbuilt integration ("this will use Health
    // Connect instead"); the note now marks it as not available yet.
    expect(SECTIONS).not.toContain('this will use Health Connect instead')
    expect(SECTIONS).toContain('built yet')
    // The step subtitle is platform-neutral and honest for both.
    const healthCase = HOST.slice(HOST.indexOf("case 'health':"))
    expect(healthCase).toContain('iOS-only for now')
    expect(healthCase).not.toContain('Connect Apple Health')
  })

  it('the "See my plan" push is guarded against double-taps like the plan CTA (T5-fix2, review nice-to-have 5)', () => {
    // The push used to be unguarded: a double-tap stacked /onboarding/plan
    // twice (plan's own busy ref kept the persist single, but the stack was
    // wrong). Same busy-ref pattern; the ref re-arms on focus, because the way
    // back here is RETURNING from the plan screen — that must leave the CTA
    // usable (a push cannot fail the way a persist can, so plan.tsx's
    // catch-re-arm has no counterpart here).
    const healthCase = HOST.slice(HOST.indexOf("case 'health':"))
    expect(healthCase).toMatch(/if \(planNavBusy\.current\) return/)
    expect(healthCase).toContain('planNavBusy.current = true')
    expect(HOST).toMatch(/useFocusEffect\(useCallback\(\(\) => \{ planNavBusy\.current = false \}, \[\]\)\)/)
  })
})

describe('plan reveal — the hero moment (Ch 8.1, unchanged by the rebuild)', () => {
  const src = screen('plan.tsx')

  it('the hero numbers count up in monoData tabular figures via CountUp', () => {
    expect(src).toContain("from '../../src/components/ProgressRing'")
    expect(src).toMatch(/<CountUp\s+value=\{plan\.target\.target\}/)
    expect(src).toMatch(/format=\{\(n\) => `\$\{Math\.round\(n\)\}g`\}/)
    expect(src).toMatch(/\.\.\.type\.monoData, fontSize: type\.display\.fontSize/)
  })

  it('the breakdown expands with a SPRING, gated on reduce-motion', () => {
    expect(src).toMatch(/Animated\.spring\(/)
    expect(src).toContain('useReducedMotion')
    expect(src).toMatch(/if \(reduced\) return/)
  })

  it('a success haptic marks the finish, through the shared haptics map', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/src\/utils\/haptics'/)
    expect(src).toMatch(/void success\(\)/)
  })

  it('persist-before-navigate survives the rebuild (P3 contract)', () => {
    expect(src).toMatch(/persistOnboarding\(a, plan\.target, plan\.macros\)/)
    expect(src).toMatch(/router\.replace\('\/\(tabs\)'/)
  })

  it('the final CTA is guarded against double-taps and surfaces persist failure (§8.3/§8.4, T5-a)', () => {
    // One tap = one persist + one tutorial push, ever; a re-tap while busy
    // returns early. Failure re-arms the CTA and reports honestly via the
    // error toast — never a silent dead button.
    expect(src).toMatch(/if \(busy\.current\) return/)
    expect(src).toMatch(/busy\.current = true/)
    expect(src).toMatch(/\.catch\(\(e\) => \{/)
    expect(src).toMatch(/busy\.current = false/)
    expect(src).toContain("tone: 'error'")
  })
})
