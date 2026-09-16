import { Stack, router, useRootNavigationState, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import Storage from 'expo-sqlite/kv-store'
import { useEffect, useState } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider'

import { ONBOARDING_DONE_KEY } from '../src/onboarding/done-key'
export { ONBOARDING_DONE_KEY }

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

function Root() {
  const theme = useTheme()
  useOnboardingGate()

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
