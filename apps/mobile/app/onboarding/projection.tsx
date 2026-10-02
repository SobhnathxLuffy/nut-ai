import { router } from 'expo-router'
import { ProjectionChart } from '../../src/components/onboarding/Charts'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { inferredGoal, useAnswers } from '../../src/onboarding/store'

/**
 * Projection — trend + potential FUSED (UI/UX report Ch. 8.1: "one
 * consolidated projection screen (trend and potential fused into a single
 * chart moment)").
 *
 * Two old screens, each carrying one chart and a Continue. Both moments are now
 * ONE chart: the with/without-plan comparison and the early-consistency
 * milestones live on the same timeline (see ProjectionChart). The curve follows
 * the user's actual goal direction rather than always sloping the same way, so
 * a gaining user is not shown a losing chart.
 */
export default function ProjectionScreen() {
  const a = useAnswers()
  return (
    <OnboardingScreen
      step={stepIndex('projection')}
      total={TOTAL_STEPS}
      title="Where this goes"
      onCta={() => router.push(nextRoute('projection') as never)}
      scroll
    >
      <ProjectionChart gaining={inferredGoal(a) === 'gain'} />
    </OnboardingScreen>
  )
}
