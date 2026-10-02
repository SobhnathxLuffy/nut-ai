/**
 * Pure derivations for the Home instrument (UI/UX report §8.2 — "Home: an
 * instrument, not a dashboard", Wave 3).
 *
 * ZERO React Native imports, deliberately — the same discipline as
 * date-utils.ts / toast-store.ts: these functions run under bare Node in the
 * vitest suite, so the state machine, the slot-guide arithmetic and the
 * strip flags are pinned by real unit tests, not source sweeps.
 *
 * Honesty notes the report demands:
 *   - The slot guide is an EXPLICIT even split (a quarter of the day per
 *     meal). The app stores NO per-slot budget anywhere — no screen asks for
 *     one, no table holds one — so the guide is labelled as a guide in the UI
 *     and derived from exactly two real numbers: the day's target and what
 *     was actually logged in each slot.
 *   - The adaptive-target state machine derives ONLY from data the goal row
 *     actually carries: the `adaptive` flag, the `accepted_at` stamp inside
 *     `adaptive_evidence_json` (written exclusively by an accepted weekly
 *     check-in), and the transient `surfaced` flag the estimator path can
 *     set. No state is fabricated.
 */

// ---------------------------------------------------------------------------
// Meal-slot guide (hero ring press-for-detail)
// ---------------------------------------------------------------------------

export const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealSlot = (typeof SLOT_ORDER)[number]

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
}

/**
 * The share of the daily target one slot's guide is built from. An even
 * quarter — deliberately NOT four hand-picked percentages, which would read
 * like stored data the app does not have.
 */
export const SLOT_GUIDE_SHARE = 1 / SLOT_ORDER.length

export interface SlotGuideRow {
  slot: MealSlot
  label: string
  /** Real data: kcal logged in this slot today (rounded). */
  loggedKcal: number
  /** Target × share − logged. Negative = the slot ran past its guide. */
  guideLeftKcal: number
  /** True when the slot is over its guide — stated, never scolded. */
  over: boolean
}

/**
 * Remaining-by-meal-slot derivation for the hero ring's press-for-detail
 * expansion. Keys the DB does not know (or logged under a null slot) are
 * ignored here — they still count in the day totals; the caller surfaces
 * them separately as "unsorted" so no kcal silently vanishes.
 */
export function slotGuide(targetKcal: number, loggedBySlot: Record<string, number>): SlotGuideRow[] {
  return SLOT_ORDER.map((slot) => {
    const logged = Math.max(0, loggedBySlot[slot] ?? 0)
    const guideLeft = targetKcal * SLOT_GUIDE_SHARE - logged
    return {
      slot,
      label: SLOT_LABELS[slot],
      loggedKcal: Math.round(logged),
      guideLeftKcal: Math.round(guideLeft),
      over: guideLeft < 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Adaptive-target state machine
// ---------------------------------------------------------------------------

export type AdaptiveTargetState = 'fixed' | 'locked' | 'adjusting' | 'stable'

/**
 * How long an accepted check-in holds the target — mirrors the estimator's
 * own 7-day cooldown in src/data/checkin.ts (reviewCheckin's `cooldown`), the
 * window during which no new suggestion is even computed.
 */
export const CHECKIN_LOCK_MS = 7 * 86_400_000

export interface AdaptiveTargetInput {
  /** goals.adaptive — 1 when the target is meant to follow the user's trend. */
  adaptive: boolean
  /**
   * `accepted_at` from the CURRENT goal row's adaptive_evidence_json — set
   * only by an accepted weekly check-in. Null when the row was written by
   * onboarding, a hand override, or a backup import.
   */
  checkinAcceptedAt: number | null
  /** runAdaptive surfaced a change this focus (the estimator's own gates). */
  surfaced: boolean
  now: number
}

export interface AdaptiveTargetContext {
  /** runAdaptive's reason string (its stub ships a calm one). */
  reason?: string
  /** Explanation riding a surfaced change. */
  explanation?: string
  /** The new target a surfaced change wrote. */
  newKcal?: number | null
}

export interface AdaptiveTargetView {
  state: AdaptiveTargetState
  /**
   * ONE calm line, MacroFactor-style. Never a warning tone — the report's
   * words: "its copy stops reading like a warning".
   */
  detail: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Deterministic short date ("Aug 12") — no locale dependency, test-stable. */
export function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/**
 * The three derivable card states (plus the estimator's transient one):
 *
 *   fixed     — goal.adaptive is 0: a hand-set target, left alone.
 *   locked    — the current target was WRITTEN by an accepted check-in and
 *               that acceptance is still inside the 7-day cooldown.
 *   adjusting — the estimator surfaced a change THIS focus. Wired and
 *               honest, but runAdaptive currently never surfaces (targets
 *               move only through user-accepted check-ins), so live users
 *               see the other states.
 *   stable    — adaptive target, steady: learning, changes only on an
 *               accepted check-in.
 */
export function adaptiveTargetView(
  input: AdaptiveTargetInput,
  context: AdaptiveTargetContext = {},
): AdaptiveTargetView {
  if (input.surfaced) {
    const to = Math.round(context.newKcal ?? 0)
    const why = context.explanation?.trim()
    return {
      state: 'adjusting',
      detail: why
        ? `Adjusted to ${to} kcal. ${why}`
        : `Adjusted to ${to} kcal, from your own trend and intake.`,
    }
  }
  if (!input.adaptive) {
    return {
      state: 'fixed',
      detail: 'You set this by hand, so it stays exactly where you put it.',
    }
  }
  const accepted = input.checkinAcceptedAt
  if (accepted !== null && input.now - accepted < CHECKIN_LOCK_MS) {
    const until = shortDate(accepted + CHECKIN_LOCK_MS)
    return {
      state: 'locked',
      detail: `Set by your check-in on ${shortDate(accepted)}. It holds until ${until}, so the trend has time to show.`,
    }
  }
  return {
    state: 'stable',
    detail:
      context.reason?.trim() ||
      'Steady. It learns from your logged days and weigh-ins, and changes only when you accept a check-in.',
  }
}

// ---------------------------------------------------------------------------
// Day strip (today-pulse / future-dimmed)
// ---------------------------------------------------------------------------

export interface DayStripFlags {
  /** The strip's live "you are here" marker — pulse dot, never the selected style. */
  today: boolean
  /** Days after today — rendered dimmed and disabled. */
  future: boolean
}

export function dayStripFlags(offset: number): DayStripFlags {
  return { today: offset === 0, future: offset > 0 }
}

/**
 * The 56 strip offsets: 8 Monday-first weeks, ending inside the week that
 * contains today. Days after today exist (the current week renders whole)
 * and are future-dimmed; the scroll lands on the end so today is visible.
 */
export function dayStripOffsets(now: Date): number[] {
  const dow = (now.getDay() + 6) % 7
  return Array.from({ length: 56 }, (_, i) => i - dow - 49)
}

// ---------------------------------------------------------------------------
// Check-in evidence parsing
// ---------------------------------------------------------------------------

/**
 * `accepted_at` from a goals row's adaptive_evidence_json, or null for
 * anything unparseable. Pure so repo.currentGoal can lean on it while the
 * tests pin the malformed-input behaviour.
 */
export function parseCheckinAcceptedAt(json: string | null | undefined): number | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { accepted_at?: unknown }
    return typeof parsed.accepted_at === 'number' ? parsed.accepted_at : null
  } catch {
    return null
  }
}
