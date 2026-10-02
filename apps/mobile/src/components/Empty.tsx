import { Text, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Button } from './Screen'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'

/**
 * The Empty primitive — UI/UX Transformation Report Ch. 6.3 / Table 10.1
 * (Wave 1c).
 *
 * "Empty and error states across all 52 screens get the Empty primitive with
 * an icon, which is where the set stops being decoration and starts being
 * navigation." An empty list is never dead space: an icon says WHAT is empty,
 * the message says what will fill it, and the action is the create-first
 * next step — one obvious primary action, per AGENTS §8.1.
 *
 * The action rides the shared Button from Screen.tsx, so empty states can
 * never grow a private button dialect. `pressEmptyAction` is the same
 * testable-dispatch trick toast-store uses for its action button.
 */

export interface EmptyAction {
  /** Short verb: "New recipe", "Create routine", "Log food". */
  label: string
  onPress: () => void
}

export interface EmptyProps {
  icon: IconName
  title: string
  message?: string
  action?: EmptyAction
}

/**
 * Fires the empty state's action. Exported so the dispatch path is unit
 * testable in the plain-Node vitest environment (mirrors pressToastAction).
 */
export function pressEmptyAction(action: EmptyAction | undefined): void {
  if (!action) return
  action.onPress()
}

export function Empty({ icon, title, message, action }: EmptyProps) {
  const t = useTheme()
  return (
    <View
      style={{
        alignItems: 'center',
        // Ch. 6.3: an empty state is a resting place, not an error — generous
        // vertical breathing room around the glyph.
        paddingVertical: space.xxxl,
        paddingHorizontal: space.xl,
        gap: space.md,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          backgroundColor: t.bgSunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={24} color={t.textFaint} />
      </View>
      <Text style={[type.heading, { color: t.text, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[type.body, { color: t.textMuted, textAlign: 'center', lineHeight: 22 }]}>{message}</Text>
      ) : null}
      {action ? <Button label={action.label} selected onPress={() => pressEmptyAction(action)} /> : null}
    </View>
  )
}
