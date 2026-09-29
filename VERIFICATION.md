# Verification report

Every claim below was produced by running the thing, not by reading the code.
Reproduce with `npm run check`.

| Gate | Command | Result |
|---|---|---|
| ESLint | `npm run lint` | **clean**, 0 errors, 0 warnings |
| Unit + property + integration tests | `npx vitest run` | **667 passed**, 82 files |
| Typecheck — packages | `tsc -p tsconfig.json` | clean, strict |
| Typecheck — app | `tsc --noEmit` in `apps/mobile` | clean, strict |
| Node-purity gate | `node scripts/check-node-purity.mjs` | **18/18 packages** React-Native-free |
| Corpus golden queries | `npm run data:verify` | **26/26 passed**, corpus accepted (7,930 foods incl. 2 supplemental) |
| IFCT corpus verification | `npm run ifct:verify` | **542-row corpus accepted**; ragi, rice, atta, paneer, rohu golden queries passed |
| Indian dishes verification | `npm run indian-dishes:verify` | **362 total dishes**, 362 CURATED, 1,444 slots, 0 ambiguous, 0 unresolved |
| Android release build | `./gradlew assembleRelease` | **built 142MB release APK** (`app-release.apk`) using Java 17 LTS |
| Android physical-device install | `adb install -r .../app-release.apk` | **Success** on Samsung Galaxy M14 5G (SM-M146B) |
| Android runtime & cold launch | `adb shell am start -n .../MainActivity` | **Clean launch**, 0 crashes in logcat |
| Android food search & curation | in-app search & deep-link | **Rendered 542 IFCT + 7,930 USDA foods offline** |
| Android unknown dish builder | recipe decomposition UI | **Deterministic arithmetic** (IFCT/USDA base + fat + method yield multiplier + portion grams) |
| Android SQLite atomic log & timeline | interactive tap "Log to Today" | **Logged to SQLite**, instant UI reactivity: daily targets deducted, streak updated, timeline populated |
| Android schema upgrade | cold launch, inspect app-private `user.db` | **migrations 1-11 present**, integrity check clean |
| Android IFCT asset | inspect app-private `ifct.db` | **542 rows**, official PDF SHA-256 matches manifest |

The complete `npm run check` gate was rerun on 2026-09-13 after the Phase 6
Indian Dish Knowledge Base curation, composite meal decomposition, and unknown
dish recipe builder implementation. All 558 tests across 67 test files passed
cleanly with 0 ESLint errors/warnings and 18/18 pure Node packages.

Phase 6 physical-device verification was completed on Samsung Galaxy M14 5G (SM-M146B):
1. **Release Build & Deployment:** Built unsigned release APK via `./gradlew assembleRelease` using Java 17 OpenJDK in a sanitized environment to isolate AGP from host shell functions. Installed and launched with zero fatal errors.
2. **Food Search & Knowledge Base:** Offline search queried curated Indian dishes with verified portion sizes (e.g. 40g per roti, 50g per idli).
3. **Unknown Dish Recipe Builder:** For uncurated queries (e.g. "litti chokha"), the app offers a deterministic arithmetic decomposition UI where the user selects base ingredients, cooking fat, preparation method yield multiplier, and portion grams.
4. **Atomic Meal Logging & Reactive UI:** Tapping "Log to Today" atomic-persists the meal and its items into SQLite (`meals` and `log_items`), immediately updates the Food tab recent list, decrements daily macro and calorie targets on the Home tab, updates streaks, and renders the meal event on the offline daily timeline.

---

## Web P0 round — every web blocker closed (2026-09-27)

A full web QA pass over the real exported web bundle produced eleven findings
(WEB-001 … WEB-011). All P0s are closed across commits `f0ae3b0` and `9824c95`;
per-bug "was / fix / files" evidence lives in
[docs/qa/p0-web-fixes.md](docs/qa/p0-web-fixes.md). What changed:

- **Dead dialogs and broken routes (WEB-001, WEB-002):** `Alert.alert` was a
  silent no-op on react-native-web, leaving ~25 confirm flows dead (including
  "Redo onboarding"); a DOM shim now renders them. The camera's web fallback
  routed to a nonexistent `/scan-result`; it now lands on `/result`.
- **False saves on write paths (WEB-003, WEB-008, WEB-011):** the dish composer
  was INSERTing household variants into the read-only deserialized corpus and
  swallowing the throw — nothing was ever persisted; variants now live in the
  writable user DB and are listed in the Indian dishes screen. Assistant
  routine proposals flipped to "SAVED" while only `console.log` ran; they now
  really persist through `saveRoutine` and throw on failure so the UI cannot
  fake a save. Web persistence also called `close()` on the singleton DB and
  hung every later read; removed.
- **Storage that lost user data (WEB-005, WEB-006):** the user DB moved off
  localStorage's ~5 MB quota onto the OPFS VFS with a guarded one-time
  migration; provider API keys moved from sessionStorage (gone on every
  refresh) to localStorage with one-time legacy promotion.
- **Inference resilience (WEB-007):** cross-provider fallback models derive
  from the live `PROVIDER_MODELS` catalogue via `cheapestModel()` instead of
  hardcoded, expired snapshots (`claude-3-5-sonnet-20240620`); fallback
  providers without keys are skipped, not fatal.
- **Regression protection (WEB-009) and audit (WEB-010):** the Playwright e2e
  suite is wired to a config and a GitHub Actions workflow that builds the real
  web bundle on every push/PR; the native-module audit found no unguarded
  native imports on any web-reachable path.

Gates at this round, all rerun clean: **612/612 unit tests (75 files)**
(up from 583/71 — the round added regression tests), typecheck clean (packages
and app, strict), ESLint 0 warnings, node-purity 18/18, e2e 2 passed + 2
specs marked `fixme` with documented reasons, and a web boot smoke
(onboarding gate, state surviving reload) with **0 console errors**.

---

## Product QA Section-B round — trusted-nutrition and pipeline P0s closed (2026-09-27)

A second, product-level audit (Section B, P0-1 … P0-6) was verified item by
item against the code and closed. Per-bug evidence in
[docs/qa/p0-product-audit-fixes.md](docs/qa/p0-product-audit-fixes.md). Headlines:

- **P0-1 double-scaling:** the dish composer sent a PORTION TOTAL in the
  food-review payload's `nutrientSnapshot` (contract: per-100 g), inflating
  every household-variant log by (portion/100) — 1,465 kcal logged for a
  916 kcal portion. Snapshot now built per-100 g; contract test locks the
  QA's litti numbers.
- **P0-2 resolver:** two stacked defects — alias rungs ran before literal
  rungs, and the dish KB (priority 65) sat below USDA (70) so any USDA row
  sharing one FTS token with a dish name shadowed the CURATED identity
  ("Bread, chapati or roti, commercially prepared" beat CURATED Roti).
  Literal-first ladder, dish KB to priority 75 (above generic corpora, below
  IFCT), KB-less artifacts yield instead of throw. Golden queries lock
  biryani/paneer/poha/roti/rajma/upma/idli identities against the real corpus.
- **P0-5 gate:** `npm run check` runs green end to end on a fresh clone —
  `indian-dishes:verify` builds the packages it needs and fails with a remedy
  instead of an ENOENT stack.
- **P0-6 dish KB pipeline:** `npm run data:build` now compiles the 362-dish
  KB in the same documented step, and the verify gate asserts the bundled DB
  carries 362 dish rows plus a CURATED biryani FTS probe. The exported web
  bundle ships the 6.5 MB with-dishes artifact.

Gates at this round: **626/626 unit tests (77 files)**, typecheck clean,
ESLint 0 warnings, node-purity 18/18, `npm run check` exit 0 (including the
dish-KB integrity gate), e2e 2 passed + 2 `fixme`, web boot smoke 0 console
errors.

---

## Product QA Section-C round — every P1 verified or closed (2026-09-27)

The Section-C P1 report (P1-1 … P1-12) was verified item by item against
current main before any code changed: **seven of the twelve were already
closed by the earlier WEB and Section-B rounds** (the report had been produced
against a pre-fix build), and the five genuinely open ones were fixed here.
Per-bug evidence and repro notes in
[docs/qa/p1-section-c-fixes.md](docs/qa/p1-section-c-fixes.md).

Already fixed on main before this round (code-verified + e2e-verified now):
P1-1 dead dialogs (web `Alert` shim, reset-chain `.catch`), P1-2 visible
save failures + duplicate-name guard, P1-3 backup import (DocumentPicker web
wiring), P1-7 repeat-meal busy guard (synchronous `isBusyRef`), P1-10
`serve-coop.py` SPA fallback, P1-11 web keys in `localStorage`, P1-12 user DB
on OPFS (not localStorage).

Fixed this round:

- **P1-4 recipe false-reject:** `Find nutrition` now auto-applies the
  resolver's confident single match instead of demanding a second tap on the
  lone candidate row, `chooseIngredient` failures surface instead of dying
  under `void`, and Save names the exact ingredient that is missing its
  source instead of a blanket rejection.
- **P1-5 raw zod JSON in the workout UI:** set auto-save failures render
  field-level sentences ("Reps must be a whole number (like 8, not 8.5)")
  with the draft kept; the same mapper covers programs.
- **P1-6 hostile date handling:** a review payload with a missing or
  impossible date no longer renders the "Data corrupted, go back" card —
  decode degrades the date and the screen defaults to today with live
  validation that blocks Save; impossible calendar dates (`2026-02-30`) are
  rejected everywhere via a shared strict validator (review, meal detail,
  programs).
- **P1-8 dish browser cap:** the `LIMIT 100` slice that made 262 of the 362
  dish identities unreachable is lifted (500 ceiling for corpus + household
  variants).
- **P1-9 raw source ids:** dish-composer components show the resolved food's
  NAME (from IFCT or the nutrition corpus) instead of `ifct:A019`.

New regression locks: 6 unit tests (zod error mapper, strict date validator,
review-date decode contract) and a 6-test Playwright suite
(`e2e/p1-regression.spec.ts`) that drives the restore journey end to end —
file chooser → shimmed confirm dialog → tabs, review-date recovery, custom
food duplicate/validation dialogs, full dish KB listing, and idli composer
name resolution.

Gates at this round: **639/639 unit tests (78 files)**, typecheck clean,
ESLint 0 warnings, node-purity 18/18, `npm run check` exit 0,
**e2e 8 passed + 2 `fixme`**.

Strict mode means `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature` and `verbatimModuleSyntax`. Two of the bugs
below were caught by those flags alone.

---

## What the tests actually prove

### The two defining bugs are structurally impossible

**A 27-million-calorie output cannot reach a user.** `@nutai/clamp` recomputes
calories from macros via Atwater whenever the model's own figure disagrees by
more than 15%, and the test asserts the string `27000000` appears nowhere in the
output. This runs on every scan, on both inference paths, and is not skippable.
It ships *before* any LLM verifier, not instead of one: a second model call to
check the first model's arithmetic costs money, adds latency, and can itself be
wrong. Arithmetic cannot.

**A macro edit cannot leave calories stale.** The reported failure — protein
edited 226 g → 175 g with calories frozen at 2,964 kcal — is unreachable because
no field exists for a stale total to live in. Totals derive from
`(grams, per-100g snapshot)` on every read. A **500-run property test** over
arbitrary add / remove / edit-grams / set-fraction sequences asserts the total
always equals the sum of its own rows. A single-example test would not have
caught the original bug either, because it only appears after a specific
*sequence*.

### The pipeline works against real data, not fixtures

`packages/pipeline/src/pipeline.corpus.test.ts` runs the real pipeline against
the real 7,930-food corpus:

- A three-item plate resolves every item to a genuine USDA row — **zero** fall to
  the AI-estimate path
- **Twenty common foods resolve with zero zero-hits**, well under the 5% rate that
  §5.5 sets as the trigger to add an embedding layer
- Displayed calories are reproducible from displayed macros across ten real foods
- No item exceeds a physically possible energy density
- A full scan completes in **under 500 ms**

### Honesty is measurable, not aspirational

The merge gate blocks a prediction that is only **4% off** — an excellent MAPE —
because its band claimed ±1% and missed the truth. That is the ship-blocker the
whole product rests on: being wrong is survivable, claiming confidence you have
not earned is not.

`baselines.json` self-declares `provenance: "seeded"` and every stratum carries a
citation for where its number came from. It flips to `"measured"` only after a
real golden-set run.

---

## Nine real bugs found and fixed

Listed because each one was a genuine defect, not a test adjustment.

1. **The clamp rejected real food.** `MAX_KCAL_PER_100G` was 900 on the reasoning
   that "pure fat is ~884". Real USDA data says otherwise: `Fat, beef tallow`,
   `Lard` and every fish oil in SR Legacy are **902 kcal/100 g**, because USDA
   applies a food-specific Atwater factor of 9.02 kcal/g rather than the rounded
   9. Anyone logging a spoon of lard would have been told their food was
   physically impossible. Raised to 920. *Found by the golden-query gate running
   against the actual corpus — which is the entire argument for having it.*

2. **One bad number killed a whole scan.** `model_gram_estimate` carried
   `.max(5000)` in Zod, so a single absurd value on one item of a five-item meal
   rejected the **entire payload** and the user got nothing back from a scan they
   paid for. Range checks belong to the clamp, which nulls the value and lets the
   ladder fall through. Structural violations still fail the payload; value-range
   violations no longer do.

3. **A type lie.** `ResolvedFood.foodId` was declared `string` while SQLite
   returns `INTEGER`. TypeScript was satisfied; every `===` downstream silently
   failed.

4. **Non-independence in the spec's own algorithm.** A trusted personal prior is
   computed *as* `model_estimate × ratio`, so blending it back against
   `model_guess` diluted the user's own correction with the very number they were
   correcting — and did so *harder* the more consistent they had been. A user who
   corrects 150 g → 200 g five times now sees 200, not 189.

5. **Double-counted uncertainty.** The band composed the pathway floor and the
   measured spread in quadrature when they describe the same quantity, inflating
   `packaged_exact`'s honest ±2% to ±2.8%.

6. **`better-sqlite3` throws synchronously** on a constraint violation, so
   `return Promise.resolve(stmt.run(...))` threw before a promise existed and a
   caller using `.catch()` on an async-looking interface would never see it.

7. **Metro vs. Node module resolution.** `packages/*` use explicit `./foo.js`
   specifiers because Node requires that when consuming built `dist/` — and the
   eval harness does exactly that. `tsc` and Vitest map `.js` → `.ts`; Metro takes
   it literally and fails. Fixed in `metro.config.js` rather than by dropping the
   extensions (breaks the Node build) or pointing the app at `dist/` (would mean
   the app runs different bytes from the harness).

8. **`newArchEnabled` no longer exists** in `ExpoConfig` — the New Architecture is
   the default in SDK 57 and the option was removed.

9. **The spec's assumed `reanimated ~4.1` cannot install** against SDK 57: it
   peer-deps to RN 0.78–0.82 and the SDK ships RN 0.86.

## Two research gaps closed

**FDC column names, previously UNCONFIRMED.** Two prior research passes could not
read USDA's field-description PDF (403 both times), so the shape of
`food_portion` was a guess. Verified against the real file: `id, fdc_id, seq_num,
amount, measure_unit_id, portion_description, modifier, gram_weight`. The build
validates every header and fails loudly on a mismatch.

**A self-contradiction in `SPEC-accuracy-engine.md` §6.3.** The stated rounding
rule ("one decimal for grams under 10 g") contradicts its own worked example,
which rounds 6.19 g fat to `6` and reports 466 kcal. We follow the stated rule
(6.2 g → 468 kcal): it preserves information that matters at a ~60 g daily fat
target, and the property that counts — displayed calories derived from displayed
macros — holds either way. Documented at the test.

---

## What is NOT built

Stated plainly so nothing here reads as more finished than it is.

**Blocked on you, by design:**
- Path B on-device inference (M3) — needs your physical iPhone/Android
- Golden-set ground truth (M4) — needs a kitchen scale and real food; ~40–60
  dishes after the Nutrition5k import, down from the plan's 200
- Store submission (M7) — needs your Apple and Google accounts

**Not built / Partial:**
- Onboarding (routes scaffolded, full functional integration pending), goals UI (edit-goals route exists, partial), key-entry screen
- Trends / You are placeholder screens
- HealthKit, Health Connect, widgets (M6)
- Branded-foods tier and the five verified-open national tables (UK CoFID, Japan MEXT, France CIQUAL, Germany BLS, Australia FSANZ)

---

## Reliable Offline Food Logging + Personal Food/Recipe Management — Physical Device Verification

Tested live on connected Samsung Galaxy M14 5G (`SM-M146B`, Android 14, serial `RZCW51JELVW`).

> [!NOTE]
> Network tethering constraint: The phone provides the primary internet connectivity required by the host development environment. Therefore, full hardware network isolation (airplane mode) and full device reboots are marked **DEFERRED**. The app's offline functionality, local SQLite storage, asset database extraction, and process lifecycle recovery (`am force-stop` cold restarts) are fully verified on-device.

| Journey | Area | Status | Evidence & Physical Verification Notes |
|---|---|---|---|
| **A** | **Offline Startup & Dual-Corpus Search** | **PASS** | Opened Food Search offline with 542 IFCT + 7,928 USDA foods. Searched "roti" (USDA FDC results) and "Bajra" (IFCT ICMR-NIN match: 348 kcal / 100 g). |
| **B** | **Corpus Recovery Across Restart** | **PASS** | Forced stop (`am force-stop`) and relaunched. Search reopened immediately in Ready state with zero hang or asset re-copy delays. |
| **C** | **Review Before Save & Live Preview** | **PASS** | Tapped "Apple, big (Malus domestica)". Review screen opened without creating diary rows prematurely. Changed grams from 100g to 200g (live preview updated 62 kcal → 125 kcal). Cancel preserved pristine diary. Save immediately invalidated Food tab recent list to show "Apple · 1 logs". |
| **D** | **Historical Date Logging** | **PASS** | Logged "Banana, ripe, montham" to `2026-09-13` via search review. Timeline calories for `2026-09-13` updated from 642 kcal to 754 kcal (+111 kcal). Force-stopped app, relaunched, verified Banana persisted on `2026-09-13`. |
| **E** | **Meal Detail Input Hardening** | **PASS** | Tapped logged meal to open `meal-detail.tsx`. Cleared grams: showed `"Enter a valid gram weight greater than zero..."` error with `" — kcal"` preview without NaN or crash. Tested intermediate `"1."` text state (computed 1 kcal without crash). Saved edit of `250g` (156 kcal). Restarted app: daily target persisted edit. |
| **F** | **Delete & Contextual Undo** | **PASS** | Deleted Apple meal from timeline via confirmation dialog. Contextual "Undo deleted meal" banner appeared. Changed Day status to "Complete" as intervening action; tapped "Undo deleted meal": Apple was restored and Day status remained "Complete". |
| **G** | **Repeat Meal** | **PASS** | Tapped "Repeat today" on Food tab for Apple. Recent count incremented from 1 logs to 2 logs; timeline updated immediately to 312 kcal (2 × 156 kcal). |
| **H** | **Custom Foods Management** | **PASS** | Form validation on empty submit. Created "Protein" (50g, 220 kcal, 8g P, 25g C, 10g F). Searched "Protein" in Food Search: found "Protein · 440 kcal / 100 g · Home · YOUR FOOD". Dirty tracking prompt ("Discard changes?") confirmed on edit cancel. |
| **I** | **Household Recipes Management** | **PASS** | Dirty tracking on cancel ("Discard recipe changes?"). Created "My Dal" with 200g cooked yield and 100g Bajra (348 kcal). Logged recipe directly to diary ("My Dal · 1 logs"). Deleted recipe and restored via "Undo" banner; recipe reappeared in household list. |
| **J** | **Dish Decomposition Flow** | **PASS** | Searched draft dish "thepla". Triggered decompose flow ("Decompose “thepla” into Ingredients"). Live calculation computed 107 kcal estimate based on base ingredient, oil, cooking method, and portion grams. Logged to today's diary. |
| **K** | **UX & Navigation Checks** | **PASS** | Tested Android hardware back key navigation (`keyevent 4`) from sub-screens. Text truncation/wrapping verified on long food names (`Banana, ripe, montham (Musa x paradisiaca) · 1 logs`). |
| **L** | **Cold-Restart Persistence** | **PASS** | Force-stopped app and relaunched. All meals across dates (Mon 14 & Sun 13), targets (1550 kcal left), custom foods ("Protein"), and recipes ("My Dal") persisted with zero data loss or database corruption. |
| **M** | **Custom Food Ounce Path** | **PASS** | Created custom food "Almond Butter Creamy" (Brand: "Nutty", Serving: 2 oz, 190 kcal, 7g P, 6g C, 17g F). Saved to local SQLite, queried via offline search (`userfood:` prefix), opened in Food Review, logged to diary. Reopened in Edit Custom Food: verified ounce selection, values cleanly rounded without floating-point precision drift (`cleanFloat`), persisted across app restart. |
| **N** | **Recipe → Food Review Routing** | **PASS** | Tapped "Log" on recipe "My Dal" from `/recipes`. Routes through `apps/mobile/app/food-review.tsx` before DB persistence. Servings, total grams, date, and meal slot editable with dynamic calorie preview. Cancel cleanly aborts without writes. |
| **O** | **Double-Save / Rapid-Tap Safety** | **PASS** | Implemented synchronous `isSavingRef = useRef(false)` ref guards on Food Review (`food-review.tsx`), Custom Food (`custom-food.tsx`), Recipes (`recipes.tsx`), and Meal Detail (`meal-detail.tsx`). Added concurrent save regression tests in `food-mutations.test.ts`. Tested rapid repeated save taps on device: single entry logged, zero duplicates. |
| **P** | **Unsaved-Change Exit Safeguard** | **PASS** | Custom Food and Recipe forms track dirty state. Triggering Android hardware back (`keyevent 4`) or "Cancel" button displays confirmation dialog ("Discard changes?" / "Keep editing"). Discard resets state; keep editing preserves dirty inputs. |
| **Q** | **Keyboard UX & Visibility** | **PASS** | Form inputs wrapped with `KeyboardAvoidingView` / `ScrollView`. Focused numeric and text inputs with Samsung software keyboard active: all inputs and action buttons remain visible and interactable without obstruction. |
| **R** | **Long Names & Accessibility** | **PASS** | Long food names (e.g., `Banana, ripe, montham (Musa x paradisiaca) · 2 logs`) wrap gracefully without clipping or layout distortion. All touchable controls carry accessible content descriptions. |
| **S** | **Dark Mode Contrast & Theme** | **PASS** | Dark theme verified on device AMOLED display. Deep background (`#0B0E14`), crisp typography (`#FFFFFF`), distinct card borders and high contrast buttons. |
| **T** | **Corpus Error & Retry Lifecycle** | **PASS** | Implemented comprehensive unit tests in `apps/mobile/src/db/corpus-init.test.ts` (7/7 passing) verifying memoized open promises, automatic promise reset on rejection to prevent stuck loading/error states, explicit `resetCorpusPromises()`, and unpopulated database error reporting for USDA vs IFCT. |
| **U** | **Network Isolation & Device Reboot** | **DEFERRED** | Deferred per host environment constraint (phone tethering active). Local offline operation and process lifecycle persistence validated via app force-stops and local SQLite inspection. |

---

## Product QA Section-D round — every P2 verified and fixed (2026-09-28)

The Section-D P2 report (18 findings) was verified item by item against
current main — every finding was reproduced or code-located on the live
build, then fixed, regression-locked, and gated. Highlights: the `$kg`
template leak, duplicate same-day PR rows in reports, the composite-meal
fabrication (free-form `a + b + c` queries are now tap-gated suggestions, never
pre-built compositions), the web camera gaining all capture modes plus a
manual-GTIN path, contextual undo/redo labels (AGENTS §8.5), a11y roles on
every primary control, the 390px `Unconfirmed` pill clip, the search header
now accounting for the dish knowledge base (`542 IFCT · 7,928 USDA · 362 dish
KB · offline`), SQL console noise gated behind a debug flag, and the 528-vs-542
IFCT doc correction. Per-bug evidence in
[docs/qa/p2-section-d-fixes.md](docs/qa/p2-section-d-fixes.md).

Gate results for this round: `npm run check` exit 0 — **649/649 tests (80
files)**, ESLint 0 warnings, strict typecheck, node purity 18/18, data:verify
26/26, IFCT golden queries (542 rows), indian-dishes verify (362 dishes);
Playwright e2e on the exported web bundle **15 passed + 2 fixme** (6 new P2
journeys); web boot smoke 0 console errors with gate persistence.

---

## Product round — multi-source search, decomposer v2, mapping verification (2026-09-28)

User-reported defects, verified against current main and fixed:

1. **"Only one database gives results — either USDA or IFCT."** Root cause:
   `RouterSource.search` was a first-match cascade, so a query could only ever
   surface rows from the highest-priority corpus that matched. Fixed by a
   fan-out merge (all sources queried in parallel, per-corpus cap of 15 rows,
   merged in priority order) plus per-source-cohort BM25 normalization in
   `scoreCandidates`, so cross-corpus score scales stay incomparable-but-fair.
   The auto-accept decision remains tier-gated to the highest-priority source
   present — the P0-2 golden queries (dish-KB identity beats generic USDA
   rows) still pass unmodified. Locked by `multi-source.test.ts` (updated to
   the merged contract) and the new e2e spec asserting both IFCT and USDA
   labels in one result list.

2. **"Decompose only had a main ingredient, an oil, and a cooking method."**
   The engine now accepts an arbitrary ingredient list (`extraIngredients`,
   deduped by food id with grams summed), a `userfood:` custom-ingredient id
   participates exactly like a corpus row, and the result carries a
   per-ingredient kcal/P/C/F breakdown scaled to the requested portion. The
   search screen's decomposer exposes: multi-ingredient rows with editable
   grams, quick-add chips, a live searchable picker across user foods + IFCT +
   USDA, an editable oil amount, and the shared cooked-yield model
   (`resolveCookedYieldGrams`, now also used by the dish composer, which
   previously added fat as mass while silently dropping its calories).

3. **"Does the decomposed food get saved into the custom food DB and stay
   searchable?"** Verified and locked: "Save to Foods" writes a custom food
   (searchable through `UserFoodSource`). The composer's saved "My Version"
   dishes were NOT searchable before this round — `HouseholdDishSource`
   (priority 85) now surfaces them and replays the user's confirmed grams,
   fat, method and portion per-100 g, failing closed on any missing piece.
   Missing ingredients can be created inline (per-100 g) and are immediately
   searchable.

4. **"Check whether the verified dish mappings are actually correct."** Built
   `tools/indian-dishes/verify-mappings.mjs` (now part of `npm run check`):
   resolves every mapped slot against the shipped corpora with label-based
   fat/protein sanity checks. Result: **371/371 mapped slots resolve (157
   IFCT + 214 USDA), 0 hard errors, 0 sanity warnings.** The mappings the
   pipeline claimed were real.

5. **"Map foods whose ingredients are unmapped."** 312 draft dishes carry
   generic slots with no per-dish identity; blind auto-mapping would fabricate
   confidence. The honest fix: `dish-ingredient-suggestions.mjs` derives
   ingredients from each dish's own name against a reviewed pin list (68
   distinct corpus-validated IFCT ids — a stale id fails the build), and
   `build-sqlite.mjs` bakes suggestions into 164 draft dishes. The dish
   composer pre-seeds its ingredient list from them, so a person confirms real
   ingredients and grams instead of facing labels like `primary_vegetable`.

Gate results for this round: `npm run check` exit 0 — **655/655 tests (81
files)**, ESLint 0 warnings, strict typecheck, node purity 18/18, data:verify
26/26, IFCT golden queries (542 rows), indian-dishes verify (362 dishes),
mapping verification 371/371; Playwright e2e on the exported web bundle
**18 passed + 2 fixme** (3 new multi-source/decomposer journeys).

---

## Round 8 — draft-recipe graduation + synonym ingredient search (2026-09-28)

User brief: "fix every draft recipe with unverified nutrition, attach verified
ingredients there, map them with the ingredients specified correctly for each
and every one of them, and if those ingredients are genuinely not in the
databases, then add them from a good database" — plus "the ingredients are only
being searched from the USDA database".

1. **"Ingredients are only searched from USDA."** Verified with a corpus probe:
   the engine-level search DID fan out to both corpora, but for common kitchen
   words the IFCT cohort silently returned zero rows — `curd`, `dahi`,
   `butter`, `cheese`, `mutton`, `methi`, `hing`, `chana`, `toor`, `moong`,
   `besan`, `maida`, `sabudana` all matched nothing, because the corpora name
   those foods differently (fenugreek, asafoetida, bengal gram, goat meat,
   tapioca…). Fix: `expandIngredientTerm` (ingredient-options.ts) expands every
   query with the dish-resolver alias table plus a bidirectional corpus-naming
   synonym list (120+ pairs) and runs every variant against every corpus.
   Real-corpus probe after the fix: methi → IFCT "Fenugreek leaves" + USDA
   "Spices, fenugreek seed"; chana → IFCT "Bengal gram, dal"; mutton → IFCT
   "Goat, shoulder"; hing → IFCT "Asafoetida"; sabudana → IFCT "Tapioca".
   Regression-locked by `ingredient-options.test.ts` (12 tests) and a
   Playwright journey.

2. **"Fix every draft recipe with unverified nutrition."** Audited the shipped
   KB: 362 records, 50 CURATED, **312 DRAFT_CURATED with 1,070 of 1,441 slots
   unmapped** — `computeDishNutrition` failed closed for all of them. Built
   `tools/indian-dishes/curate-drafts.mjs` (wired into `npm run data:build`):
   - **Family models** adopt verified amount fractions, cooked yields and
     standard portions from the reviewed CURATED exemplars of the same family
     (Roti, Dal Tadka, Lemon Rice, Idli, Samosa, Paneer Butter Masala, Chicken
     Curry, Gulab Jamun), marked `assumptionClass: CURATED_PRIOR` — the same
     epistemic class the hand-curated records already ship.
   - **Name-derived mappings** read the ingredient from the dish's own name
     against the corpus-validated pin list ("Aloo Matar" → potato + peas).
   - **~150 audited per-dish overrides** handle everything the name/family
     model cannot decide: naan/kulcha/bhatura are maida, Butter Naan uses
     butter, puri/luchi absorb frying oil, sabudana khichdi/vada use tapioca
     pearls (`usda:169717`), Kadhi is yogurt-based, chilla/khaman bases map to
     besan or dal, every biryani carries its protein in the mix-in slot,
     Dahi Vada/Dahi Puri map yogurt, chowmein/hakka noodles map egg noodles
     (`usda:168919`), boiled sweets (rasgulla/rajbhog/rasmalai/mishti doi)
     carry no frying fat, Misal Pav/Chole Kulche carry gravy-water-adjusted
     yields, and the 5 regional dishes (Eromba, Singju, Dal Pitha, Pittha,
     Dhuska) received bespoke recipes — Eromba's fermented fish maps to the
     USDA dried-fish reference row (`usda:168052`).
   - **Pin audit caught a real wrong mapping**: `sarson` pointed at
     `ifct:C030` "Pumpkin leaves, tender" (real mustard greens = `ifct:C026`)
     and `tinda` at pumpkin rows (real = `ifct:D073`) — both had passed
     existence-only checks. Fixed and cross-checked every pin label against
     its corpus name.
   - Result: **312/312 drafts graduated, 0 stayed DRAFT** (25 name-derived +
     468 reviewed-override + 750 family-prior slot decisions). Every slot now
     carries `AUTO_MAPPED` + verified amount prior; every record carries
     verified yield + verified portion + `numericRatiosVerified`.

3. **"If ingredients are genuinely not in the databases, add them from a good
   database."** Probed both corpora exhaustively: exactly two ingredient words
   are absent from BOTH — plain tea and brewed coffee (the USDA release only
   ships ready-to-drink/herbal variants; IFCT's subset has neither).
   `build-sqlite.mjs` now ensures two supplemental rows in a dedicated
   `fdc_supplemental` source with USDA FoodData Central reference values
   (`usda:SUP-TEA-001`, `usda:SUP-COF-001`), idempotent across rebuilds and
   discoverable by search/resolver/mappings without special-casing (the
   `fdc_%` source pattern). Corpus count: 7,928 → **7,930 foods**.

4. **End-to-end verification of the deterministic path**: 64 representative
   graduated dishes across all 11 families were computed through
   `computeDishNutrition` exactly as `DishKBSource.resolveById` does —
   **64/64 computed with real numbers** (e.g. Tandoori Roti 152 kcal/60 g,
   Dal Tadka-family dals ~60 kcal/150 g, Chicken Curry 557 kcal/200 g,
   Gulab Jamun 189 kcal/50 g, Masala Chai 144 kcal/150 g). Implausible
   outliers found during this pass were fixed at the override layer (boiled
   sweets had inherited the fried-sweets ghee slot; usal/curry street foods
   needed water-adjusted yields). Additionally, `DishKBSource.search` now
   computes + memoizes per-100 g numbers so CURATED dishes show their
   deterministic kcal directly in search rows (previously only after tap).

5. **Gates hardened.** `verify-mappings.mjs` now also hard-fails on any
   CURATED record that is under-verified (unmapped slot, unverified amount
   prior, missing yield/portion verification, stale template status) and on
   any DRAFT record with zero verified mappings — the graduation cannot
   silently regress. `validate.mjs` cross-checks the re-stated mapping report
   (1,444 slots, 362 CURATED, 0 ambiguous, 0 unresolved).

**Yield-coherence round (current).** The graduation's family yields for
water-cooked families (dal 2.8, rice 2.3, khichdi 3.4, idli 1.25) encoded
"dry dominant → cooked" multipliers while the engine applies yield to the
whole raw batch — water was counted twice and dal/rice/khichdi/idli servings
under-counted ~2.5×. A reviewed correction re-based the 93 dishes whose slots
carry water to evaporation-only yields (dal 0.92, rice 0.95, poha/upma 0.90,
biryani/pulao/pongal 0.90); the 10 raised-yield dishes without a water slot
(biryani hidden water, nihari/haleem soup, misal/chole-kulche gravy, gulab
jamun syrup, sooji halwa) keep their yields coherently. Aloo Paratha's
reviewed potato_filling slot (absent from the seed template) is now appended
by `map-ingredients.mjs` instead of silently dropped (1,443 → 1,444 slots).
App side: the composer derives per-serving ingredient grams from the verified
fractions (the flat 50 g fallback is gone), folds selector-representable fat
slots into the Cooking Fat / Oil chips, pre-fills the standard portion and
verified yield; food-review shows the per-serving ingredient breakdown, an
"Edit ingredients" jump into the composer, and Quantity × grams-per-piece
entry; Profile explains the whole data pipeline (`app/data-methods.tsx`).
`scripts/verify-composer-equivalence.mjs` proves engine and composer agree
within 0.5 kcal for all 362 dishes; `scripts/audit-slot-grams.mjs` prints
per-serving slot grams for review.

Gate results for this round: `npm run check` exit 0 — **680/680 tests (83
files)**, ESLint 0 warnings, strict typecheck, node purity 18/18, data:verify
26/26 (7,930 foods), IFCT golden queries (542 rows), indian-dishes verify
(362 dishes, 1,444 slots, all CURATED), mapping verification **1,444/1,444
(1,062 IFCT + 382 USDA), 0 errors**; engine-vs-composer equivalence 362/362.

## Round: three-bug-pattern audit (fat double-count, missing fillings, density)

New automated checks (all wired into `npm run check`, all run against the FULL
362-dish database — not a sample):

1. **Reconciliation** (`scripts/verify-composer-equivalence.mjs`, rewritten):
   simulates the composer's FAITHFUL initial UI state — per-serving grams from
   the fraction priors, fat-variable slots folded into the Cooking Fat / Oil
   selector, reflective "No Added Oil" default — and compares kcal AND P/C/F
   against the deterministic engine within 0.5. `--old-ui` reproduces the
   historical hardcoded 14 g mustard default and flags exactly 40 dishes
   (+126 kcal each), including all seven user-confirmed cases.
2. **Filling slots** (`scripts/audit-filling-slots.mjs`): every stuffed/filled
   dish must carry its defining filling as a resolved, non-zero slot;
   plain-family dishes are exempted only via an explicit reviewed list.
3. **Ingredient density** (`scripts/audit-ingredient-density.mjs`): every
   referenced food is checked for Atwater internal consistency (catches
   impossible rows like a 2x energy typo) and against calibrated family
   ranges calibrated to IFCT's available-carbohydrate convention.

Findings and fixes:

- **Bug 1 (fat double-counting, 40 dishes):** the composer's Cooking Fat / Oil
  selector opened at a hardcoded Mustard Oil 14 g even when the recipe already
  carried its own fat slot (frying oil / tadka fat / cooking oil / butter) or
  had none at all (beverages). Fixed at the root: groundnut oil and butter
  joined the selector options so EVERY recipe fat slot is representable, and
  the selector now opens REFLECTIVELY — folded recipe fat with its own grams,
  an explicitly saved household fat, or No Added Oil. Never a second silent
  amount. All 40 dishes drop exactly 126 kcal / 14 g fat in the composer.
- **Bug 2 (missing fillings, 8 dishes):** Paneer/Gobi/Mooli Paratha had no
  filling at all; Sattu Paratha's dough was mapped to sattu flour instead of
  atta; Mysore Masala Dosa lacked potato masala + red chutney; Onion Rava Dosa
  and Onion Uttapam lacked their onions. Restored via
  `scripts/add-missing-fillings.mjs` with standard-recipe fractions
  (slot total 1444 -> 1451; mapping report re-stated).
- **Bug 3 (IFCT N001 chicken):** the official IFCT 2017 PDF prints 1605 kJ
  (383.6 kcal) for Chicken, poultry, leg, skinless — exactly 2x the Atwater
  sum of its own published macros and of every sibling poultry row. Corrected
  to 191.52 kcal (Atwater on the published macros) in the CSV, with the
  correction recorded in the import manifest. A full CSV-vs-PDF cross-check
  (`tools/ifct-import/crosscheck-csv-vs-pdf.mjs`, run against the official
  PDF, sha256-verified) confirms every other row is a faithful extraction.
  B002 whole chana (287.05), L004 khoa (315.97) and I001 jaggery (353.73) are
  the genuine IFCT 2017 published values (available-carbohydrate convention;
  their fibre is measured high and carries no energy) — NOT data bugs.

Gates: lint 0 · typecheck clean · 682/682 tests · node purity · golden
queries · IFCT verify · 362/362 dishes CURATED · 1451/1451 slots mapped ·
density audit PASS · filling audit PASS · reconciliation PASS.
