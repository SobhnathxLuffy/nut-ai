import { router } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { nextRoute, stepIndex, TOTAL_STEPS, type Step } from '../../onboarding/flow'
import { setAnswer, useAnswers, type OnboardingAnswers } from '../../onboarding/store'
import { OnboardingScreen } from './Chrome'
import { useTheme } from '../../theme/ThemeProvider'
import { space, type } from '../../theme/tokens'
import type { IconName } from '../Icon'
import { OptionCard } from './Controls'

/**
 * Every single-choice screen in the flow.
 *
 * Wave 3 (UI/UX report Ch. 8.1) collapsed twenty steps into twelve, and most
 * of the collapse is MERGED screens: one screen, several card-group questions.
 * Writing each group by hand would guarantee they drift apart — a padding
 * here, a disabled rule there — which is exactly the inconsistency that makes
 * a flow feel cheap. So this file now owns two shapes:
 *
 *   OptionScreen         one question, one field (the original)
 *   GroupedOptionScreen  several labeled card groups, Continue gated until
 *                        every group has an answer
 */

export interface Option<V extends string | boolean> {
  value: V
  label: string
  sublabel?: string
  glyph: IconName
}

export function OptionScreen<K extends keyof OnboardingAnswers>({
  step,
  field,
  title,
  subtitle,
  options,
  scroll = false,
}: {
  step: Step
  field: K
  title: string
  subtitle?: string
  options: ReadonlyArray<Option<Extract<OnboardingAnswers[K], string>>>
  scroll?: boolean
}) {
  const answers = useAnswers()
  const current = answers[field]

  return (
    <OnboardingScreen
      step={stepIndex(step)}
      total={TOTAL_STEPS}
      title={title}
      {...(subtitle ? { subtitle } : {})}
      scroll={scroll}
      // Continue stays disabled until a choice is made, matching the reference:
      // a greyed button is a clearer instruction than an enabled one that does
      // nothing.
      ctaDisabled={current == null}
      disabledHint="Select an option to continue"
      onCta={() => router.push(nextRoute(step) as never)}
    >
      <ScrollView scrollEnabled={false} contentContainerStyle={{ paddingBottom: 8 }}>
        {options.map((o) => (
          <OptionCard
            key={o.value}
            label={o.label}
            {...(o.sublabel ? { sublabel: o.sublabel } : {})}
            glyph={o.glyph}
            selected={current === o.value}
            onPress={() => setAnswer(field, o.value as OnboardingAnswers[K])}
          />
        ))}
      </ScrollView>
    </OnboardingScreen>
  )
}

// ---------------------------------------------------------------------------

/** The type-erased group shape GroupedOptionScreen renders. */
export interface QuestionGroup {
  label: string
  hint?: string
  field: keyof OnboardingAnswers
  options: ReadonlyArray<Option<string | boolean>>
}

/**
 * Build a card group whose options are string values (sex, workouts, diet…).
 * The generic keeps the option values pinned to the field's own union, so a
 * `value: 'vegan'` in the `blocker` group is a compile error, not a runtime
 * answer the store silently keeps.
 */
export function questionGroup<K extends keyof OnboardingAnswers>(
  spec: {
    field: K
    label: string
    hint?: string
    options: ReadonlyArray<Option<Extract<OnboardingAnswers[K], string>>>
  },
): QuestionGroup {
  return spec
}

/**
 * Build a Yes/No card group for a boolean field (worksWithProfessional).
 * Same guarantee as questionGroup, for the one boolean question in the flow.
 */
export function yesNoGroup<K extends keyof OnboardingAnswers>(
  spec: {
    field: K
    label: string
    hint?: string
  },
): QuestionGroup {
  const opts: ReadonlyArray<Option<boolean>> = [
    { value: true, label: 'Yes', glyph: 'thumbUp' },
    { value: false, label: 'No', glyph: 'thumbDown' },
  ]
  return { field: spec.field, label: spec.label, hint: spec.hint, options: opts }
}

/**
 * Render question groups — the ONE group primitive, shared by
 * GroupedOptionScreen (step pages) and the single-page onboarding form
 * (OnboardingSections). Owns the heading/hint rhythm and the option cards.
 */
export function QuestionGroups({
  groups,
  compactTop = false,
}: {
  groups: ReadonlyArray<QuestionGroup>
  /** The first group sits directly beneath a section heading — trim its top gap. */
  compactTop?: boolean
}) {
  const theme = useTheme()
  const answers = useAnswers()
  return (
    <View>
      {groups.map((g, gi) => (
        // radiogroup semantics: screen readers announce the question with its
        // options, and e2e can scope same-labelled Yes/No pairs (professional
        // vs rollover on the single-page form).
        <View
          key={String(g.field)}
          accessibilityRole="radiogroup"
          accessibilityLabel={g.label}
          style={gi > 0 || !compactTop ? styles.groupGap : undefined}
        >
          <Text style={[type.heading, { color: theme.text }]}>{g.label}</Text>
          {g.hint ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, marginBottom: space.md }]}>
              {g.hint}
            </Text>
          ) : (
            <View style={{ height: space.md }} />
          )}
          {g.options.map((o) => (
            <OptionCard
              key={String(o.value)}
              label={o.label}
              {...(o.sublabel ? { sublabel: o.sublabel } : {})}
              glyph={o.glyph}
              selected={answers[g.field] === o.value}
              // The one type-erasure point: the builders above already pinned
              // each option set to its field's union at compile time.
              onPress={() => setAnswer(g.field, o.value as OnboardingAnswers[keyof OnboardingAnswers])}
            />
          ))}
        </View>
      ))}
    </View>
  )
}

export function GroupedOptionScreen({
  step,
  title,
  subtitle,
  groups,
  scroll = false,
}: {
  step: Step
  title: string
  subtitle?: string
  groups: ReadonlyArray<QuestionGroup>
  scroll?: boolean
}) {
  const answers = useAnswers()
  // Every question must be answered before Continue unlocks — a merged screen
  // that lets one of its fields through unset would silently feed the plan
  // generator a default. The gate is the whole point of the merge.
  const allAnswered = groups.every((g) => answers[g.field] != null)

  return (
    <OnboardingScreen
      step={stepIndex(step)}
      total={TOTAL_STEPS}
      title={title}
      {...(subtitle ? { subtitle } : {})}
      scroll={scroll}
      ctaDisabled={!allAnswered}
      disabledHint="Answer every question to continue"
      onCta={() => router.push(nextRoute(step) as never)}
    >
      <ScrollView scrollEnabled={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <QuestionGroups groups={groups} />
      </ScrollView>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  groupGap: { marginTop: space.xxl },
})
