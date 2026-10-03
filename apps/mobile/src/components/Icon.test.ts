import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Plain-Node vitest (same constraint as Badge.test.ts / Empty.test.ts):
// react-native-svg and the theme provider are mocked above every import. The
// icon system's exported surface (ICON_SIZES) is exercised from the REAL
// module and the component wiring is source-swept — the component cannot
// render without a DOM, and the app/ screens that consume it sit behind expo
// imports node cannot load (wave3-scan.test.ts's established split).
vi.mock('react-native-svg', () => ({
  default: () => null,
  Circle: () => null,
  Ellipse: () => null,
  G: () => null,
  Path: () => null,
  Rect: () => null,
}))
vi.mock('../theme/ThemeProvider', () => ({
  // Never invoked at import time (the component is not rendered here), but the
  // factory must reference the binding lazily to avoid TDZ at hoist time.
  useTheme: () => lightTheme,
  useMotionScale: () => 1,
}))

import { ICON_SIZES } from './Icon'
import { summaryLinesFor } from '../scan/review'
import { lightTheme } from '../theme/tokens'

/**
 * UI/UX report Ch 6 / Table 6.1 (Wave 4d) — icon set extension: the set grew
 * to 63 glyphs, gained three semantic sizes + an a11y label prop, the report's
 * Lucide passthrough became a documented in-house extension protocol (zero
 * new dependencies), and the report Ch 13 program DoD — "the icon audit finds
 * no text glyph standing in for a symbol anywhere" — closed on the scan
 * honesty card, the one site the audit had left.
 *
 * Wave 4 wrap: the set is 64 — `warning` (Lucide triangle-alert anatomy at
 * 1.8) kills the LAST TWO residual text glyphs: result.tsx's "⚠ Estimated"
 * row marker and search.tsx's "✓ Selected" button label (the check rides the
 * Button's icon slot beside the plain word "Selected").
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'Icon.tsx'), 'utf8')
const review = readFileSync(join(here, '..', 'scan', 'review.ts'), 'utf8')
const result = readFileSync(join(here, '..', '..', 'app', 'result.tsx'), 'utf8')
const search = readFileSync(join(here, '..', '..', 'app', 'search.tsx'), 'utf8')

/** The seven Wave 4d glyphs (report Table 6.1 gap list). */
const WAVE_4D_GLYPHS = ['plusCircle', 'bowlPlus', 'trash', 'share', 'crown', 'uturnBack', 'uturnFwd'] as const

/** The Wave 4 wrap glyph (the ⚠-marker kill). */
const WAVE_4_WRAP_GLYPHS = ['warning'] as const

// Parse the IconName union out of the source (to the first blank line). A
// malformed union fails the length assertions below loudly instead of
// silently testing nothing.
const unionBlock = source.match(/export type IconName =\n([\s\S]*?)\n\n/)
const names = unionBlock ? [...unionBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []

describe('the 64-glyph set (report Table 6.1 gaps closed)', () => {
  it('the union parses and holds 64 unique names (63 from Wave 4d + warning from the wrap)', () => {
    expect(unionBlock).toBeTruthy()
    expect(names).toHaveLength(64)
    expect(new Set(names).size).toBe(64)
  })

  it('every IconName has geometry — a name in the union without a render case is a blank glyph', () => {
    for (const name of names) {
      expect(source).toContain(`case '${name}':`)
    }
  })

  it('every render case is declared in the union — geometry without a name is unreachable', () => {
    const cases = [...source.matchAll(/case '([^']+)':/g)].map((m) => m[1])
    expect(cases).toHaveLength(64)
    for (const c of cases) {
      expect(names).toContain(c)
    }
  })

  it('the seven Wave 4d glyphs exist: plusCircle, bowlPlus, trash, share, crown, uturnBack, uturnFwd', () => {
    for (const name of WAVE_4D_GLYPHS) {
      expect(names).toContain(name)
    }
  })

  it('the Wave 4 wrap glyph exists: warning (the ⚠-Estimated kill)', () => {
    for (const name of WAVE_4_WRAP_GLYPHS) {
      expect(names).toContain(name)
    }
  })
})

describe("one stroke philosophy — Lucide's grid at this set's 1.8", () => {
  it('the shared stroke: 1.8 default weight, round caps + joins, unfilled, colour-inheriting, 24×24 box', () => {
    expect(source).toContain('weight = 1.8')
    expect(source).toContain("strokeLinecap: 'round'")
    expect(source).toContain("strokeLinejoin: 'round'")
    expect(source).toContain("fill: 'none'")
    expect(source).toMatch(/const c = color \?\? theme\.text/)
    expect(source).toContain('viewBox="0 0 24 24"')
  })

  it('the seven new glyphs ride the shared stroke — no private weight, cap, or colour', () => {
    for (const name of WAVE_4D_GLYPHS) {
      const start = source.indexOf(`case '${name}':`)
      expect(start).toBeGreaterThan(-1)
      const next = source.indexOf("case '", start + 1)
      const block = source.slice(start, next === -1 ? undefined : next)
      // Every element spreads the shared stroke props…
      expect(block).toContain('{...s}')
      // …and nothing overrides the weight or hardcodes a stroke colour.
      expect(block).not.toMatch(/strokeWidth[=:]/)
      expect(block).not.toMatch(/stroke="/)
    }
    // Same contract for the wrap glyph — its filled dot uses the inherited
    // `c` (the set's existing dot convention, stroke disabled on the fill),
    // never a hardcoded hex.
    for (const name of WAVE_4_WRAP_GLYPHS) {
      const start = source.indexOf(`case '${name}':`)
      expect(start).toBeGreaterThan(-1)
      const next = source.indexOf("case '", start + 1)
      const block = source.slice(start, next === -1 ? undefined : next)
      expect(block).toContain('{...s}')
      expect(block).not.toMatch(/strokeWidth[=:]/)
      // stroke="none" is the set's fill-only dot idiom (fish/target/sparkles);
      // a stroke COLOUR would be the violation.
      expect(block).not.toMatch(/stroke="#/)
      expect(block).toMatch(/fill=\{c\} stroke="none"/)
    }
  })

  it('the extension protocol is documented in the header — the no-lucide decision + revisit trigger', () => {
    expect(source).toContain('EXTENSION PROTOCOL')
    expect(source).toContain('lucide-react-native')
    expect(source).toContain('REVISIT')
  })
})

describe('a11y label (report Ch 6.2: label when rendered without adjacent text)', () => {
  it('the label prop forwards as accessibilityLabel with the image role on the Svg', () => {
    expect(source).toMatch(/label\?: string/)
    expect(source).toContain('accessibilityLabel={label}')
    expect(source).toContain('accessibilityRole="image"')
  })
})

describe('ICON_SIZES — three semantic sizes (report Ch 6.2)', () => {
  it('default 24, dense 20, inline 16', () => {
    expect(ICON_SIZES).toEqual({ default: 24, dense: 20, inline: 16 })
  })
})

describe('the last text glyphs are dead (report Ch 13 DoD)', () => {
  it('summaryLinesFor returns plain lines — no prefix template can regrow in the helper', () => {
    expect(review).not.toContain('`✓ ${')
    expect(review).not.toContain('`? ${')
    // Functional proof on the real module, not just the source sweep:
    expect(summaryLinesFor({ knownSummary: ' Rice visible ', unknownSummary: 'Ghee amount' })).toEqual({
      known: 'Rice visible',
      unknown: 'Ghee amount',
    })
  })

  it('the honesty card renders the real check/search icons beside the lines (result.tsx)', () => {
    expect(result).toMatch(/<Icon name="check" size=\{12\} color=\{theme\.affirmText\}/)
    expect(result).toMatch(/<Icon name="search" size=\{12\} color=\{theme\.uncertainText\}/)
    // …and no glyph-prefix interpolation can regrow at the render site either.
    expect(result).not.toMatch(/✓ \$\{/)
  })

  it('the ⚠ Estimated row marker is the real warning icon + the plain word (Wave 4 wrap)', () => {
    expect(result).toMatch(/<Icon name="warning" size=\{12\} color=\{theme\.uncertainText\}/)
    // The glyph itself cannot regrow as text — comments included, so the
    // render-contract prose (review.ts) stays honest too.
    expect(result).not.toContain('⚠ Estimated')
  })

  it('the ✓ Selected button label is the Button icon slot + the plain word (Wave 4 wrap)', () => {
    expect(search).not.toContain('✓ Selected')
    expect(search).toMatch(/label=\{isSelected \? 'Selected' : '\+ Select'\}/)
    expect(search).toMatch(/icon=\{isSelected \? 'check' : undefined\}/)
  })
})
