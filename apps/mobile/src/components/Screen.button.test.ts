import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI/UX report Table 5.1 / Table 12.2 (Wave 2) — the ONE Button and the ONE
 * Field contracts, source-swept in the plain-Node vitest environment (no
 * React renderer — the same constraint Screen.header.test.ts documents).
 *
 * Button: "Rebuild one Button, 48/56pt, icon slot"; press feedback and the
 * pressed/disabled state layers arrive via PressableFX (Table 9.1 / §4.3).
 * Field: "One Field, error + hint slots" with the web focus ring.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'Screen.tsx'), 'utf8')
const read = (rel: string) => readFileSync(join(here, rel), 'utf8')

describe('Button — two sizes (Table 12.2 "One Button, two sizes")', () => {
  it('md is 48pt with the compact radius; lg is 56pt with the pill radius', () => {
    expect(source).toMatch(/minHeight: isLg \? 56 : 48/)
    expect(source).toMatch(/borderRadius: isLg \? radius\.pill : radius\.md \+ 2/)
    expect(source).toMatch(/size\?: ButtonSize/)
  })

  it('the icon slot renders one glyph left of the label (Table 5.1)', () => {
    expect(source).toMatch(/icon\?: IconName/)
    expect(source).toMatch(/\{icon \? <Icon name=\{icon\} size=\{isLg \? 22 : 18\} color=\{contentColor\} \/> : null\}/)
    expect(source).toMatch(/<Text style=\{\[type\.bodyStrong, \{ color: contentColor \}\]\}>\{label\}<\/Text>/)
  })

  it('press feedback + state layers ride PressableFX — no private pressed dialect', () => {
    expect(source).toContain("import { PressableFX } from './PressableFX'")
    expect(source).toMatch(/<PressableFX\s+accessibilityRole="button"/)
    // No hand-rolled opacity here any more — the §4.3 tokens own it.
    expect(source).not.toMatch(/opacity: disabled \? 0\.5 : 1/)
  })

  it('the Wave 1a API is unchanged — label/onPress/disabled/selected keep compiling', () => {
    expect(source).toMatch(/label: string/)
    expect(source).toMatch(/onPress: \(\) => void/)
    expect(source).toMatch(/disabled\?: boolean/)
    expect(source).toMatch(/selected\?: boolean/)
    // `selected` still means the ink-filled primary surface. Wave 4 (report
    // §3.2): the fill re-pointed to the accent slot — the same ink dialect
    // t.text resolved to, now a named, contrast-gated token. Zero visual change.
    expect(source).toMatch(/backgroundColor: selected \? t\.accent : t\.bgSunken/)
    expect(source).toMatch(/contentColor = selected \? t\.bg : t\.text/)
  })

  it('accessibility state is complete for every size (role, label, disabled, selected)', () => {
    expect(source).toMatch(/accessibilityState=\{\{ disabled, selected \}\}/)
    expect(source).toMatch(/accessibilityLabel=\{label\}/)
  })
})

describe('Field — error + hint slots + web focus ring (Table 5.1)', () => {
  it('the error slot: safety colour, caption size, alert role — and the safety border', () => {
    expect(source).toMatch(/error\?: string \| null/)
    expect(source).toMatch(/borderColor: error \? t\.safety : t\.border/)
    expect(source).toMatch(/<Text accessibilityRole="alert" style=\{\[type\.caption, \{ color: t\.safety \}\]\}>/)
  })

  it('the hint slot: muted caption under the input', () => {
    expect(source).toMatch(/hint\?: string \| null/)
    expect(source).toMatch(/\{hint \? <Text style=\{\[type\.caption, \{ color: t\.textMuted \}\]\}>\{hint\}<\/Text> : null\}/)
  })

  it('focus ring is the §4.3 stateLayer.focus token, web only', () => {
    expect(source).toContain('stateLayerFor(t.isDark)')
    expect(source).toMatch(/focused && Platform\.OS === 'web' \? layers\.focus : null/)
  })

  it('caller focus handlers still fire (the slot wraps, never swallows)', () => {
    expect(source).toContain('onFocus?.(event)')
    expect(source).toContain('onBlur?.(event)')
  })
})

describe('the migrated pill CTAs (Table 12.2 census)', () => {
  it('result.tsx: the Log-it CTA (barcode/label/receipt paths) is Button size="lg" with the check glyph', () => {
    // T-IMPL-A: the photo path logs optimistically at the shutter and never
    // reaches /result, so the second (quick-view) Log-it CTA is gone by design.
    const result = read('../../app/result.tsx')
    expect(result.match(/<Button\s+label=\{logging \? 'Logging…' : 'Log it'\}/g)?.length).toBe(1)
    expect(result).toMatch(/icon="check"\s+size="lg"/)
  })

  it('food-review.tsx: the 54pt Save-to-diary pill is Button size="lg"', () => {
    const review = read('../../app/food-review.tsx')
    expect(review).toMatch(/label=\{busy \? 'Saving…' : 'Save to diary'\}/)
    expect(review).toMatch(/size="lg"/)
  })

  it('assistant.tsx: the send button is the shared Button (no private bold weight)', () => {
    const assistant = read('../../app/assistant.tsx')
    expect(assistant).toMatch(/<Button label="Send" selected onPress=\{\(\) => void send\(\)\} \/>/)
  })

  it('CredentialForm.tsx: all three inputs ride the ONE Field, verify rides Button lg', () => {
    const credential = read('./CredentialForm.tsx')
    expect(credential.match(/<Field\s/g)?.length).toBe(3)
    expect(credential).toMatch(/label="Reseller base URL"/)
    expect(credential).toMatch(/label="API credential"/)
    expect(credential).toMatch(/<Button[\s\S]*?label=\{busy \? 'Checking…' : 'Verify and save'\}/)
    // The private TextInput dialect is gone.
    expect(credential).not.toMatch(/<TextInput/)
  })
})

describe('app-wide press feedback reaches the highest-traffic rows (Table 9.1)', () => {
  it('DayTimeline meal rows render through PressableFX', () => {
    const timeline = read('./DayTimeline.tsx')
    expect(timeline).toContain("import { PressableFX } from './PressableFX'")
    expect(timeline).toMatch(/<PressableFX onPress=\{onPress\} onLongPress=\{onLongPress\} accessibilityRole="button">/)
  })

  it('food-search result rows keep their testID while gaining the press feedback', () => {
    const search = read('../../app/food-search.tsx')
    expect(search).toContain("from '../src/components/PressableFX'")
    expect(search).toMatch(/testID=\{`food-search-row-\$\{r\.foodId\}`\}/)
  })
})
