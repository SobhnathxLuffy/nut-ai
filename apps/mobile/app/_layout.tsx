import { Stack, router, useRootNavigationState, useSegments, type ErrorBoundaryProps } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import Storage from 'expo-sqlite/kv-store'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider'
import { space, type as typeScale } from '../src/theme/tokens'
import { Button } from '../src/components/Screen'
import { Toast } from '../src/components/Toast'

// WEB-001: patches Alert.alert with a real dialog on web. Must be imported
// before any screen module so every Alert.alert call site gets the patch.
import '../src/ui/alert-web'

import { ONBOARDING_DONE_KEY } from '../src/onboarding/done-key'
import { initNotifications } from '../src/notifications/handler'
import { installWidgetPublishers } from '../src/widgets/publish'
/**
 * The entry gate.
 *
 * Onboarding runs once. The flag is written when the plan screen is dismissed,
 * and lives in the same SQLite-backed store as everything else rather than
 * introducing a second storage mechanism — one place for local state is one place
 * to export, wipe, and reason about.
 */
function useOnboardingGate() {
  const navState = useRootNavigationState()
  const segments = useSegments()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Navigating before the root navigator has mounted throws.
    if (!navState?.key || checked) return
    let alive = true
    void (async () => {
      const done = await Storage.getItem(ONBOARDING_DONE_KEY)
      if (!alive) return
      setChecked(true)
      const inOnboarding = segments[0] === 'onboarding'
      if (done !== 'true' && !inOnboarding) {
        router.replace('/onboarding')
      }
    })()
    return () => {
      alive = false
    }
  }, [navState?.key, segments, checked])
}

/**
 * Root error boundary (expo-router contract: export `ErrorBoundary` from the
 * root layout). Catches any render crash in the navigator — e.g. a corrupt DB
 * row throwing during a screen's render — and offers recovery instead of a
 * white screen. The boundary renders inside ThemeProvider, so useTheme works.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useTheme()
  // Re-render the crashed route first (retry clears the boundary state and
  // remounts the navigator), then head to the Home tab once it is mounted.
  const goHome = () => {
    void retry().then(() => router.replace('/(tabs)' as never))
  }
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.xl,
        gap: space.md,
      }}
    >
      <Text style={{ ...typeScale.title, color: t.text }}>Something went wrong</Text>
      <Text style={{ ...typeScale.body, color: t.textMuted, textAlign: 'center' }}>
        The app hit an unexpected error. Your data is safe on this device.
      </Text>
      {error?.message ? (
        <Text
          numberOfLines={4}
          style={{ ...typeScale.caption, color: t.textFaint, textAlign: 'center' }}
        >
          {error.message}
        </Text>
      ) : null}
      <View style={{ gap: space.sm, alignSelf: 'stretch', marginTop: space.sm }}>
        <Button label="Try again" onPress={() => void retry()} />
        <Button label="Go home" onPress={goHome} />
      </View>
    </View>
  )
}

function Root() {
  const theme = useTheme()
  useOnboardingGate()

  useEffect(() => {
    // Task 3-b: install the notification handler, tap routing and schedule
    // re-sync ONCE. This requests NO permission and does nothing while
    // onboarding runs — see src/notifications/handler.ts for the contract.
    initNotifications()
  }, [])

  useEffect(() => {
    // Task 3-c (home-screen widget): food/workout mutations coalesce into one
    // debounced widget publish; AppState 'active' self-heals paths that emit
    // no events (backup restore, raw undo). Without the native module (web,
    // Expo Go, prebuild not yet run) everything is a silent no-op. The return
    // value is the publisher's unsubscribe — the effect's cleanup.
    return installWidgetPublishers()
  }, [])

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        {/* Full-screen flows are native modals: swipe-to-dismiss on iOS. */}
        <Stack.Screen name="camera" options={{ presentation: 'modal' }} />
        <Stack.Screen name="result" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-weight" options={{ presentation: 'modal' }} />
        <Stack.Screen name="provider-settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-exercise" options={{ presentation: 'modal' }} />
        <Stack.Screen name="food-search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="food-review" options={{ presentation: 'modal' }} />
        <Stack.Screen name="meal-detail" options={{ presentation: 'modal' }} />
        <Stack.Screen name="saved-foods" options={{ presentation: 'modal' }} />
        <Stack.Screen name="recipes" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-goals" options={{ presentation: 'modal' }} />
        <Stack.Screen name="workout" options={{ presentation: 'modal' }} />
        <Stack.Screen name="equipment" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routines" options={{ presentation: 'modal' }} />
        <Stack.Screen name="programs" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="exercise-detail" options={{ presentation: 'modal' }} />
        <Stack.Screen name="weekly-report" options={{ presentation: 'modal' }} />
        <Stack.Screen name="monthly-report" options={{ presentation: 'modal' }} />
        <Stack.Screen name="custom-food" options={{ presentation: 'modal' }} />
      </Stack>
      {/* UI/UX report §10.1 (Wave 1b): the ONE toast host, mounted at the root
          so a toast survives any navigation — the meal-logged Undo must stay
          tappable after the result screen dismisses itself. */}
      <Toast />
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Root />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
