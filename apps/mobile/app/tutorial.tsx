import { Tutorial } from '../src/tutorial/Tutorial'

/**
 * The post-onboarding walkthrough route (owner item #3).
 *
 * Deliberately registered with NO Stack options in the root layout: the
 * screen is always PUSHED above the tabs — once, automatically, by the
 * onboarding plan-reveal completion (plan.tsx), or on demand from the
 * Profile About group — so the native back gesture and Skip both pop to a
 * defined place. A modal presentation would add a second dismiss gesture the
 * walkthrough does not need, and a root-layout entry would widen the diff
 * across a file other agents are concurrent in.
 *
 * The restore path (onboarding/restore.tsx → finishRestore) never routes
 * here: a backup restore means the user already knows the app.
 */
export default function TutorialScreen() {
  return <Tutorial />
}
