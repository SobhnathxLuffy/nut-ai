import { GroupedOptionScreen, questionGroup } from '../../src/components/onboarding/OptionScreen'

/**
 * Diet + blocker — merged (UI/UX report Ch. 8.1).
 *
 * Both questions are about HOW you eat and what gets in the way, and both have
 * real consumers (see store.ts):
 *
 *   dietStyle  -> RESOLVER BIAS. A vegan's scan should not resolve to a beef
 *                 row, and the oil/milk assumption-filler defaults change with
 *                 the diet. The most functional answer in the whole flow.
 *   blocker    -> which retention surfaces default ON (featureDefaultsFor).
 *
 * Merging them keeps the flow at twelve without losing either field.
 */
export default function DietScreen() {
  return (
    <GroupedOptionScreen
      step="diet"
      title="How you eat"
      subtitle="Your diet shapes which food matches rank first; your main obstacle decides which helpful parts of the app switch on."
      scroll
      groups={[
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
      ]}
    />
  )
}
