# Section C — P1 fixes (verified 2026-09-27)

The Section-C report listed twelve P1 findings. Each was re-verified against
current main **before** any code changed, because the report had been produced
against a build that predated the WEB-001…011 and Section-B rounds. Verdict:
seven were already closed; five were real and are closed here. Every verdict
below is backed by code inspection, an automated gate, or a Playwright run.

## Already fixed on main before this round

| Bug | Verdict | Evidence |
|---|---|---|
| P1-1 · Alert.alert silent no-op on web (28 call sites) | FIXED (earlier round) | `src/ui/alert-web.ts` patches `Alert.alert` with a themed queued dialog on web; imported first in `app/_layout.tsx`. The `resetEverything()` chain in `(tabs)/profile.tsx` has `.catch`. e2e `restore journey` drives the shimmed confirm dialog end to end. |
| P1-2 · Custom-food save failures invisible; duplicates unprotected | FIXED (earlier round) | Save failures route through `Alert.alert` (real on web via the shim); `createCustomFood` throws `A custom food with this name already exists` (`custom-foods.ts:105-107`). e2e: duplicate save shows the dialog; missing-calorie save shows `Check this food`. |
| P1-3 · Backup import non-functional on web | FIXED (earlier round) | `pickBackupFile` uses `expo-document-picker` (web-supported) with a fetch-based web read path; Profile → Import data and onboarding/restore both call it. e2e: `waitForEvent('filechooser')` fires and a v1-format backup restores into the tabs. |
| P1-7 · Double-tap Repeat logs duplicates | FIXED (earlier round) | Repeat goes through `useAction.run`, whose synchronous `isBusyRef.current` guard rejects re-entry before React re-renders (`src/components/Screen.tsx:180-183`), plus `disabled={action.busy}`. |
| P1-10 · serve-coop.py 404s on deep refresh | FIXED (commit 1e952bf) | `do_GET` falls back to `/index.html` for missing paths; Playwright's webServer drives deep routes (`/indian-dishes`, `/food-review?...`) through this script every run. |
| P1-11 · Web keys in sessionStorage | FIXED (WEB-006) | `credentials.web.ts` stores keys in `localStorage` with a one-time sessionStorage promotion and dual-store clear. |
| P1-12 · user.db in localStorage (kvvfs, ~5 MB ceiling) | FIXED (WEB-005) | `expo-adapter.web.ts` opens the user DB on the OPFS VFS with a guarded one-time migration from the legacy localStorage store. |

## Fixed this round

### P1-4 · Recipe save false-rejects "Every ingredient needs a name and source ID"

Root cause chain, deeper than the report's suspect: `findIngredient` rendered
the resolver's confident single match (`auto_accept`) as a candidate row that
had to be tapped a second time; nothing told the user the match was not yet
applied, so `ingredient.foodId` stayed empty and Save rejected. Worse,
`chooseIngredient` ran under `void` with no catch, so a failed lookup died
silently.

Fix (`app/recipes.tsx`):
- A single candidate is applied immediately; multiple candidates still list.
- `chooseIngredient` is fully try/caught with visible errors.
- Save now names the exact ingredient: `"<name>" (ingredient N) has no
  nutrition source — tap Find nutrition, or set its Source ID under Nutrition
  details`.

### P1-5 · Raw zod error JSON rendered inside the workout UI

`String(err)` on a `ZodError` renders the whole issue array. New dependency-
free mapper `src/data/workout-errors.ts` (`friendlySetValueError`) turns
issues into field-level sentences — float reps → `Reps must be a whole number
(like 8, not 8.5)`, out-of-range → `RPE must be 10 or less` — wired into every
set/notes catch site in `app/workout.tsx` and reused by `app/programs.tsx`
(so `ProgramInput.parse` can never spray JSON either). Draft semantics
unchanged: the invalid text stays in its field, nothing is written.

### P1-6 · Free-text dates accept impossible dates; missing date is hostile

- Shared strict validator `isValidLocalDate` (`src/data/date-utils.ts`):
  shape + parse + component round-trip, so `2026-02-30`, `2026-13-01` and
  `not-a-date` all fail everywhere.
- `decodeFoodReview` no longer throws on a missing/invalid date — it degrades
  to an empty date so the review screen renders. The screen defaults to
  today, validates live (inline message + Save disabled), and still surfaces
  honest errors from the data layer. Genuinely corrupt payloads (bad serving
  info) keep the explicit error card — that part was correct.
- `meal-detail.tsx` and `programs.tsx` use the same validator.

### P1-8 · Indian dishes browser hard-capped at 100

`app/indian-dishes.tsx` capped both the corpus and user-DB queries (and the
merged list) at 100 of 362 identities. Raised to a 500 ceiling (corpus +
household variants); the header now reports the real count
("Showing 3xx dishes" asserted by e2e).

### P1-9 · Dish composer shows raw source IDs

KB ingredient slots resolve to `ifct:A019` / `usda:<fdcId>`; the composer
showed those strings verbatim. The load loop now captures the resolved food's
name — IFCT-mapped slots from `ifct.db`, USDA-mapped slots from the nutrition
corpus — and renders `Resolved: <food name>` (the raw ID remains only as a
last-resort fallback for unmapped ids). Candidate picks and manual edits keep
the field consistent.

## Regression locks added

- `src/data/workout-errors.test.ts` — 6 tests pinning the friendly mapper
  (float reps, range bounds, multi-issue, stringified-zod defense).
- `src/data/date-utils.test.ts` — strict date validator cases.
- `src/data/food-review.test.ts` — decode contract: bad dates degrade instead
  of failing; corrupt serving info still rejects.
- `e2e/p1-regression.spec.ts` — 6 journeys: restore (P1-1/P1-3), review date
  recovery + live validation (P1-6), custom-food duplicate and validation
  dialogs (P1-2), full dish KB + composer name resolution (P1-8/P1-9).
