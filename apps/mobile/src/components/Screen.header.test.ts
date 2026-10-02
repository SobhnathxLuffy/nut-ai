import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI/UX report §7.2 (Wave 1c) — the ONE header's contract, source-swept in
 * the plain-Node vitest environment (no React renderer available — the same
 * constraint Toast.test.ts documents). The runtime collapse behaviour is
 * exercised in the headless-browser verification for this wave.
 *
 * The spec: "an iOS-style large title (28pt bold) that collapses to a 17pt
 * inline title on scroll with a hairline border, a left slot for back or
 * close, and a right slot for one or two context actions as icons."
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'Screen.tsx'), 'utf8')

describe('the collapse — large title → inline title + hairline (report §7.2)', () => {
  it('renders the large title at type.title (28/700, the Table 3.1 header voice)', () => {
    expect(source).toContain('type.title')
    expect(source).toContain('largeOpacity')
    expect(source).toContain('largeScale')
  })

  it('collapses to the inline 17pt-class title from the type scale', () => {
    // §7.2 says 17pt; the scale's disciplined twin is bodyStrong (16/600) —
    // ad-hoc fontSize literals are CI-banned, so the inline title MUST be a
    // token reference. The token itself is asserted in type-scale.test.ts.
    expect(source).toMatch(/Animated\.Text[^]*style=\{\[type\.bodyStrong/)
  })

  it('the hairline border appears with the collapse', () => {
    expect(source).toContain('StyleSheet.hairlineWidth')
    expect(source).toContain('borderOpacity')
  })

  it('the collapse is scroll-driven via a single animated scrollY', () => {
    expect(source).toContain('scrollY')
    expect(source).toMatch(/Animated\.event\(\[\{ nativeEvent: \{ contentOffset: \{ y: scrollY \} \} \}\]/)
  })

  it('reduce-motion renders the static inline title — no choreography, always', () => {
    // The gate folds BOTH sources of reduce-motion — the token motionScale
    // and the web prefers-reduced-motion media query — into one boolean.
    const reduce = source.indexOf('motionScale !== 0')
    expect(reduce).toBeGreaterThan(-1)
    // Both interpolations are gated on `animate`: at motionScale 0 the inline
    // title and border sit at static opacity 1 and the large title is not
    // rendered at all (§7.2: "static inline title always").
    expect(source).toContain('animate && largeTitle')
    expect(source).toContain('{largeTitle && animate ?')
  })
})

describe('the slots — back/close left, ≤2 icon actions right (report §7.2)', () => {
  it('the left slot renders a chevron (mirrored) or close icon, never a text button', () => {
    expect(source).toMatch(/backIcon\?: 'chevron' \| 'close'/)
    expect(source).toContain('chevronFlip')
    expect(source).not.toMatch(/\{back && <Button/)
  })

  it('headerActions is capped at two — the cap is part of the spec', () => {
    expect(source).toContain('.slice(0, 2)')
    expect(source).toMatch(/headerActions\?: HeaderAction\[\]/)
  })

  it('every icon-only control carries an accessibility label (report Ch. 6)', () => {
    expect(source).toContain('accessibilityLabel={backLabel}')
    expect(source).toContain('accessibilityLabel={action.label}')
  })
})

describe('backward compatibility — the Wave 1a call sites keep working', () => {
  it('title + back remain the only required props; backLabel defaults as before', () => {
    expect(source).toMatch(/back = false,/)
    expect(source).toMatch(/backLabel = 'Done',/)
    expect(source).toMatch(/title: string/)
  })
})
