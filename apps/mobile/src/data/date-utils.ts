/**
 * Local-date and meal-slot helpers.
 *
 * ZERO React Native imports, deliberately — same reasoning as backup-core.ts.
 * repo.ts re-exports these for its existing callers; manual-food.ts imports
 * them from here directly rather than from repo.ts, so it never pulls in
 * repo.ts's `expo-sqlite`/`../db/expo-adapter` imports and can run under bare
 * Node in the test suite.
 */

export function localDate(ms: number): string {
  // Local, not UTC. An 11pm meal must not migrate to tomorrow, and a user who
  // flies must not have yesterday's log rewritten under them.
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local hour → slot. Deterministic, editable later; never inferred by a model. */
export function slotFor(ms: number): string {
  const h = new Date(ms).getHours()
  if (h < 11) return 'breakfast'
  if (h < 16) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

/** Returns an array of local dates for "This Week" (Monday to Sunday) containing `ms` */
export function getThisWeek(ms: number): string[] {
  const d = new Date(ms)
  const dayOfWeek = d.getDay()
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)

  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    dates.push(localDate(cur.getTime()))
  }
  return dates
}

/** Returns an array of local dates for "Last Week" (the Monday to Sunday preceding `ms`'s week) */
export function getLastWeek(ms: number): string[] {
  const d = new Date(ms)
  const dayOfWeek = d.getDay()
  const diffToLastMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) - 7

  const lastMonday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToLastMonday)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const cur = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + i)
    dates.push(localDate(cur.getTime()))
  }
  return dates
}
