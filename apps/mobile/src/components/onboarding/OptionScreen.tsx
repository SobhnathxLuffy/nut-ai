import { StyleSheet, Text, View } from 'react-native'
import { setAnswer, useAnswers, type OnboardingAnswers } from '../../onboarding/store'
import { useTheme } from '../../theme/ThemeProvider'
import { space, type } from '../../theme/tokens'
import type { IconName } from '../Icon'
import { OptionCard } from './Controls'

/**
 * The question-group primitive.
 *
 * The stepwise rebuild (owner mandate 2026-10) moved screen ownership into the
 * step host (app/onboarding/index.tsx) — this file no longer owns screens. It
 * owns the ONE group primitive shared by every grouped step: the labeled
 * card-group with radiogroup semantics (screen readers announce the question
 * with its options; e2e scopes same-labelled Yes/No pairs).
 */

export interface Option<V extends string | boolean> {
  value: V
  label: string
  sublabel?: string
  glyph: IconName
}

/** The type-erased group shape the step host renders via QuestionGroups. */
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
 * Build a Yes/No card group for a boolean field (worksWithProfessional,
 * rolloverCalories). Same guarantee as questionGroup.
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
 * Render question groups — the ONE group primitive, used by every grouped
 * step through the step host. Owns the heading/hint rhythm and the option
 * cards.
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
        // vs rollover).
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

const styles = StyleSheet.create({
  groupGap: { marginTop: space.xxl },
})
