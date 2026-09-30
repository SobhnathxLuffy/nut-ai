import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

/**
 * Web dirty-guard (QA P2-15 + P3-47).
 *
 * Five edit screens (custom-food, recipes, routines, search, exercise-detail)
 * protect unsaved work with BackHandler 'hardwareBackPress' — an Android-only
 * affordance. On the web build the browser's back button and reload silently
 * bypassed them and destroyed the user's edits.
 *
 * While `active`, the browser's own leave-confirmation (beforeunload) covers
 * reload and tab close.
 *
 * The in-page browser BACK button needs a different strategy: expo-router's
 * web fork handles popstate by dispatching `getActionFromState(...)` — a
 * NAVIGATE action — and react-navigation never fires `beforeRemove` for
 * NAVIGATE, so there is no sanctioned interception point (a raw popstate
 * listener loses the race: the router navigates first and overwrites any URL
 * restore). Screens that hold long-lived typed work therefore persist a
 * draft instead of trying to warn: see custom-food's sessionStorage draft,
 * which makes the loss impossible rather than announced.
 *
 * Native platforms are a no-op: BackHandler already owns this job there.
 */
export function useWebDirtyGuard(active: boolean): void {
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!activeRef.current) return
      event.preventDefault()
      // Chrome only shows the dialog when returnValue is set.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
}
