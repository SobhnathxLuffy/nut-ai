import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  darkTheme,
  elevationStyle,
  lightTheme,
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
  it('display: 56/60 weight 800', () => {
    expect(type.display).toEqual({ fontSize: 56, lineHeight: 60, fontWeight: '800', letterSpacing: -1.5 })
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

  it('monoData: 16/22 weight 600 with tabular numerals (report §4.2)', () => {
    expect(type.monoData.fontSize).toBe(16)
    expect(type.monoData.lineHeight).toBe(22)
    expect(type.monoData.fontWeight).toBe('600')
    expect(type.monoData.fontVariant).toEqual(['tabular-nums'])
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

describe('typography discipline sweep — zero ad-hoc sizes (report §3.3, §13 Wave 1)', () => {
  // The report audited 17 distinct off-scale fontSize values plus four
  // competing header scales. This block is what keeps them dead: any numeric
  // fontSize literal (React Native points or DOM px) in the swept trees fails
  // CI with file:line. tokens.ts itself is the only sanctioned home, and test
  // files are exempt (this file's own regexes would otherwise self-match).
  const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const SWEEP_DIRS = ['app', 'src/components', 'src/ui', 'src/onboarding']
  const RN_LITERAL = /fontSize:\s*\d+(?:\.\d+)?/
  const WEB_LITERAL = /fontSize:\s*'\d+(?:\.\d+)?px'/
  const DEPRECATED = /\btype\.(micro|hero)\b/

  const hits: string[] = []
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
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\./.test(entry)) continue
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
  }

  for (const dir of SWEEP_DIRS) walk(join(APP_ROOT, dir))

  it('no off-scale fontSize literals and no deprecated token names in the swept trees', () => {
    expect(
      hits,
      `off-scale typography found (UI/UX report §3.3 / Table 3.1):\n${hits.join('\n')}`,
    ).toEqual([])
  })
})
