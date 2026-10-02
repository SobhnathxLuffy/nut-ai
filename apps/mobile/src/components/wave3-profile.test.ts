import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROFILE_GROUPS,
  formatDiagnosticsValue,
  formatGoalsValue,
  formatProviderValue,
  formatWeightValue,
  groupDigits,
  profileRoutes,
} from '../settings/profile-groups'

/**
 * UI/UX report Ch 8.8 (Wave 3) — "Profile and settings: progressive
 * disclosure": the Profile tab becomes an iOS grouped list of Item rows with
 * sub-pages (Goals / AI Provider / Units & Health / Data / About) plus a
 * diagnostics page that becomes the home for debug-class information.
 *
 * The app/ screens sit behind expo imports vitest's node environment cannot
 * load, so their wiring is pinned by SOURCE SWEEP (the established pattern —
 * wave3-food.test.ts, wave3-home.test.ts). The grouped-list STRUCTURE and the
 * muted-value formatters live in the node-pure src/settings/profile-groups.ts
 * and are unit-tested directly below.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(here, '..', '..', 'app', ...parts), 'utf8')

const profileTab = read('(tabs)', 'profile.tsx')
const providerSettings = read('provider-settings.tsx')
const unitsHealth = read('settings-units-health.tsx')
const dataSettings = read('settings-data.tsx')
const aboutSettings = read('settings-about.tsx')
const diagnostics = read('diagnostics.tsx')
const disclosureSrc = readFileSync(join(here, 'Disclosure.tsx'), 'utf8')
const profileGroupsSrc = readFileSync(join(here, '..', 'settings', 'profile-groups.ts'), 'utf8')

describe('Ch 8.8 — the grouped-list structure (pure module)', () => {
  it('ships the report\'s five groups plus the Diagnostics group, in order', () => {
    expect(PROFILE_GROUPS.map((g) => g.title)).toEqual([
      'Goals',
      'AI provider',
      'Units & health',
      'Your data',
      'About',
      'Diagnostics',
    ])
  })

  it('every row navigates — no dead display rows at this level', () => {
    for (const group of PROFILE_GROUPS) {
      for (const row of group.rows) {
        expect(row.route.startsWith('/')).toBe(true)
        expect(row.icon.length).toBeGreaterThan(0)
        expect(row.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('every power option is ≤2 taps away: all sub-pages are routed from the list', () => {
    const routes = profileRoutes()
    expect(routes).toEqual(
      expect.arrayContaining([
        '/edit-goals',
        '/log-weight',
        '/provider-settings',
        '/settings-units-health',
        '/settings-data',
        '/data-methods',
        '/settings-about',
        '/diagnostics',
      ]),
    )
    expect(routes).toHaveLength(new Set(routes).size)
  })

  it('"How food & dish data works" stays reachable from the About group', () => {
    const about = PROFILE_GROUPS.find((g) => g.key === 'about')!
    expect(about.rows.some((r) => r.route === '/data-methods')).toBe(true)
  })
})

describe('Ch 8.8 — the muted value formatters (pure, live-read inputs)', () => {
  it('goals value: the report\'s own example format', () => {
    expect(formatGoalsValue(null)).toBe('Not set yet')
    expect(
      formatGoalsValue({
        goalType: 'maintain',
        targetKcal: 2487.4,
        targetRawKcal: 2487.4,
        floorApplied: false,
        protein_g: 125,
        fat_g: 70,
        carbs_g: 300,
        bmr: 1600,
        tdee: 2487,
        adaptive: false,
        effectiveFrom: 0,
      }),
    ).toBe('2,487 kcal · maintain')
    expect(
      formatGoalsValue({
        goalType: 'lose',
        targetKcal: 1800,
        targetRawKcal: 1650,
        floorApplied: true,
        protein_g: 120,
        fat_g: 60,
        carbs_g: 200,
        bmr: 1500,
        tdee: 2300,
        adaptive: true,
        effectiveFrom: 0,
      }),
    ).toBe('1,800 kcal · lose · adaptive')
  })

  it('weight value: newest entry in the display unit, honest empty state', () => {
    expect(formatWeightValue(null, 'kg')).toBe('No entries yet')
    expect(formatWeightValue(74.03, 'kg')).toBe('74.0 kg')
    expect(formatWeightValue(74.03, 'lb')).toBe('163.2 lb')
  })

  it('provider and diagnostics values: masked key, provider + gateway host', () => {
    expect(formatProviderValue('OpenAI', null)).toBe('OpenAI')
    expect(formatProviderValue('OpenAI', 'sk-…bdcd')).toBe('OpenAI · sk-…bdcd')
    expect(formatDiagnosticsValue(null, null)).toBe('Not connected')
    expect(formatDiagnosticsValue('OpenAI', 'aicredits.in')).toBe('OpenAI · aicredits.in')
    expect(formatDiagnosticsValue('OpenAI', null)).toBe('OpenAI')
  })

  it('groupDigits: en-US grouping', () => {
    expect(groupDigits(2487)).toBe('2,487')
    expect(groupDigits(999)).toBe('999')
    expect(groupDigits(1_000_000)).toBe('1,000,000')
  })
})

describe('Ch 8.8 — profile.tsx is a grouped list of rows, not the 8-section scroll', () => {
  it('renders the shared row primitive from the group structure', () => {
    expect(profileTab).toContain('PROFILE_GROUPS')
    expect(profileTab).toMatch(/<ItemRow/)
    expect(profileTab).toContain("from '../../src/components/ItemRow'")
  })

  it('the section/row/page scaffolding of the old one-scroll profile is gone', () => {
    expect(profileTab).not.toContain('function Section(')
    expect(profileTab).not.toContain('function Row(')
    // The old inline Display/Health/Data/About content MOVED to sub-pages:
    expect(profileTab).not.toContain('Bodyweight unit')
    expect(profileTab).not.toContain('Connect / Reconnect')
    expect(profileTab).not.toContain('Export data')
    expect(profileTab).not.toContain('AGPL-3.0')
    expect(profileTab).not.toContain('registered dietitian')
  })

  it('row values are LIVE reads — the honest-state wiring is in the tab', () => {
    expect(profileTab).toContain('currentGoal')
    expect(profileTab).toContain('weightHistory')
    expect(profileTab).toContain('loadCredential')
    expect(profileTab).toContain('maskCredential')
    expect(profileTab).toContain('formatGoalsValue')
    expect(profileTab).toMatch(/rowValues/)
    expect(profileTab).toContain('SELECT COUNT(*) AS n FROM meals')
  })

  it('the sub-route names live in the shared structure module the tab maps over', () => {
    for (const route of [
      '/edit-goals',
      '/log-weight',
      '/provider-settings',
      '/settings-units-health',
      '/settings-data',
      '/data-methods',
      '/settings-about',
      '/diagnostics',
    ]) {
      expect(profileGroupsSrc).toContain(`'${route}'`)
    }
  })

  it('navigate fires the Table 9.2 selection haptic', () => {
    expect(profileTab).toContain('selectionAsync')
  })

  it('the tab itself does not print model identifiers — those live in diagnostics', () => {
    expect(profileTab).not.toContain('describeActiveModel')
    expect(profileTab).not.toContain('provider_model')
  })
})

describe('Ch 8.8 — sub-pages: everything moved, nothing lost', () => {
  it('Units & Health holds the moved Display + Apple Health sections', () => {
    expect(unitsHealth).toContain('writeWeightUnit')
    expect(unitsHealth).toContain('readWeightUnit')
    expect(unitsHealth).toContain('hapticsEnabled')
    expect(unitsHealth).toContain('setHapticsEnabled')
    expect(unitsHealth).toContain('requestPermissions')
    expect(unitsHealth).toContain('availability')
    // P2-10: the Health group stays native-only — never a dead web control.
    expect(unitsHealth).toContain("Platform.OS !== 'web'")
    expect(unitsHealth).toContain('Open Settings')
    expect(unitsHealth).toContain('Stored weights remain in kilograms.')
  })

  it('Data holds export, import and erase with the destructive confirmDialog pattern', () => {
    expect(dataSettings).toContain('exportAndShareBackup')
    expect(dataSettings).toContain('pickBackupFile')
    expect(dataSettings).toContain('importBackup')
    expect(dataSettings).toContain('resetEverything')
    expect(dataSettings).toContain('confirmDialog')
    expect(dataSettings).toContain('destructive: true')
    // The exact old confirm copy survives: restore replaces everything,
    // erase cannot be undone.
    expect(dataSettings).toContain('Restore this backup?')
    expect(dataSettings).toContain('Erase everything and start over?')
    expect(dataSettings).toContain('This replaces ALL data currently on this device and cannot be undone.')
    expect(dataSettings).toContain('Your API key never travels in a backup')
  })

  it('About folds licenses and the medical disclaimer into disclosures', () => {
    expect(aboutSettings).toContain('Disclosure')
    expect(aboutSettings).toContain('AGPL-3.0')
    expect(aboutSettings).toContain('Open Food Facts')
    expect(aboutSettings).toContain('registered dietitian or healthcare provider')
    expect(aboutSettings).toContain('Medical disclaimer')
  })

  it('Diagnostics is the home for model ids, base URL and prompt versions — read live', () => {
    expect(diagnostics).toContain('describeActiveModel')
    expect(diagnostics).toContain('customProviderBaseUrl')
    expect(diagnostics).toContain('loadCredential')
    expect(diagnostics).toContain('maskCredential')
    expect(diagnostics).toContain('setting(')
    expect(diagnostics).toContain('Active scan model')
    expect(diagnostics).toContain('Active chat model')
    expect(diagnostics).toContain('Base URL')
    expect(diagnostics).toContain('Same as the scan model')
    expect(diagnostics).toContain('PROMPT_VERSION')
    expect(diagnostics).toContain('ASSISTANT_PROMPT_VERSION')
    expect(diagnostics).toContain('LABEL_SCAN_PROMPT_VERSION')
    expect(diagnostics).toContain('WEB_LOOKUP_PROMPT_VERSION')
  })
})

describe('Ch 8.8 — the Disclosure primitive and the provider Advanced fold', () => {
  it('Disclosure collapses by default and reports its expanded state', () => {
    expect(disclosureSrc).toContain('defaultOpen = false')
    expect(disclosureSrc).toContain('accessibilityState={{ expanded: open }}')
    expect(disclosureSrc).toMatch(/rotate: open \? '90deg' : '0deg'/)
  })

  it('provider-settings hides the reseller + custom model fields behind Advanced (collapsed)', () => {
    expect(providerSettings).toContain("from '../src/components/Disclosure'")
    expect(providerSettings).toContain('Advanced — reseller endpoint & custom model IDs')
    // The fields moved INSIDE the disclosure, and the old always-visible
    // card title is gone:
    expect(providerSettings).not.toContain('Custom API endpoint (resellers)')
    expect(providerSettings).toContain('RESELLER_BASE_URL_PLACEHOLDER')
    expect(providerSettings).toContain('Custom chatbot model ID')
    // The catalog pickers + cross-provider fallback stay visible:
    expect(providerSettings).toContain('Chatbot model')
    expect(providerSettings).toContain('cross_provider_fallback')
    // The Wave 1b model-id disclosure stays reachable (Task 17 owns its
    // migration into diagnostics — not stripped here):
    expect(providerSettings).toContain('ModelDiagnosticsDisclosure')
  })
})
