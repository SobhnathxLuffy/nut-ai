# Product QA Section D — P2 round: every meaningful UX defect closed

The Section D P2 report (18 findings, "meaningful UX / product defect")
was verified item by item against current `main` before any code changed.
Every finding was reproduced or code-located on the current build, then fixed,
regression-locked, and gated. Reproduce the gates with `npm run check` and
`npx playwright test` (in `apps/mobile`).

## Verdicts and fixes

| # | Finding | Fix |
|---|---------|-----|
| P2-1 | Strength PR rendered `8 reps × 42.5 $kg` — literal `$` JSX text before `{unit}` (`progress.tsx:140`) | Removed the stray `$`; renders `42.5 kg`. Weekly/monthly report PR lines used a separate formatter and were already clean. |
| P2-2 | Weekly report listed `Barbell Bench Press: 340.0 kg·reps` twice for one session | `deriveRecords` emits one row per improvement; two improving sets in one session produced two same-kind/same-date rows. New `collapseDailyPrs` (apps/mobile/src/data/analytics.ts) collapses to one row per exercise/kind/day keeping the best value (lowest for assistance PRs where less is better). Locked by `analytics-prs.test.ts` (4 cases). |
| P2-3 | Literal placeholder heading `Selected day (YYYY-MM-DD)` on the Food tab | Field label is now `Selected day` with `YYYY-MM-DD` as the input placeholder and a spoken label `Selected day, YYYY-MM-DD format`. |
| P2-4 | `78 kcal logged · Target 2487.375 kcal` un-rounded target | Day header renders `Math.round(goal.targetKcal)`. |
| P2-5 | `Showing 1 dishes`, `1 logs` | Dish browser renders `1 dish` / `N dishes`; Food recents render `1 log` / `N logs`. |
| P2-6 | Snake-case category codes (`street_food_snack`) in dish rows | Categories render title-cased with spaces (`Street Food Snack`) via `prettyCategory`. e2e locks both the absence of the raw code and the presence of the formatted text. |
| P2-7 | Composite-meal fabricated a confident composition from a long nonsense query | Free-form delimiter splits are now marked `source: 'delimiter'` (new field on `DecomposedMeal`), and the UI never auto-builds them. Delimiter splits of 2–5 parts surface a passive suggestion ("nothing is assumed yet") that requires an explicit tap; building then requires every component to resolve as a confident `auto_accept` — any guess is refused with a named-component message. Splits with more than 5 parts are treated as noise and not even suggested. Curated pairings (Litti Chokha, Idli Sambar, …) keep their auto card — they are fixed, vetted mappings. Locked by `composite-meals.test.ts` + two e2e journeys. |
| P2-8 | Rest timer: fixed 90s, no ±15s, no preference | Rest card now has `−15s` / `Rest Ns` / `+15s` / `Skip rest`. While resting the buttons adjust the running timer; while idle they adjust the remembered preferred duration (setting `training.rest_seconds`, clamped 15–600s) which is also passed as the auto-rest duration when completing sets (`saveSet` `restSeconds` override). Rest-invariant test locks: start/add-exercise/draft-never starts rest; only a real draft→completed transition starts it, honouring the override. |
| P2-9 | Web camera exposed no modes; no manual-GTIN fallback | Web fallback rewritten (`WebCameraFallback`): the same four mode pills as native; Scan-food/Label/Receipt pick images into their real pipelines (same `/result` hand-off as native, WEB-002); Barcode mode gains a manual GTIN input (8–14 digits, validated) driving `startBarcodeScan`. e2e locks modes + GTIN validation. |
| P2-10 | Apple Health dead control on web (`iOS only` row) | The section renders only off-web. e2e asserts zero `Apple Health` text on the web profile. |
| P2-11 | Hidden screens leaked into the accessibility tree / text dumps | Tabs now run with `freezeOnBlur: true`; combined with rn-screens web `hidden`/`display:none` on inactive activity state, Home-only content is absent from the Food tab's page. e2e locks `Your target` count 0 on `/food` with the Food tab genuinely loaded. |
| P2-12 | Missing a11y roles on primary controls | `accessibilityRole="button"` (+ labels/selected state) added to: dish-composer Back/Cancel/remove-✕/Search Database/candidate rows/+ Add Ingredient/Log Household Variant; indian-dishes Done/filter chips/dish rows; food-search combo-suggestion button. `role="radio"` option rows were already correct. |
| P2-13 | `Unconfirmed` pill clipped at 390px | Day status options moved from four equal-flex pills to a wrapping 2×2 grid (`flexBasis: '47%'`) — labels stay fully visible at any width. |
| P2-14 | Search header never mentioned the Dish KB; docs claimed 528 IFCT vs 542 shipped | `nutritionCorpusInfo` (native + web) now returns a `dishes` count (guarded for dish-less fixtures); the header reads `542 IFCT foods · 7,928 USDA foods · 362 dish KB · offline` (e2e-locked). VERIFICATION.md gate rows corrected to the verifier-enforced 542. |
| P2-15 | `console.log('EXEC:', …)` for every SQL statement in the web adapter | Gated behind an explicit `globalThis.__NUTAI_SQL_DEBUG__` opt-in; production console stays clean. The Indian-dishes screen's row-count debug log was already removed in the P1 round. |
| P2-16 | 2-char queries hitting the decompose path with odd copy | Decompose CTA now requires ≥3 characters; 2-char queries get `Keep typing — search and ingredient decomposition need at least 3 characters.` e2e locks copy + no CTA. |
| P2-17 | My Version empty state shows bare `Showing 0 dishes` | Empty states are now filter-aware: HOUSEHOLD explains how to save a household variant from any dish's composer; DRAFT_CURATED explains drafts appear while curated recipes are under review; no-match queries suggest a shorter prefix. |
| P2-18 | Anonymous `Undo last action` / `Redo` (AGENTS §8.5) | Day timeline fetches the live undo/redo targets and labels the buttons with the operation (`Undo: delete meal`, `Redo: update day status`), falling back to the generic label when the stack is empty. |

## Files touched

- `apps/mobile/app/(tabs)/progress.tsx` — P2-1
- `apps/mobile/src/data/analytics.ts` + `analytics-prs.test.ts` — P2-2
- `apps/mobile/src/components/DayTimeline.tsx` — P2-3, P2-4, P2-18
- `apps/mobile/app/(tabs)/food.tsx` — P2-5
- `apps/mobile/app/indian-dishes.tsx` — P2-5, P2-6, P2-12, P2-17
- `apps/mobile/app/food-search.tsx` — P2-7, P2-14, P2-16
- `packages/indian-dishes/src/composite-meals.ts` + test — P2-7
- `apps/mobile/app/workout.tsx` + `packages/training/src/rest-invariants.test.ts` — P2-8
- `apps/mobile/app/camera.tsx` — P2-9
- `apps/mobile/app/(tabs)/profile.tsx` — P2-10
- `apps/mobile/app/(tabs)/_layout.tsx` — P2-11
- `apps/mobile/app/dish-composer.tsx` — P2-12
- `apps/mobile/src/components/DayStatusControl.tsx` — P2-13
- `apps/mobile/src/db/expo-adapter.ts`, `expo-adapter.web.ts`, `corpus-init.test.ts` — P2-14, P2-15
- `apps/mobile/e2e/p2-regression.spec.ts` — e2e locks for P2-5/6/7/9/10/11/14/16

## Gate results for this round

- `npm run check` exit 0: ESLint 0 warnings, strict typecheck, **649/649 tests (80 files)**, node purity 18/18, data:verify 26/26, IFCT golden queries (542 rows), indian-dishes verify (362 dishes).
- Playwright e2e (exported web bundle): **15 passed + 2 fixme**, including 6 new P2 journeys.
- Web boot smoke: onboarding gate renders, persists across reload, **0 console errors**.
