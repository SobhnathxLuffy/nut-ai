import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { bmi, UNDERWEIGHT_BMI } from '@nutai/goals'
import { cheapestModel, providersByPrice, type ProviderId } from '@nutai/prompt'
import { CredentialForm, PROVIDER_NAME } from '../CredentialForm'
import { Icon, type IconName } from '../Icon'
import { OptionCard, EditableValue, RulerPicker, Segmented, Wheel, WheelHighlight } from './Controls'
import { ProjectionChart } from './Charts'
import {
  questionGroup,
  yesNoGroup,
  QuestionGroups,
  type QuestionGroup,
} from './OptionScreen'
import { putSetting } from '../../data/repo'
import { availability, requestPermissions, type HealthAvailability } from '../../health/healthkit'
import {
  inferredGoal,
  kgToLb,
  lbToKg,
  MAINTAIN_THRESHOLD_LB,
  setAnswer,
  useAnswers,
} from '../../onboarding/store'
import { useTheme } from '../../theme/ThemeProvider'
import { radius, space, type } from '../../theme/tokens'

/**
 * The sections of the SINGLE-PAGE onboarding form (owner QA 2026-10: "give
 * everything one single page").
 *
 * The old flow pushed twelve screens; each one is now a section on ONE page
 * (app/onboarding/index.tsx) with ONE Continue. Every control is extracted
 * VERBATIM from the step it came from — the same wheels, the same ruler, the
 * same option cards, the same haptics — so the merge costs no control quality.
 * Section order follows the old flow order.
 *
 * Persistence is unchanged: sections write through useAnswers()/setAnswer
 * into the onboarding store; persistOnboarding (at the plan reveal) is still
 * the single writer of user.db. The only eager writes remain the provider
 * credential path (Keychain + settings), exactly as before.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Days in a month, so 31 February can never be selected. */
function daysIn(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export const BODY_DEFAULT_CM = 168 // 5 ft 6 in, the reference default
export const BODY_DEFAULT_KG = 88.4 // ~194.9 lbs, matching the reference default

const CM_PER_IN = 2.54

function toFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = Math.round(cm / CM_PER_IN)
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}

/** Section heading — one rhythm for the whole page. */
export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  const theme = useTheme()
  return (
    <View>
      <Text style={[type.heading, { color: theme.text }]}>{title}</Text>
      {hint ? (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{hint}</Text>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------------
// About you (was activity.tsx)

const ABOUT_YOU_GROUPS: ReadonlyArray<QuestionGroup> = [
  questionGroup({
    field: 'sex',
    label: 'Your sex',
    hint: 'Used only for the BMR equation that sets your calorie target.',
    options: [
      { value: 'male', label: 'Male', glyph: 'male' },
      { value: 'female', label: 'Female', glyph: 'female' },
      { value: 'unspecified', label: 'Other', glyph: 'nonbinary' },
    ],
  }),
  questionGroup({
    field: 'workoutsPerWeek',
    label: 'Workouts per week',
    hint: 'This sets the activity multiplier on your calorie target.',
    options: [
      { value: '0-2', label: '0-2', sublabel: 'Workouts now and then', glyph: 'dot1' },
      { value: '3-5', label: '3-5', sublabel: 'A few workouts per week', glyph: 'dot3' },
      { value: '6+', label: '6+', sublabel: 'Dedicated athlete', glyph: 'dot6' },
    ],
  }),
  yesNoGroup({
    field: 'worksWithProfessional',
    label: 'Do you work with a personal trainer or registered dietitian?',
    hint: 'If you do, we surface a shareable export and stay out of your coaching.',
  }),
]

export function AboutYouSection() {
  return <QuestionGroups groups={ABOUT_YOU_GROUPS} compactTop />
}

// ---------------------------------------------------------------------------
// How you eat (was diet.tsx)

const DIET_GROUPS: ReadonlyArray<QuestionGroup> = [
  questionGroup({
    field: 'dietStyle',
    label: 'Do you follow a specific diet?',
    hint: 'We use this to rank food matches and pick sensible defaults when a scan is unsure.',
    options: [
      { value: 'balanced', label: 'Balanced', glyph: 'scaleBalance' },
      { value: 'whole_food', label: 'Whole-food focus', glyph: 'bowl' },
      { value: 'mediterranean', label: 'Mediterranean', glyph: 'leaf' },
      { value: 'flexitarian', label: 'Flexitarian', glyph: 'meat' },
      { value: 'pescatarian', label: 'Pescatarian', glyph: 'fish' },
      { value: 'vegetarian', label: 'Vegetarian', glyph: 'sprout' },
      { value: 'vegan', label: 'Vegan', glyph: 'sprout' },
    ],
  }),
  questionGroup({
    field: 'blocker',
    label: "What's stopping you from reaching your goals?",
    hint: "We'll turn on the parts of the app that help with this, and leave the rest off.",
    options: [
      { value: 'consistency', label: 'Lack of consistency', glyph: 'bars' },
      { value: 'eating_habits', label: 'Unhealthy eating habits', glyph: 'burger' },
      { value: 'support', label: 'Lack of support', glyph: 'handshake' },
      { value: 'busy', label: 'Busy schedule', glyph: 'calendar' },
      { value: 'meal_inspiration', label: 'Lack of meal inspiration', glyph: 'apple' },
    ],
  }),
]

export function DietSection() {
  return <QuestionGroups groups={DIET_GROUPS} compactTop />
}

// ---------------------------------------------------------------------------
// What would you like to accomplish? (was accomplish.tsx)

const ACCOMPLISH_GROUPS: ReadonlyArray<QuestionGroup> = [
  questionGroup({
    field: 'accomplish',
    label: 'What would you like to accomplish?',
    hint: 'This decides what your Today screen puts first.',
    options: [
      { value: 'healthier', label: 'Eat and live healthier', glyph: 'apple' },
      { value: 'energy', label: 'Boost my energy and mood', glyph: 'sun' },
      { value: 'motivated', label: 'Stay motivated and consistent', glyph: 'muscle' },
      { value: 'body_image', label: 'Feel better about my body', glyph: 'lotus' },
    ],
  }),
]

export function AccomplishSection() {
  return <QuestionGroups groups={ACCOMPLISH_GROUPS} compactTop />
}

// ---------------------------------------------------------------------------
// Body metrics (was body.tsx) — pickers verbatim

export function BodySection() {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const a = useAnswers()

  // A fixed reference year keeps this deterministic and avoids reading the clock
  // during render.
  const thisYear = 2026
  const year = a.birthYear ?? 2000
  const month = a.birthMonth ?? 1
  const day = a.birthDay ?? 1

  const cm = a.heightCm ?? BODY_DEFAULT_CM
  const imperial = a.units === 'imperial'
  const { ft, inch } = toFtIn(cm)

  const kg = a.weightKg ?? BODY_DEFAULT_KG
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
    <>
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
    </>
  )
}

// ---------------------------------------------------------------------------
// Desired weight (was desired-weight.tsx) + the direction preview (was
// projection.tsx — now an inline chart that follows the chosen direction)

const GOAL_LABEL = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain weight' } as const

export function DesiredWeightSection() {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const a = useAnswers()

  const currentKg = a.weightKg ?? BODY_DEFAULT_KG
  // Defaults to the CURRENT weight, i.e. "maintain", so the direction is
  // something the user chooses by moving, not something we assumed for them.
  const kg = a.desiredWeightKg ?? currentKg

  const imperial = a.units === 'imperial'
  const shown = imperial ? kgToLb(kg) : kg
  const min = imperial ? 60 : 30
  const max = imperial ? 500 : 227

  // The non-blocking underweight note. It never blocks continuing.
  const goalBmi = a.heightCm ? bmi(kg, a.heightCm) : null
  const underweight = goalBmi != null && goalBmi < UNDERWEIGHT_BMI

  // Direction is DERIVED, and updates live as the ruler moves — pass the current
  // ruler value rather than the stored one so the label never lags a frame.
  const goal = inferredGoal({ weightKg: currentKg, desiredWeightKg: kg })
  const deltaLb = Math.abs(kgToLb(kg) - kgToLb(currentKg))
  const deltaDisplay = imperial ? deltaLb : Math.abs(kg - currentKg)
  const maintainDisplay = imperial ? MAINTAIN_THRESHOLD_LB : MAINTAIN_THRESHOLD_LB / 2.2046226218

  return (
    <>
      <View style={{ alignItems: 'center' }}>
        <EditableValue
          label={GOAL_LABEL[goal]}
          value={shown}
          unit={imperial ? 'lbs' : 'kg'}
          min={min}
          max={max}
          onCommit={(v) => setAnswer('desiredWeightKg', imperial ? lbToKg(v) : v)}
        />
      </View>

      <View style={{ marginTop: space.lg, marginHorizontal: -space.lg }}>
        <RulerPicker
          width={width}
          min={min}
          max={max}
          step={0.1}
          value={Number(shown.toFixed(1))}
          onChange={(v) => setAnswer('desiredWeightKg', imperial ? lbToKg(v) : v)}
        />
      </View>

      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center' }]}>
          {goal === 'maintain'
            ? `Within ${maintainDisplay.toFixed(1)} ${imperial ? 'lb' : 'kg'} of where you are — we'll set you up to maintain.`
            : `${deltaDisplay.toFixed(1)} ${imperial ? 'lb' : 'kg'} to ${goal === 'gain' ? 'gain' : 'lose'}. We work the direction out from these two numbers.`}
        </Text>
      </View>

      {underweight ? (
        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>
            That target is below a BMI of 18.5. You can still choose it — we just want you to
            know, and we'll never set a calorie target below a safe floor.
          </Text>
        </View>
      ) : null}

      {/* Where this goes (was projection.tsx): the same direction-following
          chart, inline. No input — pure preview of the chosen direction. */}
      <View style={styles.projection}>
        <ProjectionChart gaining={inferredGoal(a) === 'gain'} />
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Food recognition (was provider.tsx) — verbatim cards + CredentialForm

const LABELS: Record<ProviderId, { name: string; icon: IconName; note: string }> = {
  openai: { name: 'OpenAI', icon: 'scan', note: 'GPT-4o and 4o-mini' },
  google: { name: 'Google', icon: 'scan', note: 'Gemini — paid tier only' },
  anthropic: { name: 'Anthropic', icon: 'scan', note: 'Claude Haiku and Sonnet' },
}

/**
 * The provider section reports readiness upward: a real provider needs a
 * verified key before the page-level Continue unlocks ("No key for now"
 * satisfies it immediately). The section owns the saved state because only it
 * sees the CredentialForm's onSaved.
 */
export function ProviderSection({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const theme = useTheme()
  const a = useAnswers()
  const order = providersByPrice()
  const [saved, setSaved] = useState(false)

  const realProvider: ProviderId | null =
    a.provider && a.provider !== 'none' ? a.provider : null

  // Switching providers after a saved key invalidates the save for the NEW
  // choice — the key verified was the previous provider's.
  useEffect(() => {
    setSaved(false)
  }, [a.provider])

  const ready = a.provider === 'none' || (realProvider != null && saved)

  useEffect(() => {
    onReadyChange?.(ready)
  }, [ready, onReadyChange])

  return (
    <>
      {order.map((p) => {
        const cheap = cheapestModel(p)
        return (
          <OptionCard
            key={p}
            label={LABELS[p].name}
            sublabel={`${LABELS[p].note} · ~$${cheap.approxScanCostUsd.toFixed(4)}/scan`}
            glyph={LABELS[p].icon}
            selected={a.provider === p}
            onPress={() => setAnswer('provider', p)}
          />
        )
      })}

      <OptionCard
        label="No key for now"
        sublabel="Barcode, label scan, text search and manual entry all still work"
        glyph="minus"
        selected={a.provider === 'none'}
        // Same eager write the old skip path did: no key means provider 'none'
        // is a real decision, persisted even if the flow is abandoned here.
        onPress={() => {
          setAnswer('provider', 'none')
          void putSetting('provider', 'none')
        }}
      />

      <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
          Sorted by price, with no recommendation. Frontier models are not measurably better at
          judging portion size — which is where nearly all the error is — so the cheapest vision
          model is pre-selected on purpose, not as a compromise.
        </Text>
      </View>

      {a.provider === 'google' ? (
        <View style={[styles.warn, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 19 }]}>
            Gemini's free tier is blocked for photo scans. Google's own API terms say "do not submit
            sensitive, confidential, or personal information to the Unpaid Services", and a meal
            photo is health data. A paid Google key works normally.
          </Text>
        </View>
      ) : null}

      {a.provider && a.provider !== 'none' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          You can change model and set a monthly spend cap after entering your key.
        </Text>
      ) : null}

      {realProvider ? (
        <View style={styles.keySection}>
          <Text style={[type.heading, { color: theme.text }]}>Connect {PROVIDER_NAME[realProvider]}</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, marginBottom: space.md }]}>
            We'll check the key works before saving it. It is stored in the iOS Keychain and sent
            only to {PROVIDER_NAME[realProvider]}.
          </Text>
          {/* key= remounts the form when the provider changes, so drafts and
              verify state can never leak across providers. */}
          <CredentialForm
            key={realProvider}
            provider={realProvider}
            onSaved={(modelId) => {
              setAnswer('providerModel', modelId)
              setSaved(true)
            }}
          />
        </View>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Preferences (was rollover.tsx) + reminders copy (was notifications.tsx)

export const ROLLOVER_CAP_KCAL = 200

const ROLLOVER_GROUPS: ReadonlyArray<QuestionGroup> = [
  yesNoGroup({
    field: 'rolloverCalories',
    label: `Rollover up to ${ROLLOVER_CAP_KCAL} unused calories to the next day?`,
    hint: 'Capped on purpose — banking a whole week of unused calories into one day is the pattern that turns tracking into restrict-then-binge. You can change this any time in Settings.',
  }),
]

export function PreferencesSection() {
  const theme = useTheme()
  return (
    <>
      <QuestionGroups groups={ROLLOVER_GROUPS} compactTop />
      <View style={[styles.reminders, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>
          A nudge when you'd usually log
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
          Reminders learn from when you actually log rather than firing at a fixed hour, and every
          one is local to your device. We'll ask for notification permission the first time a
          reminder is actually worth sending, not now — whether they start ON depends on the
          obstacle you picked above.
        </Text>
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Health (was health.tsx) — non-blocking connect row

export function HealthSection() {
  const theme = useTheme()
  const [avail, setAvail] = useState<HealthAvailability | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void availability().then((a) => {
      if (alive) setAvail(a)
    })
    return () => {
      alive = false
    }
  }, [])

  async function connect() {
    if (busy) return
    if (avail !== 'available') {
      setAnswer('healthConnected', false)
      return
    }
    setBusy(true)
    const res = await requestPermissions()
    setBusy(false)
    setAnswer('healthConnected', res.prompted)
    if (res.error) {
      setOutcome(res.error)
      return
    }
    // Deliberately not "Connected!". iOS never reports whether a READ
    // permission was allowed — write access IS reported, and that is the one
    // thing stated as fact.
    setOutcome(
      res.canWrite
        ? 'Health is set up. Meals you log will be written to the Health app.'
        : 'Health sheet completed. Whatever you allowed there is what we can use — iOS does not tell apps which reads were granted.',
    )
  }

  const unsupported = avail === 'not-ios' || avail === 'unavailable'

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={[styles.healthGlyph, { backgroundColor: theme.uncertainBg }]}>
          <Icon name="heart" size={22} color={theme.heart} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>Connect to Apple Health</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            Sync steps, workouts, weight and energy. Optional — skipping changes nothing else.
          </Text>
        </View>
        {avail === 'available' ? (
          <OptionCard
            label={outcome ? 'Done' : 'Connect'}
            glyph="heart"
            selected={false}
            onPress={() => void connect()}
          />
        ) : null}
      </View>

      {busy ? (
        <View style={{ marginTop: space.md, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      ) : null}

      {outcome ? (
        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>{outcome}</Text>
        </View>
      ) : null}

      {unsupported && avail != null ? (
        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>
            {avail === 'not-ios'
              ? 'Apple Health is iOS only. On Android this will use Health Connect instead.'
              : 'Health data is not available on this device, so there is nothing to connect to.'}
          </Text>
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  // Plain section rhythm, matching the pre-merge picker screens: a heading,
  // a hint, the picker. No card chrome — the wheel band and the ruler already
  // draw their own surfaces.
  section: { marginTop: space.xxl },
  note: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  keySection: { marginTop: space.xl },
  projection: { marginTop: space.xxl },
  reminders: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  healthGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
