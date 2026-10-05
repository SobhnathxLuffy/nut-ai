import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler } from 'react-native'
import Storage from 'expo-sqlite/kv-store'
import { clamp } from '../../src/utils/clamp'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import {
  AccomplishSection,
  ActivitySection,
  BODY_DEFAULT_CM,
  BODY_DEFAULT_KG,
  BirthSection,
  DietSection,
  HealthSection,
  HeightSection,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  isRealBirthDate,
  PreferencesSection,
  ProviderSection,
  SexSection,
  UnitsSection,
  WeightSection,
  DesiredWeightSection,
} from '../../src/components/onboarding/OnboardingSections'
import { loadDraft, saveDraft } from '../../src/onboarding/draft'
import { ONBOARDING_DONE_KEY } from '../../src/onboarding/done-key'
import { FLOW, stepIndex, TOTAL_STEPS, type Step } from '../../src/onboarding/flow'
import { lbToKg, replaceAnswers, setAnswer, useAnswers } from '../../src/onboarding/store'

/**
 * Onboarding — the STEPWISE host (owner mandate 2026-10: one focused question
 * group per step; the single-page collapse went too far the other way).
 *
 * ONE route hosting TWELVE steps as internal state (src/onboarding/flow.ts is
 * the step machine). Steps are NOT routes: the header chevron and Android's
 * hardware Back step between them with state intact, and step 1 falls back to
 * the default back behaviour. The chrome states "Step N of 12" and every
 * intermediate step's CTA is "Continue" — "See my plan" exists ONLY on the
 * final step and still opens /onboarding/plan (the reveal, unchanged, which
 * persists through persistOnboarding).
 *
 * RESUME: every answer and step change persists a draft
 * ('onboarding.draft.v1', see src/onboarding/draft.ts). On mount, if the
 * done key is unset and a valid draft exists, the host restores the answers
 * and jumps straight back to the saved step. The draft is cleared inside
 * persistOnboarding's success path — completion, not navigation, ends it.
 *
 * Gates stay honest per step: option steps gate on their group answers, the
 * provider step on the verified key (or "No key for now"), the pickers commit
 * their shown defaults on Continue exactly like the pre-merge body screens,
 * and the underweight note on goal weight stays visible but non-blocking.
 */

// The pickers' absolute bounds, mirroring the wheels/ruler ranges. The height
// bounds are OWNED by OnboardingSections (T5-fix2: the ft/in EditableValue
// commit clamps with the SAME constants — one clamp, not two near-misses);
// the weight ruler spans 30–227 kg (60–500 lb).
const WEIGHT_MIN_KG = lbToKg(60)
const WEIGHT_MAX_KG = 227

export default function OnboardingFlow() {
  const a = useAnswers()
  const [step, setStep] = useState<Step>('welcome')
  // Hydration gate: the draft must be READ before the host may WRITE one, or
  // the mount-time effect would clobber the snapshot with empty answers.
  const [hydrated, setHydrated] = useState(false)
  // The provider section owns "is the key verified" — it is the only thing
  // that sees the CredentialForm's onSaved. Everything else gates off the
  // store directly.
  const [providerReady, setProviderReady] = useState(false)
  // T5-fix2 (review nice-to-have 5): the health step's "See my plan" push had
  // no guard — a double-tap stacked /onboarding/plan twice. Same busy-ref
  // pattern as plan.tsx's persist CTA; the ref re-arms on focus, because a
  // push cannot fail the way a persist can — the way back here is RETURNING
  // from the plan screen (Android back), and that must leave the CTA usable.
  const planNavBusy = useRef(false)
  useFocusEffect(useCallback(() => { planNavBusy.current = false }, []))

  const position = stepIndex(step)

  // ------------------------------------------------------------------
  // Resume: restore answers + jump to the saved step (done key unset only).
  // ------------------------------------------------------------------
  useEffect(() => {
    let alive = true
    void (async () => {
      const done = await Storage.getItem(ONBOARDING_DONE_KEY)
      if (done !== 'true') {
        const draft = await loadDraft()
        if (alive && draft) {
          replaceAnswers(draft.answers)
          setStep(draft.step)
        }
      }
      if (alive) setHydrated(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  // Persist the draft on every answer/step change — synchronous writes are
  // fine at this scale (a few hundred bytes of JSON), and saving on every
  // change is what makes a kill at ANY moment safe.
  useEffect(() => {
    if (!hydrated) return
    void saveDraft({ answers: a, step, savedAt: Date.now() })
  }, [a, step, hydrated])

  // ------------------------------------------------------------------
  // Android hardware Back: previous step with state intact; step 1 follows
  // the default system behaviour (there is nothing behind onboarding but the
  // gate).
  // ------------------------------------------------------------------
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === FLOW[0]) return false
      setStep(FLOW[Math.max(0, FLOW.indexOf(step) - 1)]!)
      return true
    })
    return () => sub.remove()
  }, [step])

  const goPrev = () => {
    if (step === FLOW[0]) {
      router.back()
      return
    }
    setStep(FLOW[Math.max(0, FLOW.indexOf(step) - 1)]!)
  }
  const goNext = () => {
    setStep(FLOW[Math.min(FLOW.length - 1, FLOW.indexOf(step) + 1)]!)
  }

  // ------------------------------------------------------------------
  // Per-step bodies. Question sections render through QuestionGroups (the
  // grouped gate pattern); picker sections commit their shown defaults on
  // Continue, exactly as the pre-merge body screens did.
  // ------------------------------------------------------------------
  switch (step) {
    case 'welcome':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Calorie tracking made easy"
          subtitle="A few quick answers set the math you'll start from. Everything is changeable later — and your height and weight units are yours to pick independently."
          onCta={goNext}
          onBack={goPrev}
          secondaryLabel="Restore from a backup"
          onSecondary={() => router.push('/onboarding/restore' as never)}
          scroll
        >
          <UnitsSection />
        </OnboardingScreen>
      )

    case 'sex': {
      const answered = a.sex != null
      return (
        <StepScreen step={step} onBack={goPrev} onCta={goNext} ctaDisabled={!answered}>
          <SexSection />
        </StepScreen>
      )
    }

    case 'activity': {
      const answered = a.workoutsPerWeek != null && a.worksWithProfessional != null
      return (
        <StepScreen step={step} onBack={goPrev} onCta={goNext} ctaDisabled={!answered}>
          <ActivitySection />
        </StepScreen>
      )
    }

    case 'diet': {
      const answered = a.dietStyle != null && a.blocker != null
      return (
        <StepScreen step={step} onBack={goPrev} onCta={goNext} ctaDisabled={!answered}>
          <DietSection />
        </StepScreen>
      )
    }

    case 'accomplish': {
      const answered = a.accomplish != null
      return (
        <StepScreen step={step} onBack={goPrev} onCta={goNext} ctaDisabled={!answered}>
          <AccomplishSection />
        </StepScreen>
      )
    }

    case 'birth':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Your body"
          subtitle="Your birthday, height and weight all feed the calorie equation directly."
          onCta={() => {
            // Commit the shown defaults, then validate the committed date.
            // The wheels can only produce real dates; this catches draft
            // damage instead of feeding the BMR a 31 February.
            if (a.birthYear == null) {
              setAnswer('birthYear', 2000)
              setAnswer('birthMonth', 1)
              setAnswer('birthDay', 1)
            }
            const y = a.birthYear ?? 2000
            const m = a.birthMonth ?? 1
            const d = a.birthDay ?? 1
            if (isRealBirthDate(y, m, d)) goNext()
          }}
          ctaDisabled={
            a.birthYear != null && !isRealBirthDate(a.birthYear, a.birthMonth ?? 1, a.birthDay ?? 1)
          }
          disabledHint="Pick a real date of birth to continue"
          onBack={goPrev}
          centerContent
        >
          <BirthSection />
        </OnboardingScreen>
      )

    case 'height':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Your body"
          subtitle="Birthday, height and weight all feed the calorie equation directly — every one of them changes your target."
          onCta={() => {
            // Commit the shown default, clamped to the pickers' range — the
            // canonical value stays centimetres whatever the display unit.
            const raw = a.heightCm ?? BODY_DEFAULT_CM
            setAnswer('heightCm', clamp(Number.isFinite(raw) ? raw : BODY_DEFAULT_CM, HEIGHT_MIN_CM, HEIGHT_MAX_CM))
            goNext()
          }}
          onBack={goPrev}
          centerContent
        >
          <HeightSection />
        </OnboardingScreen>
      )

    case 'weight':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Your body"
          subtitle="Birthday, height and weight all feed the calorie equation directly — every one of them changes your target."
          onCta={() => {
            // Commit the shown default, clamped in canonical kilograms.
            const raw = a.weightKg ?? BODY_DEFAULT_KG
            setAnswer('weightKg', clamp(Number.isFinite(raw) ? raw : BODY_DEFAULT_KG, WEIGHT_MIN_KG, WEIGHT_MAX_KG))
            goNext()
          }}
          onBack={goPrev}
          centerContent
        >
          <WeightSection />
        </OnboardingScreen>
      )

    case 'goal-weight':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Your goal weight"
          subtitle="The direction is worked out from this and your current weight — no separate goal question."
          onCta={() => {
            // Defaults to the current weight, i.e. "maintain": the direction is
            // something the user chooses by moving, not an assumption.
            if (a.desiredWeightKg == null) setAnswer('desiredWeightKg', a.weightKg ?? BODY_DEFAULT_KG)
            goNext()
          }}
          onBack={goPrev}
          scroll
        >
          <DesiredWeightSection />
        </OnboardingScreen>
      )

    case 'provider':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Food recognition"
          subtitle="Optional — bring your own API key. Your photo goes to the provider you name and nowhere else; we run no server."
          ctaDisabled={!providerReady}
          disabledHint='Verify your key, or pick "No key for now"'
          onCta={goNext}
          onBack={goPrev}
          scroll
        >
          <ProviderSection onReadyChange={setProviderReady} />
        </OnboardingScreen>
      )

    case 'preferences': {
      const answered = a.rolloverCalories != null
      return (
        <StepScreen step={step} onBack={goPrev} onCta={goNext} ctaDisabled={!answered}>
          <PreferencesSection />
        </StepScreen>
      )
    }

    case 'health':
      return (
        <OnboardingScreen
          step={position}
          total={TOTAL_STEPS}
          title="Last thing"
          subtitle="Health sync is optional and iOS-only for now — or go straight to your plan."
          cta="See my plan"
          onCta={() => {
            // T5-fix2 (review nice-to-have 5): one tap = one push (plan.tsx's
            // busy-ref pattern; re-armed by the focus effect above).
            if (planNavBusy.current) return
            planNavBusy.current = true
            router.push('/onboarding/plan' as never)
          }}
          onBack={goPrev}
          scroll
        >
          <HealthSection />
        </OnboardingScreen>
      )
  }
}

/**
 * The grouped-option step shell: one focused question group with the shared
 * chrome and the grouped gate hint.
 */
function StepScreen({
  step,
  children,
  onBack,
  onCta,
  ctaDisabled,
}: {
  step: Step
  children: ReactNode
  onBack: () => void
  onCta: () => void
  ctaDisabled: boolean
}) {
  const titles: Record<string, string> = {
    sex: 'About you',
    activity: 'Your training',
    diet: 'How you eat',
    accomplish: 'Your focus',
    preferences: 'Preferences',
  }
  return (
    <OnboardingScreen
      step={stepIndex(step)}
      total={TOTAL_STEPS}
      title={titles[step] ?? 'About you'}
      ctaDisabled={ctaDisabled}
      disabledHint="Answer every question to continue"
      onCta={onCta}
      onBack={onBack}
      scroll
    >
      {children}
    </OnboardingScreen>
  )
}
