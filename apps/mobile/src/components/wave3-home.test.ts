import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI/UX report §8.2 (Wave 3) — "Home: an instrument, not a dashboard".
 *
 * The Home screen sits behind expo imports vitest's node environment cannot
 * load, so its wiring is pinned by SOURCE SWEEP — the established pattern for
 * app/ screens (model-hint.test.ts, wave2-nav.test.ts, wave3-screens.test.ts).
 * The pure derivations it consumes are UNIT-tested in
 * src/data/home-instrument.test.ts; the SQL reads in home-reads.test.ts. The
 * runtime behaviour (count-up, spring expansion, pulse, zero console errors)
 * is verified in the headless browser pass for this wave.
 */

const here = dirname(fileURLToPath(import.meta.url))
const home = readFileSync(join(here, '..', '..', 'app', '(tabs)', 'index.tsx'), 'utf8')
const derivations = readFileSync(join(here, '..', 'data', 'home-instrument.ts'), 'utf8')

describe('§8.2 item 1 — the hero ring counts up on focus and presses open per-slot detail', () => {
  it('the count-up replays on focus: the focus tick remounts the ring and its CountUps', () => {
    expect(home).toContain('setFocusTick((tick) => tick + 1)')
    expect(home).toMatch(/key=\{`hero-\$\{focusTick\}`\}/)
    expect(home).toMatch(/key=\{`ring-\$\{focusTick\}`\}/)
    expect(home).toMatch(/key=\{`eaten-\$\{focusTick\}`\}/)
  })

  it('pressing the hero card springs the measured height of the slot breakdown open', () => {
    expect(home).toMatch(/Animated\.spring\(detailH,/)
    expect(home).toMatch(/useNativeDriver: false/)
    expect(home).toContain('onLayout={(e) => {')
    expect(home).toContain('const h = e.nativeEvent.layout.height')
  })

  it('the expansion respects motionScale (reduce motion collapses to the instant state)', () => {
    expect(home).toMatch(/if \(motionScale === 0 \|\| contentH === 0\)/)
    expect(home).toContain('detailH.setValue(')
  })

  it('the toggle is an accessible disclosure: role, label, expanded state, hidden rows when collapsed', () => {
    // aria-expanded is the prop RNW actually renders to the DOM for the
    // disclosure state (runtime-verified this wave); accessibilityState's
    // expanded key never reached the DOM in react-native-web 0.21.
    expect(home).toMatch(/accessibilityRole="button"/)
    expect(home).toMatch(/accessibilityLabel=\{\s*expanded \? 'Hide remaining calories by meal' : 'Show remaining calories by meal'/)
    expect(home).toContain('aria-expanded={expanded}')
    expect(home).toContain('accessibilityElementsHidden={!expanded}')
    expect(home).toContain("importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}")
  })

  it('the overflow arc stays honest and the derivation comes from slotGuide', () => {
    expect(home).toContain('overflow={over ? pct - 1 : 0}')
    expect(home).toContain('slotGuide(goal.targetKcal, slotKcal ?? {})')
    expect(home).toContain('unslottedKcal')
  })

  it('the toggle lands the selection haptic (Table 9.2), and the guide is labelled as a guide', () => {
    expect(home).toMatch(/selectionAsync\(\)/)
    expect(home).toContain('A quarter of your day per meal — a guide, not a budget.')
  })
})

describe('§8.2 item 2 — tabular figures everywhere numbers update live', () => {
  it('ring center, macro rows and streak consume monoData', () => {
    // ring center: the eaten CountUp rides the monoData twin (CountUp already
    // spreads type.monoData; its callers pin no ad-hoc fontSize literals).
    expect(home).toMatch(/format=\{\(n\) => Math\.round\(n\)\.toLocaleString\(\)\}/)
    // macro stat rows:
    expect(home).toMatch(/type\.monoData[\s\S]{0,120}Math\.abs\(Math\.round\(left\)\)/)
    // streak pill:
    expect(home).toMatch(/\[type\.monoData, \{ color: theme\.text \}\]\}>\{streak\}/)
    // adaptive card target:
    expect(home).toMatch(/\{Math\.round\(goal\.targetKcal\)\.toLocaleString\(\)\} kcal/)
  })
})

describe('§8.2 item 3 — macro cards become compact stat rows with inline mini-rings', () => {
  it('one card, one line per macro, inline 36pt rings in the macro identity colours', () => {
    expect(home).toContain('function MacroStatRow(')
    expect(home).toMatch(/<ProgressRing value=\{pct\} size=\{36\} stroke=\{4\} color=\{color\}>/)
    expect(home).toMatch(/color=\{theme\.protein\}/)
    expect(home).toMatch(/color=\{theme\.carbs\}/)
    expect(home).toMatch(/color=\{theme\.fat\}/)
  })

  it('the old three-across MacroCard layout is gone (no macroRow of cards)', () => {
    expect(home).not.toContain('function MacroCard(')
    expect(home).not.toContain('styles.macroRow')
    expect(home).not.toMatch(/macroNum/)
  })
})

describe('§8.2 item 4 — the adaptive-target card runs the explicit state machine', () => {
  it('the card copy comes from adaptiveTargetView, not a nested ternary', () => {
    expect(home).toContain('adaptiveTargetView(')
    expect(home).toContain('{targetView.detail}')
    expect(home).not.toMatch(/\? `Updated to /)
  })

  it('the machine inputs are the honest ones: goal.adaptive, checkin evidence, surfaced', () => {
    expect(home).toContain('adaptive: goal.adaptive')
    expect(home).toContain('checkinAcceptedAt: goal.checkinAcceptedAt ?? null')
    expect(home).toContain('surfaced: adaptive?.surfaced === true')
  })
})

describe('§8.2 item 5 — the 56-day strip keeps 44pt rows, gains today-pulse and future-dim', () => {
  it('today-pulse: a dot breathing at the loop cadence, static under reduce motion', () => {
    expect(home).toMatch(/Animated\.loop\(/)
    expect(home).toMatch(/Animated\.timing\(pulse, \{ toValue: 0\.3, duration: TODAY_PULSE_MS/)
    expect(home).toContain('if (motionScale === 0) {')
    expect(home).toContain('pulse.setValue(1)')
    expect(home).toContain('styles.todayDot')
  })

  it('future-dim: flags come from the pure derivation and days after today are dimmed + disabled', () => {
    expect(home).toContain('const flags = dayStripFlags(off)')
    expect(home).toContain('disabled={flags.future}')
    expect(home).toContain('opacity: flags.future ? 0.4 : 1')
  })

  it('the strip stays 56 Monday-first days from dayStripOffsets, 40pt circles in 44pt+ rows', () => {
    expect(home).toContain('dayStripOffsets(now)')
    expect(home).toMatch(/width: 40, height: 40/)
    expect(derivations).toMatch(/\{ length: 56 \}/)
  })
})

describe('§8.2 items 6-7 — skeletons, pull-to-refresh, and the timeline stays', () => {
  it('skeletons own first paint — no "Loading your day" text anywhere on the screen', () => {
    expect(home).toMatch(/<Skeleton /)
    expect(home).toMatch(/<SkeletonRow lines=\{2\} \/>/)
    expect(home).not.toContain('Loading your day')
    expect(home).not.toContain('Loading…')
  })

  it('native keeps the real RefreshControl; the web build gets a REAL touch pull (RNW\'s is a View stub)', () => {
    // The stub finding is verified in node_modules: RNW renders <View/> and
    // drops onRefresh — so a web-side gesture has to exist or the "expected
    // sync gesture" is a no-op on every browser user.
    expect(home).toMatch(/<RefreshControl refreshing=\{refreshing\} onRefresh=\{onRefresh\}/)
    expect(home).toContain('PULL_THRESHOLD = 72')
    expect(home).toMatch(/onTouchMove: onTouchMovePull/)
    expect(home).toMatch(/onTouchCancel: onTouchEndPull/)
    // The pull is damped past the threshold (elastic) and springs back.
    expect(home).toMatch(/PULL_THRESHOLD \+ \(dy - PULL_THRESHOLD\) \* 0\.25/)
    expect(home).toMatch(/const snapPullTo = useCallback\(/)
    expect(home).toMatch(/Animated\.spring\(pullY, \{ toValue: to, friction: 7, tension: 120/)
    // The gesture only arms at the top of the scroll.
    expect(home).toContain('atTop.current = e.nativeEvent.contentOffset.y <= 0')
    // The indicator pill is decorative (pointer-events none, a11y-hidden).
    expect(home).toContain('<PullIndicator y={pullY} armed={pullArmed} refreshing={refreshing} />')
    expect(home).toMatch(/pointerEvents="none"/)
  })

  it('the DayTimeline read surface (Ch 7.1) is still rendered, untouched in function', () => {
    expect(home).toMatch(/<DayTimeline selectedDate=\{localDate\(selected\)\} hideDateControls hideTotals \/>/)
    expect(home).toContain("from '../../src/components/DayTimeline'")
  })
})
