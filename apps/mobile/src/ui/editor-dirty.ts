/**
 * The routine editor's dirty state, published for exits OUTSIDE the screen
 * (T5-fix2, review SHOULD-FIX #1).
 *
 * app/routines.tsx guards its own exits (hardware back, header close, Cancel,
 * row switch, Launch) with confirmDiscardThen — but a notification tap routed
 * by src/notifications/handler.ts navigates from OUTSIDE that tree and used to
 * dismiss a dirty editor with no confirm (§8.3: a silent discard of planned-set
 * work).
 *
 * This is deliberately the MINIMAL seam — a module-level boolean, not a store
 * or event bus. The editor mirrors its live dirty state every render; the tap
 * router consults it before navigating. The flag is true ONLY while the
 * routine editor holds unsaved work; every other state (other screens, a clean
 * editor, after unmount — the unmount cleanup lives in routines.tsx) reads
 * false, so deep links are never blocked from anywhere else. It lives in its
 * own module (not in routines.tsx) so the handler does not have to import a
 * full screen module, and so tests can mock it in isolation.
 */

let dirty = false

/** The editor's per-render publish point (routines.tsx). */
export function setRoutineEditorDirty(next: boolean): void {
  dirty = next
}

/** The consult point for navigations that originate outside the editor. */
export function isRoutineEditorDirty(): boolean {
  return dirty
}
