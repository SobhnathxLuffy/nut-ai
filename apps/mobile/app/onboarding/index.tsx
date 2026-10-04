import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import {
  AboutYouSection,
  AccomplishSection,
  BodySection,
  BODY_DEFAULT_CM,
  BODY_DEFAULT_KG,
  DesiredWeightSection,
  DietSection,
  HealthSection,
  PreferencesSection,
  ProviderSection,
  SectionHeading,
} from '../../src/components/onboarding/OnboardingSections'
import { stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { space } from '../../src/theme/tokens'

/**
 * Onboarding — ONE single page (owner QA 2026-10: "give everything one single
 * page").
 *
 * The flow used to push TWELVE screens (welcome, 3 grouped question screens,
 * body pickers, desired weight, provider, health, projection, rollover,
 * notifications, plan reveal). The owner was handed three questions per page,
 * page after page, and asked for everything on one page instead.
 *
 * This page is now that: every question from the old steps 2–11 rendered as a
 * section, in the same order, with the SAME controls extracted verbatim into
 * OnboardingSections.tsx — then ONE Continue that opens the plan reveal
 * (/onboarding/plan, unchanged), which still computes and persists through
 * persistOnboarding exactly as before.
 *
 * Honest gates, not silent defaults: Continue unlocks only when every question
 * that HAS no safe default is answered (about-you, diet, accomplish, rollover,
 * provider choice). The body pickers show plausible defaults and are committed
 * as-shown on Continue, matching the old body screen's contract.
 *
 * The old welcome demo loop is gone: on a single page a self-playing animation
 * above a long form is noise, and the app itself demos the scan better than a
 * mock can. The restore entry stays (backup restore is an alternate first-run
 * path and the e2e harness depends on it).
 */
export default function Welcome() {
  const a = useAnswers()
  // The provider section owns "is the key verified" — it is the only thing
  // that sees the CredentialForm's onSaved. Everything else gates off the
  // store directly.
  const [providerReady, setProviderReady] = useState(false)

  const requiredAnswered =
    a.sex != null &&
    a.workoutsPerWeek != null &&
    a.worksWithProfessional != null &&
    a.dietStyle != null &&
    a.blocker != null &&
    a.accomplish != null &&
    a.rolloverCalories != null

  const finish = () => {
    // Commit the picker defaults exactly as the old body screen did: whatever
    // is on screen when Continue is pressed is what gets saved.
    if (a.birthYear == null) {
      setAnswer('birthYear', 2000)
      setAnswer('birthMonth', 1)
      setAnswer('birthDay', 1)
    }
    if (a.heightCm == null) setAnswer('heightCm', BODY_DEFAULT_CM)
    if (a.weightKg == null) setAnswer('weightKg', BODY_DEFAULT_KG)
    if (a.desiredWeightKg == null) setAnswer('desiredWeightKg', a.weightKg ?? BODY_DEFAULT_KG)
    router.push('/onboarding/plan' as never)
  }

  return (
    <OnboardingScreen
      step={stepIndex('index')}
      total={TOTAL_STEPS}
      title="Calorie tracking made easy"
      subtitle="One page, one plan. Every answer below feeds the math you'll start from."
      cta="See my plan"
      ctaDisabled={!requiredAnswered || !providerReady}
      disabledHint="Answer every question to continue"
      onCta={finish}
      secondaryLabel="Restore from a backup"
      onSecondary={() => router.push('/onboarding/restore' as never)}
      scroll
    >
      <SectionHeading
        title="A few questions about you"
        hint="Three quick answers set the math your plan is built on."
      />
      <AboutYouSection />

      <View style={styles.section}>
        <SectionHeading
          title="How you eat"
          hint="Your diet shapes which food matches rank first; your main obstacle decides which helpful parts of the app switch on."
        />
        <DietSection />
      </View>

      <View style={styles.section}>
        <AccomplishSection />
      </View>

      <View style={styles.section}>
        <SectionHeading
          title="Your body"
          hint="Birthday, height and weight all feed the calorie equation directly — every one of them changes your target."
        />
        <BodySection />
        <DesiredWeightSection />
      </View>

      <View style={styles.section}>
        <SectionHeading
          title="Food recognition"
          hint="Optional — bring your own API key. Your photo goes to the provider you name and nowhere else; we run no server."
        />
        <ProviderSection onReadyChange={setProviderReady} />
      </View>

      <View style={styles.section}>
        <SectionHeading title="Preferences" />
        <PreferencesSection />
      </View>

      <View style={styles.section}>
        <HealthSection />
      </View>
    </OnboardingScreen>
  )
}

const styles = {
  section: { marginTop: space.xxl } as const,
}
