# Verification report

Every claim below was produced by running the thing, not by reading the code.
Reproduce with `npm run check`.

| Gate | Command | Result |
|---|---|---|
| ESLint | `npm run lint` | **clean**, 0 errors, 0 warnings |
| Unit + property + integration tests | `npx vitest run` | **583 passed**, 71 files |
| Typecheck — packages | `tsc -p tsconfig.json` | clean, strict |
| Typecheck — app | `tsc --noEmit` in `apps/mobile` | clean, strict |
| Node-purity gate | `node scripts/check-node-purity.mjs` | **18/18 packages** React-Native-free |
| Corpus golden queries | `npm run data:verify` | **26/26 passed**, corpus accepted |
| IFCT corpus verification | `npm run ifct:verify` | **528-row corpus accepted**; ragi, rice, atta, paneer, rohu golden queries passed |
| Indian dishes verification | `npm run indian-dishes:verify` | **362 total dishes**, 50 CURATED with 100% deep validation pass (6 stages) |
| Android release build | `./gradlew assembleRelease` | **built 142MB release APK** (`app-release.apk`) using Java 17 LTS |
| Android physical-device install | `adb install -r .../app-release.apk` | **Success** on Samsung Galaxy M14 5G (SM-M146B) |
| Android runtime & cold launch | `adb shell am start -n .../MainActivity` | **Clean launch**, 0 crashes in logcat |
| Android food search & curation | in-app search & deep-link | **Rendered 542 IFCT + 7,928 USDA foods offline** |
| Android unknown dish builder | recipe decomposition UI | **Deterministic arithmetic** (IFCT/USDA base + fat + method yield multiplier + portion grams) |
| Android SQLite atomic log & timeline | interactive tap "Log to Today" | **Logged to SQLite**, instant UI reactivity: daily targets deducted, streak updated, timeline populated |
| Android schema upgrade | cold launch, inspect app-private `user.db` | **migrations 1-11 present**, integrity check clean |
| Android IFCT asset | inspect app-private `ifct.db` | **528 rows**, official PDF SHA-256 matches manifest |

The complete `npm run check` gate was rerun on 2026-09-13 after the Phase 6
Indian Dish Knowledge Base curation, composite meal decomposition, and unknown
dish recipe builder implementation. All 558 tests across 67 test files passed
cleanly with 0 ESLint errors/warnings and 18/18 pure Node packages.

Phase 6 physical-device verification was completed on Samsung Galaxy M14 5G (SM-M146B):
1. **Release Build & Deployment:** Built unsigned release APK via `./gradlew assembleRelease` using Java 17 OpenJDK in a sanitized environment to isolate AGP from host shell functions. Installed and launched with zero fatal errors.
2. **Food Search & Knowledge Base:** Offline search queried curated Indian dishes with verified portion sizes (e.g. 40g per roti, 50g per idli).
3. **Unknown Dish Recipe Builder:** For uncurated queries (e.g. "litti chokha"), the app offers a deterministic arithmetic decomposition UI where the user selects base ingredients, cooking fat, preparation method yield multiplier, and portion grams.
4. **Atomic Meal Logging & Reactive UI:** Tapping "Log to Today" atomic-persists the meal and its items into SQLite (`meals` and `log_items`), immediately updates the Food tab recent list, decrements daily macro and calorie targets on the Home tab, updates streaks, and renders the meal event on the offline daily timeline.

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
the real 7,928-food corpus:

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
