import { GroupedOptionScreen, questionGroup, yesNoGroup } from '../../src/components/onboarding/OptionScreen'

/**
 * Activity — the merged card-group screen (UI/UX report Ch. 8.1: "sex and
 * workouts merged into one activity card group").
 *
 * Three questions, three groups, ONE Continue. The old flow asked these as
 * three separate screens with one question each; none of them is worth a
 * dedicated screen on its own, and grouping them keeps the flow at twelve.
 *
 * `professional` is folded in here too: its field IS consumed (the plan reveal
 * turns on the shareable-export bullet and suppresses coaching nudges — see
 * persistOnboarding), so the question survives the merge rather than being cut
 * with the motivational interstitials. A personal trainer sits naturally with
 * the activity questions.
 */
export default function ActivityScreen() {
  return (
    <GroupedOptionScreen
      step="activity"
      title="A few questions about you"
      subtitle="Three quick answers set the math your plan is built on."
      scroll
      groups={[
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
      ]}
    />
  )
}
