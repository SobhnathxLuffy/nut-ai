import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI/UX report Ch. 7 / Table 7.1 + Table 9.1 / Table 9.2 (Wave 2) — the
 * navigation layer contract for app/(tabs)/_layout.tsx, source-swept in the
 * plain-Node vitest environment (the tab bar and sheet are runtime-verified
 * in the headless browser pass for this wave):
 *
 *   - FAB on ALL five tabs opening a true bottom sheet (spring translateY,
 *     sheet radius 20, tap-outside + swipe-down, reduce-motion fade);
 *   - scan promoted as the primary row; six DISTINCT action glyphs; routes
 *     EXACTLY where the old fullscreen grid routed;
 *   - no haptic on sheet open/close (Table 9.2 "Sheet open/close → None");
 *   - 12pt-class caption labels, accent pill morphing 240ms between tabs,
 *     selection haptic on tab CHANGE only.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../../app/(tabs)/_layout.tsx'), 'utf8')

describe('the FAB — global on all five tabs (Table 7.1)', () => {
  it('no food-tab gate: the FAB renders unconditionally next to the pill bar', () => {
    expect(source).not.toContain("name === 'food'")
    expect(source).toMatch(/accessibilityLabel="Add"/)
  })
})

describe('the bottom sheet — a true sheet, not the fullscreen grid', () => {
  it('rises on a spring with the translateY transform (Table 9.1 "FAB sheet")', () => {
    expect(source).toMatch(/Animated\.spring\(sheetY,/)
    expect(source).toMatch(/transform: \[\{ translateY: sheetY \}\]/)
  })

  it('carries the radius.sheet token (20pt) on its top corners', () => {
    expect(source).toMatch(/borderTopLeftRadius: radius\.sheet/)
    expect(source).toMatch(/borderTopRightRadius: radius\.sheet/)
  })

  it('dismisses by tap-outside, swipe-down AND hardware back', () => {
    expect(source).toMatch(/accessibilityLabel="Close action sheet"/)
    expect(source).toMatch(/onMoveShouldSetPanResponder[\s\S]*?gesture\.dy > 10/)
    expect(source).toMatch(/onPanResponderRelease[\s\S]*?onClose\(\)/)
    expect(source).toMatch(/onRequestClose=\{onClose\}/)
  })

  it('swipe follows the finger, and a short release springs back', () => {
    expect(source).toMatch(/sheetY\.setValue\(Math\.max\(0, gesture\.dy\)\)/)
    expect(source).toMatch(/onPanResponderRelease[\s\S]*?Animated\.spring\(sheetY, \{ toValue: 0/)
  })

  it('a drag never click-throughs to the row it started on (web PanResponder onClickCapture gap)', () => {
    // PHYSICALLY VERIFIED gap: react-native-web's View drops onClickCapture
    // (forwardedProps has onClick, not the capture twin), so a mouse drag
    // released over a row fires that row's press. The sheet guards it.
    expect(source).toMatch(/const suppressRowPress = useRef\(false\)/)
    expect(source).toMatch(/if \(Math\.abs\(gesture\.dy\) > SHEET_DRAG_SLOP\) suppressRowPress\.current = true/)
    // The row press goes through the guarded runAction, not raw onAction.
    expect(source).toMatch(/onPress=\{\(\) => runAction\(action\.route\)\}/)
    // The flag clears a macrotask behind the release — after the synthesised
    // click, before any real follow-up tap.
    expect(source).toMatch(/clearDragSuppress = \(\) => \{\s*setTimeout\(\(\) => \{\s*suppressRowPress\.current = false/)
  })

  it('reduce motion: fade, never travel', () => {
    expect(source).toMatch(/opacity: reduced \? backdrop : 1/)
  })

  it('sheet open/close fires NO haptic (Table 9.2 — motion carries it)', () => {
    const sheet = source.slice(source.indexOf('function FabSheet'))
    expect(sheet).not.toContain('selectionAsync')
    expect(sheet).not.toContain('haptic')
  })
})

describe('the six actions — distinct glyphs, scan promoted, routes preserved', () => {
  it('scan is the hero row (Table 7.1) and renders the 26pt hero glyph (Table 6.1)', () => {
    expect(source).toMatch(/route: '\/camera', hero: true/)
    expect(source).toMatch(/<Icon name=\{action\.icon\} size=\{26\} color=\{theme\.bg\} \/>/)
  })

  it('all six glyphs are DISTINCT (P3-U14 invariant)', () => {
    const icons = [...source.matchAll(/^\s*\{ label: '[^']+', icon: '(\w+)', route: '[^']+'(?:, hero: true)?,?/gm)].map(
      (m) => m[1],
    )
    expect(icons).toHaveLength(6)
    expect(new Set(icons).size).toBe(6)
  })

  it('routes are exactly the old action grid destinations', () => {
    for (const route of ['/log-exercise', '/saved-foods', '/recipes', '/food-search', '/camera', '/assistant']) {
      expect(source).toContain(`route: '${route}'`)
    }
  })
})

describe('the tab bar craft (Table 7.1 / Table 9.1 / Table 9.2)', () => {
  it('labels stay on the 12.5px caption floor (the AA-fixed 12pt minimum)', () => {
    expect(source).toMatch(/\[type\.caption, \{ color: focused \? theme\.text : theme\.textFaint/)
  })

  it('the active pill morphs over 240ms — one Animated value interpolating the tab frames', () => {
    expect(source).toMatch(/duration: motion\.base/)
    expect(source).toMatch(/pillIndex\.interpolate\(\{ inputRange: input, outputRange: frames\.map\(\(f\) => f!\.x\) \}\)/)
    expect(source).toMatch(/frames\.map\(\(f\) => f!\.width\)/)
  })

  it('the pill fill is the §4.3 selected accent tint, not a flat background swap', () => {
    // Wave 4 (report §3.2): the pill fill re-pointed from the stateLayer
    // selected wash to the named accent tint slot — same 12% ink/white hexes,
    // zero visual change, now contrast-gated via scripts/check-contrast.mjs.
    expect(source).toMatch(/backgroundColor: theme\.accentTint/)
  })

  it('reduce motion snaps the pill instantly', () => {
    expect(source).toMatch(/if \(reduced\) \{\s*pillIndex\.setValue\(state\)/)
  })

  it('the selection haptic lands on a tab CHANGE, never a re-tap (Table 9.2)', () => {
    expect(source).toMatch(/if \(!focused\) void selectionAsync\(\)/)
  })
})
