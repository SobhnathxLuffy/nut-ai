import type { WeightUnit } from '@nutai/analytics'
// Type-only imports: this module stays NODE-PURE (no react-native in its
// runtime graph), so the vitest node suite can exercise the group contract
// and the value formatters directly (the wave3-profile test does).
import type { CurrentGoal } from '../data/repo'
import type { IconName } from '../components/Icon'

/**
 * The Profile tab's grouped-list architecture — UI/UX report Ch 8.8 (Wave 3):
 * "iOS grouped-list architecture with sub-pages… Each settings row uses the
 * Item primitive: icon, label, current value in muted text, chevron."
 *
 * This module is the STRUCTURE as data: the five report groups (plus the
 * Diagnostics group the same chapter adds), each row's identity and its
 * sub-page route. Live values are computed by the screen (it owns the reads);
 * the formatters here turn those reads into the muted value strings.
 *
 * The contract pinned by test:
 *   - every row routes (a chevron row — no dead display rows at this level);
 *   - every power option is reachable: profile row → sub-page → control, i.e.
 *     at most two taps from this tab;
 *   - the report's groups all exist: Goals / AI Provider / Units & Health /
 *     Data ("Your data", the e2e-pinned title) / About — plus Diagnostics.
 */

export interface ProfileRowDef {
  key: string
  icon: IconName
  label: string
  /** Sub-page route; pressing the row navigates here (with a selection haptic). */
  route: string
}

export interface ProfileGroupDef {
  key: string
  title: string
  rows: readonly ProfileRowDef[]
}

export const PROFILE_GROUPS: readonly ProfileGroupDef[] = [
  {
    key: 'goals',
    title: 'Goals',
    rows: [
      { key: 'goals', icon: 'flame', label: 'Goals', route: '/edit-goals' },
      { key: 'log-weight', icon: 'scale', label: 'Log weight', route: '/log-weight' },
    ],
  },
  {
    key: 'provider',
    title: 'AI provider',
    rows: [
      { key: 'provider', icon: 'sparkles', label: 'Provider & key', route: '/provider-settings' },
    ],
  },
  {
    key: 'units',
    title: 'Units & health',
    rows: [
      {
        key: 'units',
        icon: 'scaleBalance',
        label: 'Units & health',
        route: '/settings-units-health',
      },
      {
        // Task 3-b: local notification preferences (reminders + rest timer).
        // Same app-preferences family as units/haptics; the screen itself
        // owns the honest permission and per-category switches.
        key: 'notifications',
        icon: 'clock',
        label: 'Notifications',
        route: '/notification-settings',
      },
    ],
  },
  {
    // "Your data" — the title the e2e suite pins on this tab; the report's
    // "Data" group under its shipped name.
    key: 'data',
    title: 'Your data',
    rows: [
      {
        key: 'data',
        icon: 'receipt',
        label: 'Export, import & erase',
        route: '/settings-data',
      },
    ],
  },
  {
    key: 'about',
    title: 'About',
    rows: [
      {
        // Ch 8.8: "How food & dish data works" stays reachable — About group,
        // one tap, unchanged destination.
        key: 'data-methods',
        icon: 'bowl',
        label: 'How food & dish data works',
        route: '/data-methods',
      },
      {
        // The optional post-onboarding walkthrough (owner item #3) — replay
        // entry. Shown once automatically at onboarding completion; this row
        // is the only other way in.
        key: 'tutorial',
        icon: 'bookOpen',
        label: 'Replay the tutorial',
        route: '/tutorial',
      },
      { key: 'about', icon: 'heart', label: 'About Nut AI', route: '/settings-about' },
    ],
  },
  {
    key: 'diagnostics',
    title: 'Diagnostics',
    rows: [
      {
        key: 'diagnostics',
        icon: 'target',
        label: 'Diagnostics',
        route: '/diagnostics',
      },
    ],
  },
]

/** Every route the grouped list can navigate to, flattened. */
export function profileRoutes(groups: readonly ProfileGroupDef[] = PROFILE_GROUPS): string[] {
  return groups.flatMap((g) => g.rows.map((r) => r.route))
}

/** "2,487" — en-US grouping, the copy locale the app's numbers already use. */
export function groupDigits(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * The Goals row's muted value, e.g. "2,487 kcal · maintain" (the report's own
 * example). Adaptive state rides along only when it is on — silence is the
 * honest form of "off".
 */
export function formatGoalsValue(goal: CurrentGoal | null): string {
  if (!goal) return 'Not set yet'
  const parts = [`${groupDigits(Math.round(goal.targetKcal))} kcal · ${goal.goalType}`]
  if (goal.adaptive) parts.push('adaptive')
  return parts.join(' · ')
}

const LB_PER_KG = 2.2046226218

/** The Log weight row's muted value — the newest entry, shown in the display unit. */
export function formatWeightValue(lastKg: number | null, unit: WeightUnit): string {
  if (lastKg == null) return 'No entries yet'
  if (unit === 'lb') return `${(lastKg * LB_PER_KG).toFixed(1)} lb`
  return `${lastKg.toFixed(1)} kg`
}

/**
 * The AI provider row's muted value, e.g. "OpenAI · sk-…bdcd" — provider name
 * plus masked key, exactly the disclosure the old screen showed inline.
 */
export function formatProviderValue(providerLabel: string, keyMask: string | null): string {
  if (!keyMask) return providerLabel
  return `${providerLabel} · ${keyMask}`
}

/**
 * The Diagnostics row's muted value — provider and gateway host, never the raw
 * model id: Ch 8.8's "done when" keeps model identifiers INSIDE the
 * diagnostics page, so this row points at them without printing one.
 */
export function formatDiagnosticsValue(providerLabel: string | null, host: string | null): string {
  if (!providerLabel) return 'Not connected'
  return host ? `${providerLabel} · ${host}` : providerLabel
}
