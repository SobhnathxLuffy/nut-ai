import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  darkTheme,
  elevationStyle,
  lightTheme,
  palette,
  radius,
  stateLayer,
  stateLayerFor,
  type,
} from './tokens'

/**
 * UI/UX Transformation Report — Wave 1a type-scale + contrast gate.
 *
 * Three jobs, all CI-enforced (report §13 Wave 1 "done when zero off-scale
 * sizes"; report §11.1 "contrast verification becomes a CI gate so the
 * [VERIFY] comment never has to exist again"):
 *
 *   1. Pin the canonical seven-step scale from Table 3.1 exactly — a token
 *      that drifts silently re-renders every screen, so the values are
 *      assertions, not conventions.
 *   2. COMPUTE the WCAG contrast ratios for the caption/muted pairs from the
 *      theme hexes on every run. The 11px micro textFaint failure (3.40:1 on
 *      white) is what this block exists to make impossible to reintroduce.
 *   3. Sweep the app + shared component sources for ad-hoc fontSize literals
 *      and deprecated token names — the 17 drifting sizes the report audited
 *      (§3.3) must not regrow. Only src/theme/tokens.ts (this scale's home)
 *      and test files are exempt.
 *   4. Wave 4b (report §11.1, dynamic type): the numeral tokens cap at 1.2×
 *      (maxFontSizeMultiplier ON the token, inherited by every spread),
 *      display call sites carry lineHeight headroom (68) for the cap, and
 *      font scaling is never disabled anywhere (sweep) — TextInputs state
 *      allowFontScaling explicitly because Android's default is OFF.
 */

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance + contrast, pure math — no dependencies, so the
// gate runs wherever vitest runs.
const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

const ratio = (fg: string, bg: string) => Math.round(contrast(fg, bg) * 100) / 100

// ---------------------------------------------------------------------------

describe('Table 3.1 canonical type scale (Wave 1)', () => {
  it('display: 56/60 weight 800 with the Wave 4b numeral cap 1.2', () => {
    expect(type.display).toEqual({ fontSize: 56, lineHeight: 60, fontWeight: '800', letterSpacing: -1.5, maxFontSizeMultiplier: 1.2 })
  })

  it('title: 28/32 weight 700', () => {
    expect(type.title).toEqual({ fontSize: 28, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 })
  })

  it('heading: 20/26 weight 600', () => {
    expect(type.heading).toEqual({ fontSize: 20, lineHeight: 26, fontWeight: '600' })
  })

  it('body: 16/24 weight 400, bodyStrong: 16/24 weight 600', () => {
    expect(type.body).toEqual({ fontSize: 16, lineHeight: 24, fontWeight: '400' })
    expect(type.bodyStrong).toEqual({ fontSize: 16, lineHeight: 24, fontWeight: '600' })
  })

  it('label: 14/18 weight 500', () => {
    expect(type.label).toEqual({ fontSize: 14, lineHeight: 18, fontWeight: '500' })
  })

  it('caption floor: 12.5/16 weight 400 — the retired 11px micro tier (report §11)', () => {
    expect(type.caption).toEqual({ fontSize: 12.5, lineHeight: 16, fontWeight: '400' })
  })

  it('monoData: 16/22 weight 600 with tabular numerals and the 1.2 cap (report §4.2, §11.1)', () => {
    expect(type.monoData.fontSize).toBe(16)
    expect(type.monoData.lineHeight).toBe(22)
    expect(type.monoData.fontWeight).toBe('600')
    expect(type.monoData.fontVariant).toEqual(['tabular-nums'])
    // Wave 4b: the numeral cap rides the token so every spread site inherits it.
    expect(type.monoData.maxFontSizeMultiplier).toBe(1.2)
  })

  it('deprecated aliases point at the canonical objects, not copies', () => {
    // hero → display, micro → caption. Aliases exist only for stragglers
    // outside the swept directories; the sweep test below bans them in-app.
    expect(type.hero).toBe(type.display)
    expect(type.micro).toBe(type.caption)
  })
})

describe('caption/muted contrast is AA-computed, not eyeballed (report §11, Table 11.1)', () => {
  it('the retired pairing fails — proof this gate can catch the original bug', () => {
    // 11px micro on ink400 textFaint over white was "roughly 3.5:1" in the
    // report; the exact number is 3.40:1.
    expect(ratio('#8A8A99', '#FFFFFF')).toBeLessThan(4.5)
  })

  it('light theme: faint and muted text pass 4.5:1 on the light background', () => {
    expect(contrast(lightTheme.textFaint, lightTheme.bg)).toBeGreaterThanOrEqual(4.5) // ink450 on white = 5.01:1
    expect(contrast(lightTheme.textMuted, lightTheme.bg)).toBeGreaterThanOrEqual(4.5) // ink500 on white = 6.57:1
  })

  it('dark theme: faint and muted text pass 4.5:1 on BOTH dark surfaces', () => {
    // Captions live on plain bg and inside elevated cards — check both.
    expect(contrast(darkTheme.textFaint, darkTheme.bg)).toBeGreaterThanOrEqual(4.5) // 5.78:1 on ink900
    expect(contrast(darkTheme.textFaint, darkTheme.bgElevated)).toBeGreaterThanOrEqual(4.5) // 5.30:1 on ink800
    expect(contrast(darkTheme.textMuted, darkTheme.bgElevated)).toBeGreaterThanOrEqual(4.5) // 9.17:1 on ink800
  })

  it('the 12.5px caption is normal-size text, so 4.5:1 (not 3:1) is the bar', () => {
    // Large-text relief (3:1) starts at 18pt ≈ 24px, or 14pt bold ≈ 18.66px.
    // The caption floor sits well below both — the pairs above must clear AA
    // for normal text, which is exactly what they are asserted against.
    expect(type.caption.fontSize).toBeLessThan(18.66)
  })
})

describe('Wave 1a token additions (report §4.3)', () => {
  it('radius gains the 20pt sheet radius between lg and xl', () => {
    expect(radius.sheet).toBe(20)
    expect(radius.lg).toBeLessThan(radius.sheet)
    expect(radius.sheet).toBeLessThan(radius.xl)
  })

  it('elevation has exactly three levels, each strictly deeper than the last', () => {
    expect(elevationStyle('subtle', false).shadowRadius).toBe(3)
    expect(elevationStyle('medium', false).shadowRadius).toBe(12)
    expect(elevationStyle('high', false).shadowRadius).toBe(28)
  })

  it('dark mode substitutes border lightening for shadows (§4.3 strategy)', () => {
    // Shadows are invisible on near-black; dark mode gets a lighter border
    // per level instead, so depth keeps a single code path.
    expect(elevationStyle('subtle', true)).toEqual({ borderWidth: 1, borderColor: '#22222B' })
    expect(elevationStyle('medium', true)).toEqual({ borderWidth: 1, borderColor: '#3A3A46' })
    expect(elevationStyle('high', true)).toEqual({ borderWidth: 1.5, borderColor: '#5C5C6B' })
  })

  it('state layers: pressed 6% ink, disabled 38% + no shadow, selected 12% tint, focus 2px ring', () => {
    expect(stateLayer.pressed.backgroundColor).toBe('#0B0B0F0F') // 0x0F ≈ 5.9% ink
    expect(stateLayer.disabled).toEqual({ opacity: 0.38, shadowOpacity: 0, elevation: 0 })
    expect(stateLayer.selected.backgroundColor).toBe('#0B0B0F1F') // 0x1F ≈ 12.2% tint
    expect(stateLayer.focus).toEqual({ borderWidth: 2, borderColor: '#0B0B0F' })
    // Dark mirror flips the ink overlay to white ink.
    expect(stateLayerFor(true).pressed.backgroundColor).toBe('#FFFFFF0F')
    expect(stateLayerFor(false)).toBe(stateLayer)
  })
})

describe('Wave 4 text-grade tokens (report Table 11.1 "compute all pairs")', () => {
  // The full pair matrix — including these assertions — is gated by
  // scripts/check-contrast.mjs (npm run check:contrast, chained into npm run
  // check). This block pins the SAME contract from the vitest side so a
  // regression is caught twice: once per pair in CI, once per token here.

  it('the retired identity-as-text pairings fail — proof this gate can catch the original bug', () => {
    // Pre-Wave-4 values, computed exactly: the report's Table 11.1 findings.
    expect(ratio(palette.protein, '#FFFFFF')).toBeLessThan(4.5) // 3.88:1
    expect(ratio(palette.carbs, '#FFFFFF')).toBeLessThan(3) // 2.00:1 — failed even the graphical bar
    expect(ratio(palette.uncertain, '#FFFFFF')).toBeLessThan(4.5) // 3.55:1
    expect(ratio('#D5453B', '#FFFFFF')).toBeLessThan(4.5) // old safety: 4.43:1
    expect(ratio(palette.affirm, '#FFFFFF')).toBeLessThan(4.5) // 3.38:1
  })

  it('light theme: every *Text slot passes 4.5:1 on bg and bgElevated', () => {
    for (const slot of ['proteinText', 'carbsText', 'fatText', 'uncertainText', 'affirmText'] as const) {
      expect(contrast(lightTheme[slot], lightTheme.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(lightTheme[slot], lightTheme.bgElevated)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('dark theme: the *Text slots (same hexes as the dark identity colors) pass 4.5:1 on both surfaces', () => {
    for (const slot of ['proteinText', 'carbsText', 'fatText', 'uncertainText', 'affirmText'] as const) {
      expect(contrast(darkTheme[slot], darkTheme.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(darkTheme[slot], darkTheme.bgElevated)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('light safety #C13A30 passes 4.5:1 as text on bg, bgElevated and its own wash', () => {
    expect(lightTheme.safety).toBe('#C13A30') // palette.safety, the computed replacement
    expect(contrast(lightTheme.safety, lightTheme.bg)).toBeGreaterThanOrEqual(4.5) // 5.36:1
    expect(contrast(lightTheme.safety, lightTheme.bgElevated)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(lightTheme.safety, lightTheme.safetyBg)).toBeGreaterThanOrEqual(4.5) // 4.73:1
  })

  it('light carbs is recomputed to clear the 3:1 graphical bar (ring strokes, chart series)', () => {
    // palette.carbs stays the artwork/brand hex; the THEME slot is the grade.
    expect(palette.carbs).toBe('#F2A93B')
    expect(lightTheme.carbs).toBe('#C68607')
    expect(contrast(lightTheme.carbs, lightTheme.bg)).toBeGreaterThanOrEqual(3) // 3.08:1
    expect(lightTheme.carbsTint).toBe('#C686071A')
  })

  it('identity colors clear the 3:1 graphical bar in BOTH themes (icons, strokes, chart series)', () => {
    for (const slot of ['protein', 'carbs', 'fat', 'uncertain', 'heart'] as const) {
      expect(contrast(lightTheme[slot], lightTheme.bg)).toBeGreaterThanOrEqual(3)
      expect(contrast(lightTheme[slot], lightTheme.bgElevated)).toBeGreaterThanOrEqual(3)
      expect(contrast(darkTheme[slot], darkTheme.bg)).toBeGreaterThanOrEqual(3)
      expect(contrast(darkTheme[slot], darkTheme.bgElevated)).toBeGreaterThanOrEqual(3)
    }
  })

  it('the accent slot is the ink dialect the selected surfaces hardcoded — zero visual change', () => {
    // report §3.2: the semantic set gains the accent slot. Same hexes the
    // Button selected fill / tab pill tint resolved to before, now named and
    // contrast-gated (light: ink900 19.64:1 on bg; dark: ink50 18.37:1 on bg).
    expect(lightTheme.accent).toBe(lightTheme.text) // palette.ink900
    expect(lightTheme.accent).toBe('#0B0B0F')
    expect(darkTheme.accent).toBe(darkTheme.text) // palette.ink50
    expect(darkTheme.accent).toBe('#F7F7FA')
    expect(lightTheme.accentTint).toBe(stateLayer.selected.backgroundColor) // #0B0B0F1F
    expect(darkTheme.accentTint).toBe('#F7F7FA1F')
  })
})

// ---------------------------------------------------------------------------
// Source-walk helper, shared by the typography sweeps: every non-test
// .ts/.tsx file under the given trees of apps/mobile. A swept directory that
// does not exist is not a violation (same contract as the Wave 1a sweep).

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

function listSourceFiles(dirs: readonly string[]): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return // a swept dir that does not exist is not a violation
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        isDir = false
      }
      if (isDir) {
        walk(full)
        continue
      }
      if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) files.push(full)
    }
  }
  for (const dir of dirs) walk(join(APP_ROOT, dir))
  return files
}

describe('typography discipline sweep — zero ad-hoc sizes (report §3.3, §13 Wave 1)', () => {
  // The report audited 17 distinct off-scale fontSize values plus four
  // competing header scales. This block is what keeps them dead: any numeric
  // fontSize literal (React Native points or DOM px) in the swept trees fails
  // CI with file:line. tokens.ts itself is the only sanctioned home, and test
  // files are exempt (this file's own regexes would otherwise self-match).
  const SWEEP_DIRS = ['app', 'src/components', 'src/ui', 'src/onboarding']
  const RN_LITERAL = /fontSize:\s*\d+(?:\.\d+)?/
  const WEB_LITERAL = /fontSize:\s*'\d+(?:\.\d+)?px'/
  const DEPRECATED = /\btype\.(micro|hero)\b/

  const hits: string[] = []
  for (const full of listSourceFiles(SWEEP_DIRS)) {
    const source = readFileSync(full, 'utf8')
    source.split('\n').forEach((line, i) => {
      const checks: Array<[RegExp, string]> = [
        [RN_LITERAL, 'ad-hoc fontSize literal'],
        [WEB_LITERAL, 'ad-hoc fontSize px literal'],
        [DEPRECATED, 'deprecated token name (use type.caption / type.display)'],
      ]
      for (const [pattern, why] of checks) {
        if (pattern.test(line)) {
          hits.push(`${full.slice(APP_ROOT.length + 1)}:${i + 1}: ${why}: ${line.trim()}`)
        }
      }
    })
  }

  it('no off-scale fontSize literals and no deprecated token names in the swept trees', () => {
    expect(
      hits,
      `off-scale typography found (UI/UX report §3.3 / Table 3.1):\n${hits.join('\n')}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Wave 4b — dynamic type (report §11.1: "allowFontScaling is enabled with the
// new type scale mapped to accessibility tiers").
//
// Repo-wide policy, mirrored by the comments on the tokens themselves:
//   - prose/label tiers grow with the OS font scale (RN default — never
//     disabled; the sweep below bans turning it off);
//   - NUMERALS (monoData, display) cap at 1.2× via maxFontSizeMultiplier ON
//     the token, so every spread site inherits the cap;
//   - the display hero additionally needs lineHeight headroom at its call
//     sites because 56×1.2 = 67.2 outgrows the token's lineHeight 60;
//   - every TextInput states allowFontScaling explicitly — Android's
//     TextInput default is OFF, which is the gap the report flagged.
//
// The 130% device audit is deliberately NOT claimed here: it is the owner's
// physical pass (NOT TESTED (device) until actually run on hardware).

/** The sanctioned display call-site lineHeight override (Wave 4b): ≥ 56×1.2. */
const DISPLAY_HEADROOM = 68

describe('Wave 4b numeral caps (report §11.1 — numbers grow, but stop at 1.2×)', () => {
  it('monoData caps at 1.2 and cannot clip at the cap: 16×1.2 = 19.2 ≤ lineHeight 22', () => {
    expect(type.monoData.maxFontSizeMultiplier).toBe(1.2)
    expect(type.monoData.fontSize * type.monoData.maxFontSizeMultiplier).toBeLessThanOrEqual(
      type.monoData.lineHeight,
    )
  })

  it('display caps at 1.2 — and 56×1.2 = 67.2 exceeds the token lineHeight 60, so call sites add 68', () => {
    expect(type.display.maxFontSizeMultiplier).toBe(1.2)
    // This inequality is exactly WHY the headroom override exists: at the cap
    // the scaled glyph box outgrows the token's own leading. The 68 override
    // (≥ 67.2, 0.8px slack, +8px the flex layouts absorb) fixes it per call
    // site — the token's 60 stays pinned for the unscaled 1.0 rendering.
    expect(type.display.fontSize * type.display.maxFontSizeMultiplier).toBeGreaterThan(
      type.display.lineHeight,
    )
    expect(DISPLAY_HEADROOM).toBeGreaterThanOrEqual(
      type.display.fontSize * type.display.maxFontSizeMultiplier,
    )
  })
})

describe('font scaling is never disabled (report §11.1 sweep)', () => {
  // RN Text scales with the OS font setting by default, and the only
  // sanctioned way to bound growth is the numeral tokens' 1.2 cap above.
  // Turning scaling OFF outright is what this report section exists to
  // prevent: a screen that ignores the user's chosen font size. Test files
  // are exempt (this file's own regexes would otherwise self-match).
  //
  // ALLOWLIST: EMPTY — expected to stay empty. If a site ever genuinely needs
  // scaling off, add `file:line — reason` here and a worklog note; the gate
  // exists so that decision is deliberate, not accidental.
  const BANNED = /allowFontScaling\s*[=:]\s*\{?\s*false\s*\}?/
  const hits: string[] = []
  for (const full of listSourceFiles(['app', 'src'])) {
    const source = readFileSync(full, 'utf8')
    source.split('\n').forEach((line, i) => {
      if (BANNED.test(line)) {
        hits.push(`${full.slice(APP_ROOT.length + 1)}:${i + 1}: ${line.trim()}`)
      }
    })
  }

  it('no disabled allowFontScaling anywhere in app/ or src/ (test files exempt)', () => {
    expect(hits, `font scaling disabled at:\n${hits.join('\n')}`).toEqual([])
  })
})

describe('Wave 4b source inspection — the scaling props actually landed', () => {
  const read = (rel: string) => readFileSync(join(APP_ROOT, rel), 'utf8')

  it('workout set-table TextInput cells: allowFontScaling + the 1.2 cap, together', () => {
    // workout.tsx has exactly one TextInput — the set-cell field map. The two
    // props sit together on it: Android's scaling-off default is the gap the
    // report's §11.1 pass flagged for exactly this table (the numeral cap
    // also arrives via the monoData token spread in the style array).
    expect(read('app/workout.tsx')).toMatch(/allowFontScaling\s*\n\s*maxFontSizeMultiplier=\{1\.2\}/)
  })

  it('the Field primitive and the onboarding EditableValue input state allowFontScaling explicitly', () => {
    // Field is the ONE labelled input primitive (NewIngredientForm and every
    // compact form ride it); EditableValue is the onboarding value input.
    // Both are minHeight inputs — user content grows, no cap.
    expect(read('src/components/Field.tsx')).toMatch(/<TextInput[\s\S]{0,600}?allowFontScaling/)
    expect(read('src/components/onboarding/Controls.tsx')).toMatch(
      /<TextInput[\s\S]{0,600}?allowFontScaling/,
    )
  })

  it('the Screen.Field labelled input states allowFontScaling explicitly (Wave 4 wrap residual)', () => {
    // Screen.Field is the labelled-input half of the Field pair; the compact
    // Field primitive and the onboarding EditableValue input already carried
    // the prop — this closes the set the report's §11.1 pass named.
    expect(read('src/components/Screen.tsx')).toMatch(
      /<TextInput[\s\S]{0,800}?allowFontScaling/,
    )
  })

  it('log-exercise set-cell TextInputs mirror workout.tsx: allowFontScaling + the 1.2 cap, together', () => {
    // The log-exercise mini set table shares the workout screen's numeral
    // cells — the same Android scaling gap and the same cap apply (Wave 4
    // wrap residual; the cap also arrives via the monoData token spread).
    expect(read('app/log-exercise.tsx')).toMatch(/allowFontScaling\s*\n\s*maxFontSizeMultiplier=\{1\.2\}/)
  })

  it('every display call site carries the 68 headroom (56×1.2 = 67.2 > 60)', () => {
    // The regexes pin the same value as DISPLAY_HEADROOM. Wave 4 wrap: the
    // three residual sites the Wave 4b agent flagged out-of-scope (Chrome's
    // onboarding title, result's two hero-kcal spreads) now carry the
    // override too — the list below is EVERY type.display spread in the
    // repo, so a new site without headroom is a new deviation to record,
    // not a silent clip.
    const sites: Array<[string, RegExp]> = [
      ['app/(tabs)/index.tsx', /hero:\s*\{[\s\S]{0,500}?\.\.\.type\.display,[\s\S]{0,300}?lineHeight:\s*68/],
      ['app/onboarding/plan.tsx', /goal:\s*\{[\s\S]{0,500}?\.\.\.type\.display,[\s\S]{0,300}?lineHeight:\s*68/],
      // bigNum is monoData raised to the display size — same cap math, same 68.
      ['app/onboarding/plan.tsx', /bigNum:\s*\{[^}]*lineHeight:\s*68/],
      ['src/components/onboarding/Controls.tsx', /readoutValue:\s*\{[^}]*\.\.\.type\.display,\s*lineHeight:\s*68/],
      ['src/components/onboarding/Controls.tsx', /readoutUnit:\s*\{[^}]*\.\.\.type\.display,\s*lineHeight:\s*68/],
      ['src/components/onboarding/Controls.tsx', /editInput:\s*\{[\s\S]{0,300}?\.\.\.type\.display,\s*lineHeight:\s*68/],
      ['src/components/onboarding/Chrome.tsx', /title:\s*\{[\s\S]{0,500}?\.\.\.type\.display,[\s\S]{0,300}?lineHeight:\s*68/],
    ]
    // Owner QA 2026-10 note: app/onboarding/index.tsx (welcome hero) and
    // app/onboarding/{health,rollover}.tsx carried display spreads that went
    // with their screens in the single-page collapse; Chrome's onboarding
    // title (used by the single page) and plan.tsx keep the headroom pinned.
    for (const [rel, pattern] of sites) {
      expect(read(rel), `display call site without headroom: ${rel}`).toMatch(pattern)
    }
    // result.tsx renders the hero kcal through an inline style array (both
    // the quick and the advanced view) — exactly TWO spreads, both pinned.
    const heroSites = read('app/result.tsx').match(
      /\[type\.display, \{ color: theme\.text, lineHeight: 68 \}\]/g,
    )
    expect(heroSites, 'result.tsx hero-kcal display spreads without headroom').toHaveLength(2)
  })
})
