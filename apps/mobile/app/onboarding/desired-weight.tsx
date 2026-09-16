import { router } from 'expo-router'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { bmi, UNDERWEIGHT_BMI } from '@nutai/goals'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { EditableValue, RulerPicker } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { inferredGoal, kgToLb, lbToKg, MAINTAIN_THRESHOLD_LB, setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const GOAL_LABEL = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain weight' } as const

export default function DesiredWeightScreen() {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const a = useAnswers()

  const currentKg = a.weightKg ?? 88.4
  // Defaults to the CURRENT weight, i.e. "maintain", so the direction is
  // something the user chooses by moving, not something we assumed for them.
  const kg = a.desiredWeightKg ?? currentKg

  const imperial = a.units === 'imperial'
  const shown = imperial ? kgToLb(kg) : kg
  const min = imperial ? 60 : 30
  const max = imperial ? 500 : 227

  // The non-blocking underweight note. It appears HERE, at goal-weight entry,
  // rather than after the plan is generated — telling someone their target is
  // concerning only once it is already on screen is far worse than saying it
  // while they are choosing. It never blocks Continue.
  const goalBmi = a.heightCm ? bmi(kg, a.heightCm) : null
  const underweight = goalBmi != null && goalBmi < UNDERWEIGHT_BMI

  // Direction is DERIVED, and updates live as the ruler moves — pass the current
  // ruler value rather than the stored one so the label never lags a frame.
  const goal = inferredGoal({ weightKg: currentKg, desiredWeightKg: kg })
  const deltaLb = Math.abs(kgToLb(kg) - kgToLb(currentKg))
  const deltaDisplay = imperial ? deltaLb : Math.abs(kg - currentKg)
  const maintainDisplay = imperial ? MAINTAIN_THRESHOLD_LB : MAINTAIN_THRESHOLD_LB / 2.2046226218

  return (
    <OnboardingScreen
      step={stepIndex('desired-weight')}
      total={TOTAL_STEPS}
      title="What is your desired weight?"
      onCta={() => {
        if (a.desiredWeightKg == null) setAnswer('desiredWeightKg', kg)
        router.push(nextRoute('desired-weight') as never)
      }}
    >
      <View style={{ alignItems: 'center', marginTop: 72 }}>
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
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg },
})
