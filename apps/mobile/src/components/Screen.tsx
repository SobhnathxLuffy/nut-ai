import { router } from 'expo-router'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space } from '../theme/tokens'

/**
 * Reusable screen wrapper with safe areas, scrolling, and consistent header.
 */
export function Screen({
  title,
  children,
  back = false,
  backLabel = 'Done',
}: {
  title: string
  children: React.ReactNode
  back?: boolean
  backLabel?: string
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        padding: space.lg + 4,
        paddingTop: insets.top + space.lg,
        paddingBottom: 180,
        gap: space.md + 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 30, fontWeight: '700', color: t.text, flex: 1 }}
        >
          {title}
        </Text>
        {back && <Button label={backLabel} onPress={() => router.back()} />}
      </View>
      {children}
    </ScrollView>
  )
}

/** Body text label — muted variant for secondary info. */
export function Label({
  children,
  muted = false,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  const t = useTheme()
  return (
    <Text style={{ color: muted ? t.textMuted : t.text, fontSize: 16, lineHeight: 23 }}>
      {children}
    </Text>
  )
}

/** Card container with elevation and border. */
export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme()
  return (
    <View
      style={{
        padding: space.lg,
        gap: space.md,
        borderRadius: radius.xl,
        backgroundColor: t.bgElevated,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      {children}
    </View>
  )
}

/** Standard button with selected and disabled states. */
export function Button({
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  selected?: boolean
}) {
  const t = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: radius.md + 2,
        backgroundColor: selected ? t.text : t.bgSunken,
        opacity: disabled ? 0.5 : 1,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: selected ? t.bg : t.text,
          fontSize: 15,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** Text input with label. */
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const t = useTheme()
  return (
    <View style={{ gap: 4, flexGrow: 1 }}>
      <Label muted>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.textFaint}
        {...props}
        style={[
          {
            color: t.text,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: radius.md,
            minHeight: 48,
            padding: space.md,
            fontSize: 17,
          },
          props.style,
        ]}
      />
    </View>
  )
}

/** Horizontal flex row with wrapping. */
export function Row({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
      {children}
    </View>
  )
}

/**
 * Hook for async actions with loading/error state and automatic refresh.
 */
export function useAction(refresh?: () => Promise<void>) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isBusyRef = useRef(false)

  async function run(action: () => Promise<unknown>) {
    if (isBusyRef.current) return
    isBusyRef.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      isBusyRef.current = false
      setBusy(false)
    }
  }

  return {
    run,
    error,
    busy,
    feedback: (
      <>
        {busy && <ActivityIndicator accessibilityLabel="Saving" />}
        {!!error && (
          <View style={{ gap: 8, paddingVertical: 4 }}>
            <Text accessibilityRole="alert" style={{ fontSize: 15, color: '#ef4444' }}>
              {error}
            </Text>
            {refresh && (
              <Button label="Retry" selected onPress={() => void run(refresh)} />
            )}
          </View>
        )}
      </>
    ),
  }
}
