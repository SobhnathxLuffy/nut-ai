/**
 * The Android home-screen widget's snapshot serializer — schema v1.
 *
 * This is the JS half of the fixed contract with the native `NutaiWidgets`
 * module (T3-c-native): this module produces the EXACT JSON the native side
 * renders, and the native side publishes it to the widget surface. Native
 * calls `NutaiWidgets.publish(json)`; the JSON keys and order below are the
 * wire format — do not rename, retype, or reorder without bumping `v` and
 * agreeing the change with the native renderer.
 *
 * NODE-PURE, deliberately: zero expo/react-native imports so this runs in the
 * plain-Node vitest suite (same reasoning as date-utils.ts). The expo side —
 * the native-module seam, the debounce, the subscriptions — lives next door in
 * src/widgets/publish.ts, which wraps this serializer.
 *
 * Field semantics (where every number comes from — the functions Home/Train
 * themselves use, re-gathered in publish.ts `gatherAsyncSnapshot`):
 *
 *   v                  literal 1 (this schema).
 *   revision           monotonic per-process counter, persisted NOWHERE and
 *                      reset on app restart. Best-effort ordering only (e.g.
 *                      a native last-write tiebreak) — never a durable id.
 *   generatedAt        publish instant, ms epoch (`now` input).
 *   date               the local day the snapshot describes, YYYY-MM-DD.
 *   stale              build-time verdict. A live snapshot publishes false;
 *                      the reset sentinel publishes true (below). The shared
 *                      26h rule is `isStale` — the native renderer may apply
 *                      it itself against `generatedAt` at render time.
 *   kcalEaten          Math.round(DayTotals.kcal) — repo `dayTotals` (the same
 *                      derived read Home's ring renders). null when the totals
 *                      are unknown (post-reset), NEVER 0-for-unknown (§5.2).
 *   kcalRemaining      Math.round(target.kcal - totals.kcal) on the RAW
 *                      difference, carried SIGNED (negative = over; the native
 *                      side abs()es it, exactly like Home's hero card).
 *                      null when either the target or the totals are unknown.
 *   kcalOver           decided on the RAW remaining (< 0), pre-rounding, so a
 *                      fractional overshoot cannot flip by rounding — Home's
 *                      rule (index.tsx:375-376). false when there is no target.
 *   kcalTarget         Math.round(goal.targetKcal) or null — no goal row means
 *                      unknown; the widget shows its set-a-target state (§5.2).
 *   proteinG           Math.round(DayTotals.protein_g) or null.
 *   proteinTargetG     Math.round(goal.protein_g) or null.
 *   todayStatus        the day's completion string — repo `getDayStatus`
 *                      ('complete'|'partial'|'unknown'|'fasting'; 'unknown'
 *                      when no row), or the sentinel 'reset' below.
 *   nextWorkout*       today's training story from the training package's own
 *                      helpers (activeWorkout / programDayStatus — the same
 *                      derivation (tabs)/train.tsx renders): kind 'active' for
 *                      an unfinished workout, 'scheduled' for a program session
 *                      today, else all three fields null (rest days stay
 *                      silent; nothing is invented). `time` is null in v1 —
 *                      programs schedule whole days, the data model has no
 *                      session time-of-day, and a fabricated time would be a
 *                      lie on the home screen.
 *
 * Honesty note — pending scans: `dayTotals` already counts pending scans as
 * ZERO kcal and exposes `pendingCount`. The v1 schema is frozen (exact keys),
 * so pendingCount is carried in the input (the whole DayTotals passes through
 * `buildSnapshot`'s input type) but deliberately NOT serialized; the widget
 * shows completed totals, which are already honest. If v2 adds a pending
 * field, the plumbing is already here.
 */

import type { DayTotals } from './repo'
import { DEEP_LINK_ROUTES, DEEP_LINK_SCHEME } from '../navigation/deep-links'

export const WIDGET_SNAPSHOT_VERSION = 1

/**
 * A day snapshot goes stale once it is plausibly describing YESTERDAY: 24h of
 * wall clock plus a 2h margin for late-evening publishes. The native renderer
 * recomputes `(now - generatedAt) > WIDGET_STALE_AFTER_MS` at render time;
 * `isStale` is the shared definition.
 */
export const WIDGET_STALE_AFTER_MS = 26 * 60 * 60 * 1000

export function isStale(generatedAt: number, now: number): boolean {
  return now - generatedAt > WIDGET_STALE_AFTER_MS
}

export interface WidgetTargetInput {
  kcal: number
  proteinG: number
}

export interface WidgetNextWorkoutInput {
  /** Routine/workout name as Train renders it. */
  name: string
  /** Session time-of-day — always null in v1 (see header). Never fabricated. */
  time: string | null
  /** 'active' (unfinished workout) | 'scheduled' (program session today). */
  kind: string
}

export interface WidgetSnapshotInput {
  date: string
  /** repo `dayTotals` — null means unknown (post-reset), not zero. */
  totals: DayTotals | null
  /** The active goal's targets — null when no goal row exists yet. */
  target: WidgetTargetInput | null
  nextWorkout: WidgetNextWorkoutInput | null
  todayStatus: string
  /** Publish instant, ms epoch — becomes `generatedAt`. */
  now: number
  /** Sentinel override (the reset snapshot forces true). Default false. */
  stale?: boolean
}

/** The EXACT v1 wire object — keys and order are the contract with native. */
export interface WidgetSnapshotJson {
  v: number
  revision: number
  generatedAt: number
  date: string
  stale: boolean
  kcalEaten: number | null
  kcalRemaining: number | null
  kcalOver: boolean
  kcalTarget: number | null
  proteinG: number | null
  proteinTargetG: number | null
  todayStatus: string
  nextWorkoutName: string | null
  nextWorkoutTime: string | null
  nextWorkoutKind: string | null
}

let revisionCounter = 0

export function buildSnapshot(input: WidgetSnapshotInput): WidgetSnapshotJson {
  const kcalEaten = input.totals ? Math.round(input.totals.kcal) : null
  const proteinG = input.totals ? Math.round(input.totals.protein_g) : null
  const kcalTarget = input.target ? Math.round(input.target.kcal) : null
  const proteinTargetG = input.target ? Math.round(input.target.proteinG) : null
  // Over-ness on the RAW remaining (Home's rule), the transported value rounded
  // afterwards. `|| 0` only normalizes Math.round's -0 — real negatives survive.
  const rawRemaining =
    input.target != null && input.totals != null ? input.target.kcal - input.totals.kcal : null
  const kcalRemaining = rawRemaining == null ? null : Math.round(rawRemaining) || 0
  const kcalOver = rawRemaining != null && rawRemaining < 0
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    revision: ++revisionCounter,
    generatedAt: input.now,
    date: input.date,
    stale: input.stale ?? false,
    kcalEaten,
    kcalRemaining,
    kcalOver,
    kcalTarget,
    proteinG,
    proteinTargetG,
    todayStatus: input.todayStatus,
    nextWorkoutName: input.nextWorkout?.name ?? null,
    nextWorkoutTime: input.nextWorkout?.time ?? null,
    nextWorkoutKind: input.nextWorkout?.kind ?? null,
  }
}

/**
 * The post-reset sentinel (repo.ts `resetEverything`): every number NULL —
 * unknown ≠ zero, the wiped day's numbers must never linger on the widget —
 * with todayStatus 'reset' and stale true so the native side shows a blank /
 * reset state rather than presenting the snapshot as a fresh reading.
 */
export function buildResetSnapshot(date: string, now: number): WidgetSnapshotJson {
  return buildSnapshot({
    date,
    totals: null,
    target: null,
    nextWorkout: null,
    todayStatus: 'reset',
    now,
    stale: true,
  })
}

/**
 * The deep links the NATIVE widget rows open, validated against the real
 * deep-links map at module load (a missing alias fails here, loudly, instead
 * of shipping a dead tap). The native module carries the same five strings.
 */
function widgetDeepLink(alias: string): string {
  const entry = DEEP_LINK_ROUTES.find((r) => r.path === alias)
  if (!entry) throw new Error(`Widget deep link 'nutai://${alias}' is not in deep-links.ts`)
  return `${DEEP_LINK_SCHEME}://${entry.path}`
}

export const WIDGET_DEEP_LINKS = {
  home: widgetDeepLink('home'),
  log: widgetDeepLink('log'),
  scan: widgetDeepLink('scan'),
  train: widgetDeepLink('train'),
  weight: widgetDeepLink('weight'),
} as const
