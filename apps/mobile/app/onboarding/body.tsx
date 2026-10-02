import { router } from 'expo-router'
import { useMemo } from 'react'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { EditableValue, RulerPicker, Segmented, Wheel, WheelHighlight } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { kgToLb, lbToKg, setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { space, type } from '../../src/theme/tokens'

/**
 * Body metrics — the combined picker screen (UI/UX report Ch. 8.1: "body
 * metrics on one combined picker screen").
 *
 * Birth, height and weight were three screens asking three numbers that feed
 * ONE equation. They are now one screen with three sections — and the pickers
 * themselves are untouched: the same wheels, the same ruler, the same
 * selection haptics the walkthrough called genuinely excellent. A merge must
 * not cost the control quality.
 *
 * ONE unit toggle drives both height and weight (the old screens each had
 * their own, writing the same `units` field); switching converts rather than
 * resetting, as before.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Days in a month, so 31 February can never be selected. */
function daysIn(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

const DEFAULT_CM = 168 // 5 ft 6 in, the reference default
const DEFAULT_KG = 88.4 // ~194.9 lbs, matching the reference default

const CM_PER_IN = 2.54

function toFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = Math.round(cm / CM_PER_IN)
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}

export default function BodyScreen() {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const a = useAnswers()

  // A fixed reference year keeps this deterministic and avoids reading the clock
  // during render. Defaults land on a plausible adult rather than the reference
  // app's odd 2024 default, which produces a zero-year-old.
  const thisYear = 2026
  const year = a.birthYear ?? 2000
  const month = a.birthMonth ?? 1
  const day = a.birthDay ?? 1

  const cm = a.heightCm ?? DEFAULT_CM
  const imperial = a.units === 'imperial'
  const { ft, inch } = toFtIn(cm)

  const kg = a.weightKg ?? DEFAULT_KG
  const shownWeight = imperial ? kgToLb(kg) : kg
  const wMin = imperial ? 60 : 30
  const wMax = imperial ? 500 : 227

  const months = useMemo(() => MONTHS.map((m, i) => ({ value: i + 1, label: m })), [])
  const days = useMemo(
    () => Array.from({ length: daysIn(month, year) }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [month, year],
  )
  const years = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => {
        const y = thisYear - 13 - i
        return { value: y, label: String(y) }
      }).reverse(),
    [],
  )

  const feet = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ value: i + 2, label: `${i + 2} ft` })),
    [],
  )
  const inches = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: i, label: `${i} in` })),
    [],
  )
  const cms = useMemo(
    () => Array.from({ length: 151 }, (_, i) => ({ value: i + 100, label: `${i + 100} cm` })),
    [],
  )

  return (
    <OnboardingScreen
      step={stepIndex('body')}
      total={TOTAL_STEPS}
      title="A few numbers about you"
      subtitle="Birthday, height and weight all feed the calorie equation directly — every one of them changes your target."
      // The pickers show plausible defaults, so Continue is always available;
      // whatever is on screen when it is pressed is what gets saved.
      onCta={() => {
        if (a.birthYear == null) {
          setAnswer('birthYear', year)
          setAnswer('birthMonth', month)
          setAnswer('birthDay', day)
        }
        if (a.heightCm == null) setAnswer('heightCm', DEFAULT_CM)
        if (a.weightKg == null) setAnswer('weightKg', DEFAULT_KG)
        router.push(nextRoute('body') as never)
      }}
      scroll
    >
      {/* ONE unit toggle for both height and weight. Switching converts rather
          than resetting — losing the entered value on a unit toggle is a small
          betrayal that makes people distrust every other control. */}
      <View style={{ alignItems: 'center' }}>
        <Segmented
          options={[
            { value: 'imperial', label: 'lb · ft, in' },
            { value: 'metric', label: 'kg · cm' },
          ]}
          value={a.units}
          onChange={(u) => setAnswer('units', u)}
        />
      </View>

      <View style={styles.section}>
        <Text style={[type.heading, { color: theme.text }]}>When were you born?</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, marginBottom: space.md }]}>
          Age changes your BMR.
        </Text>
        <WheelHighlight>
          <Wheel
            label="Month"
            items={months}
            value={month}
            width={140}
            onChange={(v) => {
              setAnswer('birthMonth', v)
              // Clamp the day when the new month is shorter.
              const max = daysIn(v, year)
              if (day > max) setAnswer('birthDay', max)
            }}
          />
          <Wheel
            label="Day"
            items={days}
            value={day}
            width={70}
            onChange={(v) => setAnswer('birthDay', v)}
          />
          <Wheel
            label="Year"
            items={years}
            value={year}
            width={110}
            onChange={(v) => setAnswer('birthYear', v)}
          />
        </WheelHighlight>
      </View>

      <View style={styles.section}>
        <Text style={[type.heading, { color: theme.text }]}>What is your height?</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, marginBottom: space.md }]}>
          Part of the Mifflin-St Jeor equation.
        </Text>
        <WheelHighlight>
          {imperial ? (
            <>
              <Wheel
                label="Feet"
                items={feet}
                value={ft}
                width={130}
                onChange={(v) => setAnswer('heightCm', (v * 12 + inch) * CM_PER_IN)}
              />
              <Wheel
                label="Inches"
                items={inches}
                value={inch}
                width={130}
                onChange={(v) => setAnswer('heightCm', (ft * 12 + v) * CM_PER_IN)}
              />
            </>
          ) : (
            <Wheel
              label="Centimetres"
              items={cms}
              value={Math.round(cm)}
              width={space.xxxl * 4}
              onChange={(v) => setAnswer('heightCm', v)}
            />
          )}
        </WheelHighlight>
      </View>

      <View style={styles.section}>
        <Text style={[type.heading, { color: theme.text }]}>What is your weight?</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, marginBottom: space.md }]}>
          The number your target scales from.
        </Text>
        <View style={{ alignItems: 'center', marginBottom: space.lg }}>
          <EditableValue
            label="Current weight"
            value={shownWeight}
            unit={imperial ? 'lbs' : 'kg'}
            min={wMin}
            max={wMax}
            onCommit={(v) => setAnswer('weightKg', imperial ? lbToKg(v) : v)}
          />
        </View>
        <View style={{ marginHorizontal: -space.lg }}>
          <RulerPicker
            width={width}
            min={wMin}
            max={wMax}
            step={0.1}
            value={Number(shownWeight.toFixed(1))}
            onChange={(v) => setAnswer('weightKg', imperial ? lbToKg(v) : v)}
          />
        </View>
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  // Plain section rhythm, matching the pre-merge picker screens: a heading,
  // a hint, the picker. No card chrome — the wheel band and the ruler already
  // draw their own surfaces.
  section: { marginTop: space.xxl },
})
