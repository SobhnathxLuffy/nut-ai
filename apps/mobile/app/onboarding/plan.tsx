import { router } from 'expo-router'
import { useEffect, useMemo, useRef } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  computeCalorieTarget,
  computeMacros,
  KCAL_PER_LB,
  type BodyInputs,
} from '@nutai/goals'
import { Icon, type IconName } from '../../src/components/Icon'
import { ProgressChart } from '../../src/components/onboarding/Charts'
import { CountUp } from '../../src/components/ProgressRing'
import { useReducedMotion } from '../../src/components/PressableFX'
import { persistOnboarding } from '../../src/onboarding/persist'
import { readTutorialSeen, shouldAutoShowTutorial } from '../../src/tutorial/key'
import {
  activityFor,
  ageFrom,
  DIET_BIAS,
  featureDefaultsFor,
  inferredGoal,
  kgToLb,
  todayEmphasisFor,
  useAnswers,
} from '../../src/onboarding/store'
import { success } from '../../src/utils/haptics'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * The plan reveal — the HERO moment (UI/UX report Ch. 8.1: "The plan reveal …
 * becomes the hero moment: numbers count up, the breakdown expands with a
 * spring, and a success haptic marks the finish").
 *
 *   - Numbers count up: the calorie and macro figures ride CountUp — the
 *     ProgressRing twin with the SAME 600ms ease-out (Table 9.1 "Ring /
 *     count-up"), set in monoData tabular figures so the digits align while
 *     they count (report §4.2). The scale rides the token steps (display for
 *     the calorie hero, heading for the macros); only the movement is new.
 *   - The breakdown expands with a spring: "How we got there" opens with
 *     Animated.spring — position-based motion is a spring per report §9, never
 *     a duration.
 *   - A success haptic marks the finish (Table 9.2: milestone → Success).
 *
 * All three respect motionScale: under reduce-motion the numbers render
 * instantly (CountUp's own gate), the breakdown renders fully open, and the
 * haptic fires immediately — the information arrives without the movement.
 *
 * This is also where every earlier answer cashes out, and where we diverge
 * hardest from the reference — not in layout, but in what the screen is
 * willing to claim.
 *
 * KEPT: the estimated-progress chart, the "Your info" recap, and "How to reach
 * your goals". Those are genuinely useful.
 *
 * CUT, deliberately:
 *   - "Trusted by millions: 10M+ users, 4.8 stars". We have no users. Inventing
 *     social proof is fabricating a record, and a rating counter on a plan screen
 *     is a conversion device, not information.
 *   - The "Without Nut AI ❌ / With Nut AI ✅" comparison. It is an ad, placed
 *     where a person is looking at their own body data.
 *
 * ADDED: the arithmetic. The reference shows 3826 kcal with no way to see where
 * it came from. Every number here can be traced, and the safety floor explains
 * itself in words whenever it fires.
 */

/** Ch 8.1: the breakdown springs open just after the count-up begins. */
const PLAN_SPRING_DELAY_MS = 400
/** Ch 8.1: the success haptic lands once the reveal has finished. */
const PLAN_FINISH_HAPTIC_MS = 1200
/** Spring character for the breakdown expansion (report §9: springs for position). */
const PLAN_SPRING = { friction: 8, tension: 64 } as const

export default function PlanScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const a = useAnswers()
  const reduced = useReducedMotion()

  const derivedGoal = inferredGoal(a)

  const plan = useMemo(() => {
    const body: BodyInputs = {
      sex: a.sex ?? 'unspecified',
      weightKg: a.weightKg ?? 80,
      heightCm: a.heightCm ?? 170,
      ageYears: ageFrom(a, Date.parse('2026-08-01T00:00:00Z')),
    }

    const currentKg = a.weightKg ?? 80
    const targetKg = a.desiredWeightKg ?? currentKg
    const deltaLb = Math.abs(kgToLb(targetKg) - kgToLb(currentKg))

    // A sane default rate, then let the floor clamp argue with it if it must.
    const rate = derivedGoal === 'maintain' ? 0 : Math.min(1, Math.max(0.25, deltaLb / 12))

    const target = computeCalorieTarget({
      ...body,
      activity: activityFor(a.workoutsPerWeek),
      goal: derivedGoal,
      rateLbPerWeek: rate,
    })
    const macros = computeMacros(target.target, body.weightKg, derivedGoal)

    // Target date from the actual arithmetic, not a flattering guess.
    const weeks = rate > 0 ? deltaLb / rate : 0
    const date = new Date(Date.parse('2026-08-01T00:00:00Z') + weeks * 7 * 86_400_000)
    const dateLabel = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

    return { target, macros, deltaLb, dateLabel, rate }
  }, [a, derivedGoal])

  // ---------------------------------------------------------------------
  // The hero choreography (Ch 8.1). One Animated.Value drives the breakdown
  // expansion; the count-ups run inside CountUp with the same 600ms ease-out.
  // ---------------------------------------------------------------------
  const reveal = useRef(new Animated.Value(reduced ? 1 : 0)).current

  useEffect(() => {
    if (reduced) return
    const t = setTimeout(() => {
      Animated.spring(reveal, { toValue: 1, ...PLAN_SPRING, useNativeDriver: false }).start()
    }, PLAN_SPRING_DELAY_MS)
    return () => clearTimeout(t)
  }, [reduced, reveal])

  // A success haptic marks the finish — after the count-up and the spring have
  // landed; instantly under reduce-motion (the finish is no less real there).
  useEffect(() => {
    const t = setTimeout(() => void success(), reduced ? 0 : PLAN_FINISH_HAPTIC_MS)
    return () => clearTimeout(t)
  }, [reduced])

  const breakdownStyle = reduced
    ? undefined
    : {
        maxHeight: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, 700] }),
        opacity: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
      }

  const gaining = derivedGoal === 'gain'
  const imperial = a.units === 'imperial'
  const displayUnit = imperial ? 'lb' : 'kg'
  const displayWeight = (kg: number) => imperial ? kgToLb(kg) : kg
  const displayDelta = imperial ? plan.deltaLb : plan.deltaLb / 2.2046226218
  const displayRate = imperial ? plan.rate : plan.rate / 2.2046226218
  const goalLine =
    derivedGoal === 'maintain'
      ? 'Goal: maintain your weight'
      : `Goal: ${gaining ? 'gain' : 'lose'} ${displayDelta.toFixed(1)} ${displayUnit} by ${plan.dateLabel}`

  const features = featureDefaultsFor(a.blocker)
  const diet = a.dietStyle ? DIET_BIAS[a.dietStyle] : null

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.xl,
          paddingBottom: 140,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.check, { backgroundColor: theme.text }]}>
            <Icon name="check" size={22} color={theme.bg} weight={2.4} />
          </View>
          <Text style={[styles.goal, { color: theme.text }]}>{goalLine}</Text>
        </View>

        <View style={{ marginTop: space.xl }}>
          <ProgressChart
            targetLabel={`${displayWeight(a.desiredWeightKg ?? a.weightKg ?? 80).toFixed(1)} ${displayUnit}`}
            dateLabel={derivedGoal === 'maintain' ? 'Ongoing' : plan.dateLabel}
            gaining={gaining}
          />
        </View>

        {/* Daily recommendation */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Your daily recommendation</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            You can edit this anytime
          </Text>

          <View style={[styles.bigCard, { backgroundColor: theme.bgElevated }]}>
            <View style={[styles.iconSq, { backgroundColor: theme.bgSunken }]}>
              <Icon name="flame" size={20} color={theme.text} />
            </View>
            <View>
              {/* Ch 8.1 hero: the number COUNTS UP in monoData tabular figures
                  (CountUp, Table 9.1's 600ms ease-out) at the display scale. */}
              <CountUp
                value={plan.target.target}
                style={[styles.bigNum, { color: theme.text }]}
              />
              <Text style={[type.caption, { color: theme.textMuted }]}>Calories</Text>
            </View>
          </View>

          <View style={styles.macroRow}>
            <MacroCard label="Protein" value={plan.macros.protein_g} icon="protein" color={theme.protein} />
            <MacroCard label="Carbs" value={plan.macros.carbs_g} icon="carbs" color={theme.carbs} />
            <MacroCard label="Fats" value={plan.macros.fat_g} icon="fat" color={theme.fat} />
          </View>
        </View>

        {/* The floor clamp explains itself, in words, right where it applied. */}
        {plan.target.floorApplied ? (
          <View style={[styles.notice, { backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>We raised your target</Text>
            <Text style={[type.caption, { color: theme.text, marginTop: space.xs }]}>
              {plan.target.floorExplanation} Eating below that is not a faster route to your goal,
              it is a slower one with worse side effects.
            </Text>
          </View>
        ) : null}

        {plan.target.warnings.map((w) => (
          <View key={w} style={[styles.notice, { backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.caption, { color: theme.text }]}>{w}</Text>
          </View>
        ))}

        {/* Where the number came from. The reference shows none of this — and
            the whole section EXPANDS WITH A SPRING (Ch 8.1). */}
        <Animated.View style={[styles.section, { backgroundColor: theme.bgSunken }, breakdownStyle]}>
          <Text style={[type.heading, { color: theme.text }]}>How we got there</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            No black box. Check our arithmetic.
          </Text>
          <View style={[styles.mathCard, { backgroundColor: theme.bgElevated }]}>
            <MathRow label="BMR (Mifflin-St Jeor)" value={`${Math.round(plan.target.bmr)} kcal`} />
            <MathRow
              label={`× activity (${activityFor(a.workoutsPerWeek)})`}
              value={`${Math.round(plan.target.tdee)} kcal`}
            />
            {derivedGoal !== 'maintain' ? (
              <MathRow
                label={`${gaining ? '+' : '−'} ${displayRate.toFixed(2)} ${displayUnit}/week`}
                value={`${gaining ? '+' : '−'}${Math.round((plan.rate * KCAL_PER_LB) / 7)} kcal`}
              />
            ) : null}
            <MathRow label="Your daily target" value={`${Math.round(plan.target.target)} kcal`} strong />
          </View>
        </Animated.View>

        {/* Your info */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Your info</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            Based on your inputs.
          </Text>
          <View style={[styles.mathCard, { backgroundColor: theme.bgElevated }]}>
            <InfoRow icon="person" label="Starting weight" value={`${displayWeight(a.weightKg ?? 80).toFixed(1)} ${displayUnit}`} />
            <InfoRow icon="target" label="Goal weight" value={`${displayWeight(a.desiredWeightKg ?? a.weightKg ?? 80).toFixed(1)} ${displayUnit}`} />
            <InfoRow icon="steps" label="Activity level" value={activityFor(a.workoutsPerWeek)} />
            {diet ? <InfoRow icon="bowl" label="Diet" value={diet.label} /> : null}
          </View>
        </View>

        {/* What your answers actually switched on. */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>What we set up for you</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            From your answers. All of it is changeable in Settings.
          </Text>
          <View style={{ marginTop: space.md, gap: space.sm }}>
            {diet ? (
              <Bullet text={`Food matches biased toward a ${diet.label.toLowerCase()} diet, and "what kind of milk?" defaults to ${diet.defaultMilk}.`} />
            ) : null}
            {features.remindersOn ? <Bullet text="Reminders on, learned from when you actually log." /> : null}
            {features.savedMealsPinned ? <Bullet text="Saved meals pinned for one-tap relogging." /> : null}
            {features.showMealIdeas ? <Bullet text="Meal ideas surfaced on the Today screen." /> : null}
            {a.worksWithProfessional ? (
              <Bullet text="Shareable export enabled, and we'll keep our coaching suggestions out of your way." />
            ) : null}
            {a.rolloverCalories ? <Bullet text="Unused calories roll over, capped at 200 a day." /> : null}
            <Bullet text={`Today screen leads with ${todayEmphasisFor(a.accomplish)}.`} />
          </View>
        </View>

        {/* How to reach your goals */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>How to reach your goals</Text>
          <View style={{ marginTop: space.md, gap: space.sm }}>
            <HowRow icon="scan" text="Track your food" />
            <HowRow icon="flame" text="Follow your daily calorie recommendation" />
            <HowRow icon="scaleBalance" text="Balance your carbs, protein and fat" />
            <HowRow icon="chart" text="Check the trend, not the daily number" />
          </View>
        </View>

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl, lineHeight: 19 }]}>
          These are estimates from population equations, not measurements of you. Nut AI is not a
          medical device. Adjust anything that does not fit, and talk to a dietitian or doctor
          before making medical decisions.
        </Text>
      </ScrollView>

      <View
        style={[
          styles.dock,
          { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg, borderTopColor: theme.border },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // Persist BEFORE navigating. A plan the user saw but the app forgot
            // is worse than no plan: they would arrive at a Today screen whose
            // targets contradict the screen they just approved.
            void persistOnboarding(a, plan.target, plan.macros)
              .then(() => {
                router.replace('/(tabs)' as never)
              })
              .then(async () => {
                // The optional walkthrough (owner item #3): fresh completions
                // ONLY. Replace-then-push keeps the tabs below the tour, so
                // Skip and hardware Back both land on Home — it can never
                // trap. The restore path (finishRestore) never routes here,
                // so restoring users are never ambushed; a re-play from the
                // Profile About group is explicit and never re-arms this.
                if (shouldAutoShowTutorial(await readTutorialSeen())) {
                  router.push('/tutorial' as never)
                }
              })
          }}
          style={[styles.cta, { backgroundColor: theme.text }]}
        >
          {/* Wave 1a: CTA text drops the 18px override — bodyStrong is the
              button voice (UI/UX report Table 3.1). */}
          <Text style={[type.bodyStrong, { color: theme.bg }]}>Let's get started!</Text>
        </Pressable>
      </View>
    </View>
  )
}

function MacroCard({ label, value, icon, color }: { label: string; value: number; icon: IconName; color: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.macroCard, { backgroundColor: theme.bgElevated }]}>
      <View style={[styles.iconSq, { backgroundColor: theme.bgSunken, width: 34, height: 34 }]}>
        <Icon name={icon} size={18} color={color} />
      </View>
      {/* Ch 8.1 hero: macros count up too — monoData tabular figures at the
          heading scale. */}
      <CountUp value={value} format={(n) => `${Math.round(n)}g`} style={[styles.macroNum, { color: theme.text }]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
        <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      </View>
    </View>
  )
}

function MathRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme()
  return (
    <View style={styles.mathRow}>
      <Text style={[strong ? type.bodyStrong : type.body, { color: strong ? theme.text : theme.textMuted, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

function InfoRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={styles.mathRow}>
      <View style={{ width: 26 }}>
        <Icon name={icon} size={17} color={theme.textMuted} />
      </View>
      <Text style={[type.body, { color: theme.textMuted, flex: 1 }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

function Bullet({ text }: { text: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Text style={{ color: theme.textMuted }}>•</Text>
      <Text style={[type.caption, { color: theme.textMuted, flex: 1, lineHeight: 19 }]}>{text}</Text>
    </View>
  )
}

function HowRow({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.howRow, { backgroundColor: theme.bgElevated }]}>
      <Icon name={icon} size={22} color={theme.text} />
      <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  check: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  goal: {
    // Wave 1a: plan headline → type.display; big macro number → display too
    // (report Table 3.1 — 32/38px hero moments join 56/60/800).
    ...type.display,
    // Wave 4b: display caps at 1.2× (56×1.2 = 67.2 > 60) — lineHeight 68
    // keeps the headline unclipped at the cap.
    lineHeight: 68,
    textAlign: 'center',
    marginTop: space.lg,
  },
  section: { marginTop: space.xl, padding: space.lg, borderRadius: radius.xl },
  bigCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.lg,
    marginTop: space.md, padding: space.lg, borderRadius: radius.lg,
  },
  iconSq: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  // The count-up hero numbers ride monoData (tabular figures, report §4.2) at
  // the display / heading scales — every size still a token reference.
  // Wave 4b: display-size numerals cap at 1.2× (56×1.2 = 67.2) — the 68
  // lineHeight matches every other display call site.
  bigNum: { ...type.monoData, fontSize: type.display.fontSize, lineHeight: 68 },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  macroCard: { flex: 1, padding: space.md, borderRadius: radius.lg, gap: space.xs },
  macroNum: { ...type.monoData, fontSize: type.heading.fontSize, lineHeight: type.heading.lineHeight },
  mathCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg, gap: space.md },
  mathRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notice: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  howRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.lg,
    padding: space.lg, borderRadius: radius.lg,
  },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
