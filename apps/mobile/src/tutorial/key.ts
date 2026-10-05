import Storage from 'expo-sqlite/kv-store'

/**
 * The post-onboarding walkthrough's seen marker — the third kv-store key in
 * the app, sharing the ONE storage mechanism with ONBOARDING_DONE_KEY and
 * ONBOARDING_DRAFT_KEY (one place for local state to export, wipe, reason
 * about). It lives in its own module for the same reason done-key.ts does:
 * plan.tsx (launch), repo.ts (reset) and Tutorial.tsx (dismiss) all need it
 * without importing each other's worlds.
 */
export const TUTORIAL_SEEN_KEY = 'tutorial.seen.v1'

/**
 * The auto-launch policy. The walkthrough shows ONCE, automatically, and
 * only on a FRESH onboarding completion — never on a plain launch, never
 * after a backup restore (restoring users already know the app), and never
 * re-armed by a replay (a replay marks seen; it never un-marks).
 *
 * The launch SITE is structural: only the plan reveal's completion flow ever
 * asks this, so the flag is the durable record that the tour was shown or
 * deliberately dismissed. A corrupt value is not a "seen" — showing a
 * skippable tour once more is the smaller failure than never showing it.
 */
export function shouldAutoShowTutorial(seen: string | null): boolean {
  return seen !== 'true'
}

export async function readTutorialSeen(): Promise<string | null> {
  return Storage.getItem(TUTORIAL_SEEN_KEY)
}

export async function markTutorialSeen(): Promise<void> {
  await Storage.setItem(TUTORIAL_SEEN_KEY, 'true')
}
