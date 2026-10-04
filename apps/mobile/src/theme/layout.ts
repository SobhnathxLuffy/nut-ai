import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MIN_TAP_TARGET, space } from './tokens'

/**
 * Shared bottom-overlay metrics for the floating tab bar + FAB
 * (app/(tabs)/_layout.tsx) — Android release QA 2026-10.
 *
 * The tab bar is an absolute overlay (`position:'absolute', bottom:0`), so
 * every tab screen must pad its scroll content by the overlay's real height.
 * Screens used to hardcode 150/180px, which silently drifted out of sync with
 * the actual bar (gesture-nav vs 3-button-nav insets, font-scaled labels) and
 * let content slide underneath the bar and FAB.
 *
 * The row height mirrors the real composition in _layout.tsx: pillInner
 * minHeight MIN_TAP_TARGET + pill padding space.xs × 2, vs the 58pt FAB —
 * keep the two in sync when the tab bar changes.
 */
export const TAB_BAR_ROW_HEIGHT = Math.max(MIN_TAP_TARGET + space.xs * 2, 58)

/**
 * Bottom padding a (tabs) screen should apply to its scroll content so the
 * last element always clears the floating tab bar + FAB + Android navigation
 * bar (gesture pill or 3-button nav), with one breathing-gap of space.lg.
 */
export function useTabBarBottomInset(): number {
  const insets = useSafeAreaInsets()
  return TAB_BAR_ROW_HEIGHT + Math.max(insets.bottom, space.md) + space.lg
}
