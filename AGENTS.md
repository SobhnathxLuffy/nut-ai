# AGENTS.md — Binding Rules for All Nut AI Coding Agents

> **Read this entire file before changing the repository.**
> This file defines the engineering contract for Nut AI. It is intentionally stricter than normal project notes because prior implementation passes repeatedly overstated completion, confused code inspection with runtime proof, and allowed user-visible defects to survive green test suites.
>
> If a task instruction conflicts with this file, stop and resolve the conflict using the precedence rules below. Do not improvise around it.

---

## 0. Current Project Reality — Read This Before Planning Anything

This section is the current operational snapshot and must be kept honest. It is not marketing copy.

### 0.1 What is currently strong

- The monorepo, strict TypeScript, SQLite foundation, migrations, operations/undo foundation, deterministic nutrition engine, IFCT/USDA integration, custom foods, recipes, and core food logging architecture are substantial.
- The latest fully-gated automated baseline is **1,915 tests passing (0 failed)** (161 files) at the v0.3.0 owner-QA fix wave (2026-10-06, `4679490`), with lint, strict typecheck, node-purity (**19/19**), `check:contrast` (**104/104 pairs**), and Playwright e2e (**46 passed / 0 skipped / 0 failed**, re-run at this tree) all green. Historical: 1,883 at the T5-fix2 review-fix wrap; 1,875 at the T5-review pass (the v0.2.0 feature wave + release prep); 1,479 at the Wave 4 wrap; 1,441 at `bcbc07d` (Wave 3, 2026-10-02); 1,077 at `2032fb1` (2026-09-30); 1,284 at `851d7e4` (Cycle-2 QA fix wave). Re-run `npm run check` after any reinstall before quoting the number for new work.
- **Onboarding is a step machine (v0.2.0 rebuild), verified at every automated layer.** Twelve focused steps hosted by `app/onboarding/index.tsx` (`src/onboarding/flow.ts` is the step machine) with per-step gates, a kill-safe resumable draft (`src/onboarding/draft.ts` — persist order transaction → done key → clear draft, so a kill at any moment is safe), and a plan reveal that persists BEFORE navigating behind a busy-guard. Height and weight units are INDEPENDENT (all four kg/cm × lb/ft+in combinations; canonical cm/kg values are never rewritten by a unit switch — unit-locked in `wave3-screens.test.ts`/`height-units.test.ts`, and the web journey is Playwright-locked). The ft/in commit path clamps with the SAME canonical bounds the Continue clamp uses (T5-fix2). NOT TESTED (device): the full hardware journey, TalkBack speech on the wheels/steps, 130% font-scale on the new screens.
- **A post-onboarding tutorial ships (v0.2.0):** 5 cards, replayable from Profile, Skip always visible — it never traps. Content is source-locked against the REAL feature names (`tutorial/content.test.ts`); the offline claim is concrete ("AI features need internet. Core logging never does.") and swept per §19. NOT TESTED (device): rendering/interaction on hardware.
- **Local notifications ship with no cloud and no accounts (v0.2.0):** meal reminders learned from the plan + rest-timer completion notices, scheduled entirely on-device; the Android 13+ permission is asked CONTEXTUALLY (only on user intent — all permission call sites are test-locked, the handler never requests); deterministic ids + prefix-scoped stale-cancel keep rapid cycling consistent (locked); tap routing resolves through the `nutai://` alias map with a 2s double-delivery debounce, and — T5-fix2 — a dirty routine editor now gets the same "Discard changes?" confirm the editor's own exits use (behaviorally locked in `handler.test.ts`). Known caveat (CODE-INSPECTED): workout reminders are pinned date-trigger epochs, so a DST crossing with no app sync in between fires ±1 h off local wall time until the next sync. NOT TESTED (device): delivery, reboot persistence, and on-device tap routing.
- **Three Android home-screen widgets ship (v0.2.0): Today / Quick Action / Training.** They render an on-device snapshot gathered through the SAME readers the screens use, published via a ~2s trailing debounce on food/workout events (seam-locked in `publish.test.ts` and `repo-invariants.test.ts` — including the T5-fix2 seam that a goal override re-publishes); a stale snapshot (>26 h) says "Open Nut AI to refresh" instead of guessing, protein-not-logged stays honest, and malformed data cannot crash SystemUI (RemoteViews only, JSON parsed with runCatching). NOT TESTED (device): launcher placement, actual rendering, and tap routing — the top native risk of the wave.
- **The Codex CLI local bridge ships (v0.2.0, `tools/codex-bridge`)** — an OpenAI-compatible server that translates to `codex exec` so the app can use a logged-in Codex CLI as a provider over the owner's own LAN. Verified against real codex-cli 0.160.0: the headless surface (`exec`, `-m`, `-i`, `--json`, `--output-schema`, `--ephemeral`, sandbox flags) parses, and failures map honestly end-to-end (truthful 401/403/429 envelopes, 401 not-logged-in, 504 kill). Server behavior is test-locked (36 tests: no shell execution vector, prompt never logged, malformed request → 400). NOT TESTED (needs API credentials): successful completions, model routing, image understanding, schema enforcement. Plain HTTP, no TLS — a documented limitation, not an oversight.
- **The UI design system is gated, not eyeballed (UI/UX report Wave 4).** Every token pair in BOTH themes passes WCAG 2.1 via `npm run check:contrast` (104 pairs, computed from `tokens.ts` — the single source of truth, completeness-guarded so a new slot can never escape the gate); identity colours never sit in a `<Text>` style (the `*Text` grade slots do); the filled option-chip selected state renders the Badge macro dialect (`proteinTint` + `proteinText` + `protein` border — the last accepted deviation was closed in Wave 5C and is gate-locked); the 7-step type scale carries the dynamic-type policy (numerals cap 1.2×, display call sites carry lineHeight 68 headroom, TextInputs state `allowFontScaling` — Android's default is OFF) with repo sweeps; `nutai://` deep links resolve through alias route files with a friendly not-found; the icon set is 64 hand-drawn glyphs on one 1.8 stroke philosophy with an in-house extension protocol (no lucide dependency, ADR-021); `react-native-reanimated` is removed (zero imports, web-export-safety architecture test-locked). The reference is **docs/design-system.md** — one primitive per family, new UI deps require an ADR.
- **Wave 5 closed the QA-completion gaps with automated evidence.** The day-detail view ships (`/day-detail` + `nutai://day`; DayStrip chips drill in with Home's selection synced; BUG-007's spec honestly updated to the drill-in journey); recipe ingredient rows show per-ingredient contributions that reconcile with the engine at 1e-10; the composer asks the dish uncertainty models' own clarification questions inline (answers re-derive through the ONE derivation path and never persist); migration v12 persists scan honesty end-to-end (per-row visibility/portion/preparation columns + the meal-level snapshot, backup round-trip, undo/redo covered); the ActiveWorkoutCard is event-driven (`onWorkoutsChanged` fires post-commit from `mutate()` — the 5 s DB poll is gone); and the assistant write path is e2e-locked on the web build (confirm → persisted 359 kcal → undo; cancel; honest 500) behind a route-mocked gateway with the provider seeded through the app's own settings screen. The e2e fixture is a realistic completed profile locked by import-path invariants.
- The full loop — scan, review, correct, log, track — ships on **Android, iPhone, and the web**. The web build runs the same Expo Router screens and the same deterministic engine: the user DB lives on the OPFS VFS (WASM SQLite) with a guarded one-time migration, provider keys live in `localStorage`, `Alert.alert` has a DOM shim, the camera fallback exposes all four capture modes plus a manual-GTIN path, and the Playwright suite runs against the real exported bundle on every push via `.github/workflows/web-e2e.yml`.
- The Indian Dish KB pipeline is part of the shipped artifact: `npm run data:build` bundles the 362-dish KB into `nutrition.db`, the verify gate asserts the row count plus a CURATED FTS probe, the resolver ranks the dish KB (priority 75) above generic corpora with a literal-first alias ladder, and the dish browser reaches all 362 identities.
- **Search is genuinely multi-source.** `RouterSource.search` fans out to EVERY registered source (user foods, household recipes, saved "My Version" dishes, dish KB, IFCT, USDA, Open Food Facts), caps each corpus at 15 rows, and `normalizeBm25` normalizes per source cohort so cross-corpus BM25 scales stay incomparable-but-fair. A single query surfaces IFCT and USDA rows side by side with source labels. The auto-accept DECISION is still tier-gated to the highest-priority source present, preserving the P0-2 guarantee that a dish-KB identity or IFCT row out-decides a generic USDA row.
- **The unknown-dish decomposer is a real multi-ingredient builder.** It accepts any number of ingredients (deduped by food id, grams summed), each with an editable gram amount, an editable oil amount, the shared cooked-yield model (`resolveCookedYieldGrams`), a live per-ingredient kcal/P/C/F breakdown scaled to the requested portion, and it accepts `userfood:` ids so custom ingredients participate fully. Ingredients are picked through a cross-database search (user foods + IFCT + USDA); when an ingredient exists in no database, an inline per-100 g form creates it in the custom food DB where it is immediately searchable.
- **Saved "My Version" dishes are searchable.** The dish composer persists confirmed grams, fat, method, and portion into the household template, and `HouseholdDishSource` (priority 85) replays that arithmetic per-100 g, failing closed on any missing piece.
- **Every dish mapping is verified AND every record is curated.** `npm run indian-dishes:verify-mappings` resolves every mapped slot against the shipped corpora, hard-fails on unresolvable/empty foods, hard-fails on any CURATED record with an unmapped slot, unverified amount prior, missing yield/portion verification, or a stale template status, and reports label-based sanity warnings (fat slots must be fat-dense, protein slots protein-rich). **1,451/1,451 mapped slots verified (1,070 IFCT + 381 USDA), 362/362 records CURATED, zero errors.**
- **Cooked yields are physically coherent.** The first graduation expressed dal/rice/khichdi/idli yields as "dry dominant → cooked" multipliers (dal 2.8, rice 2.3, khichdi 3.4) while the engine applies yield to the WHOLE raw batch — which already contains the cooking water as a slot. Water was counted twice and every dal/rice serving was under-counted ~2.5×. A reviewed correction (`scripts/fix-incoherent-yields.mjs`) re-based those yields to evaporation-only factors (dal 0.92, rice 0.95, poha/upma 0.90, biryani/pulao/pongal 0.90) for the 93 dishes whose slots carry water, and only for them — the 10 raised-yield dishes WITHOUT a water slot (biryani with hidden cooking water, nihari/haleem soup, misal/chole-kulche gravy, gulab jamun syrup, sooji halwa) keep their yields because there the raised value coherently represents water that never enters the slots. A dal-tadka serving now derives 33 g raw dal + 104 g water per 150 g cooked (was 11 g dal). `scripts/audit-slot-grams.mjs` prints per-serving slot grams for any future change.
- **Oil is charged as EATEN, not as POURED (owner QA 2026-10).** `estimateOilAbsorption` (`packages/recipe-engine/src/oil.ts` — one model, zero deps) splits pan oil into used vs absorbed: non-fried fat is fully consumed (high confidence); fried dishes absorb 35–65% of the used oil capped by the 28%-of-food-weight ceiling, medium confidence. `computeDishNutrition` charges fried dishes' fat slot at the absorbed mid while batch mass/yield stay unchanged and the result carries `oilSemantics` (per-serving used + low/mid/high + confidence); the decomposer charges the same subset (no more phantom top-up oil in `resolveCookedYieldGrams`); household recipes with `preparation: 'fried'` charge absorbed oil; the composer labels the input "Oil in the pan (g)" and shows the absorbed range. Absorption values stay UNROUNDED in arithmetic (scale-free — `verify-composer-equivalence.mjs` proves engine/composer agree within 0.5 kcal for all 362 dishes) and round only for display.
- **Reviewed curation slots survive seed-template gaps.** Aloo Paratha's reviewed recipe carried a potato_filling slot (25–35% of raw mass) the seed template lacked; `map-ingredients.mjs` used to silently drop it (inflating every other fraction). It now APPENDS curated slots missing from the seed — 1,444 slots at that pass, 1,451 today after later slot additions.
- **The dish composer shows real per-serving grams, never a flat 50 g.** `apps/mobile/src/data/dish-ingredients.ts` converts verified fraction priors to the SAME per-serving grams the deterministic engine uses (share of raw batch = mid/Σmids × portion/yield), with human-readable slot labels ("Tadka fat (optional)", never snake_case), household-measured grams taking precedence, and a regression-locked test suite. Selector-representable fat slots (ghee/mustard/sunflower) fold INTO the Cooking Fat / Oil chips (preselected with derived grams) instead of rendering twice; the composer pre-fills the dish's standard portion and uses the verified cooked yield (shown as a chip) so composer arithmetic reproduces the curated search numbers exactly — `scripts/verify-composer-equivalence.mjs` proves engine vs composer agree within 0.5 kcal for all 362 dishes.
- **The review flow shows what's inside a dish and lets you edit it.** Search → review for dish-KB items carries the per-serving ingredient breakdown and dish id into food-review, which renders "What's inside — per 40 g serving", a "Edit ingredients to your version" jump into the composer, and a piece-weight entry model: Quantity (how many) × grams-in-1-quantity × total grams, all synced (rotis are "2 × 40 g", not a bare gram count).
- **`data:build` order is honest.** `build.mjs` recreates nutrition.db and would wipe the supplemental tea/coffee rows that curate-drafts' id-validation requires; `build-sqlite.mjs` (which inserts them) now runs BEFORE the validation pass, so a fresh clone builds cleanly instead of relying on leftover DB state.
- **The app explains its own data.** Profile → "How food & dish data works" opens `app/data-methods.tsx`: sources (IFCT 542 / USDA 7,928 / dish KB 362), how ingredient amounts are counted, how the compose page builds My Version, and why a dish opens at 150 g (per-100 g basis × standard portion × actually-eaten grams).
- **The draft-graduation pass fixed every unverified draft recipe.** `tools/indian-dishes/curate-drafts.mjs` (wired into `npm run data:build`) graduates each `DRAFT_CURATED` record with: family priors adopted from the reviewed CURATED exemplars (verified amount fractions, cooked yields, standard portions, `assumptionClass: CURATED_PRIOR`), name-derived ingredient mappings ("Aloo Matar" → potato + peas via the corpus-validated pin list), and ~150 audited per-dish overrides (naan is maida, Butter Naan uses butter, sabudana is tapioca pearls, Kadhi is yogurt-based, biryanis carry their protein in the mix-in slot). 312/312 drafts graduated; the result ships as CURATED deterministic nutrition with zero drafts remaining. A per-dish report ships at `docs/data/indian-dishes.curation-report.json`.
- **Ingredient search resolves synonyms across databases.** `expandIngredientTerm` (in `apps/mobile/src/data/ingredient-options.ts`) expands a query with the dish-resolver alias table AND a bidirectional corpus-naming synonym list (curd ↔ yogurt, methi ↔ fenugreek, brinjal ↔ eggplant, besan ↔ chickpea flour, mutton ↔ goat meat, sabudana ↔ sago, …) and runs EVERY variant against every corpus (user foods + IFCT + USDA). Before this, common Indian kitchen words returned zero IFCT rows and the picker felt USDA-only. Regression-locked by `ingredient-options.test.ts` and a Playwright journey (methi → Fenugreek leaves, curd → USDA yogurt rows).
- **Genuinely-missing ingredients ship from a good database.** Plain tea and brewed coffee exist in NEITHER bundled corpus; `build-sqlite.mjs` now ensures two supplemental rows (`usda:SUP-TEA-001`, `usda:SUP-COF-001`) with USDA FoodData Central reference values in a dedicated `fdc_supplemental` source (7,928 → 7,930 foods). The `fdc_%` source pattern means the USDA source, resolver, and mapping loader treat them as ordinary `usda:` foods with zero special-casing.
- **Dish KB search rows show deterministic numbers.** `DishKBSource.search` computes (and memoizes) the same per-100 g nutrition `resolveById` uses, so every CURATED dish surfaces its real kcal in the search list instead of "Nutrition shown during review". Draft rows stay energyless by design — but there are no drafts left.
- Four QA rounds are closed with per-bug evidence: web P0 (WEB-001…011), product Section-B P0 (P0-1…6), Section-C P1 (P1-1…12), Section-D P2 (P2-1…18) — see `docs/qa/` and `VERIFICATION.md`. Do not re-report those findings as open without fresh evidence.
- The **Reliable Food Logging + Personal Food/Recipe Management** slice has been physically exercised on Android for review-before-save, historical dates, edit/delete/undo, repeats, custom foods, recipe logging/versioning, dirty-form protection, rapid-save protection, keyboard handling, and process-level persistence.
- Core nutrition writes use immutable snapshots and deterministic arithmetic rather than trusting model-generated calories/macros.
- The photo-scan perception stage runs the **prompt v1.3.0 honesty contract** end-to-end (scene-first meal identity, qualitative amounts, portion context, ranked uncertainties, one highest-impact clarifying question; the model never emits calories/grams as facts — ranges only), with live-probed behavior on thali and pizza fixtures against the owner's real reseller gateway.
- Any OpenAI-compatible reseller gateway works for every provider (model ids passed verbatim, honest key-redacted error snippets, empty/prose-200 fishing), and thinking-model output truncation self-heals via an output-budget escalation retry.
- The web export is sub-path aware (`EXPO_PUBLIC_WEB_BASE`) and deploys to GitHub Pages via `scripts/build-ghpages.sh` with the coi-serviceworker isolation shim; the live deployment is https://sobhnathxluffy.github.io/nut-ai/.

### 0.2 Known current shortcomings — do not silently relabel these as complete

#### Home / Food UX
- Wave 3 (UI/UX report Ch 7.1/8.2/8.3) landed the instrument pass: Home is a read surface with a slot-guide disclosure, tabular figures, macro stat rows, an explicit adaptive-target state machine, and pull-to-sync; Food is the write surface (no second DayTimeline), with one-tap repeat logging through the immutable-snapshot repeat path and working undo, a search-first food-search with the decomposer behind a clear door, a stepper food-review, and row-action meal-detail. Verify before re-reporting any of that as broken.
- Wave 5 closed the two named gaps here: previous-day navigation now has a dedicated day-detail view (`/day-detail`, DayStrip chips drill in with Home's selection synced, `nutai://day` alias, strict `?date=` parsing with an honest bad-date fallback), and recipe ingredient rows show per-ingredient contributed macros inline (editor live + stored list, one helper that reconciles with the engine at 1e-10). The v0.2.0 wave added the Home calorie-card close-bounce mechanism fix: `setExpanded` has exactly ONE writer, the spring is critically damped with overshoot clamping, and content re-measures can no longer restart the animation (regression-locked in `wave3-home.test.ts`) — the duplicate-press ROOT CAUSE stays INFERRED until the Samsung device pass, do not promote it to verified. Still open honestly: the 2026-09 owner-QA visual-hierarchy items (Home clutter, eaten-vs-remaining clarity, macro visibility in search/review/edit) — design work that automation has not replaced.
- Search is multi-source end to end: the merged candidate list shows user foods, dish KB, IFCT, USDA and Open Food Facts rows with source labels, per-source BM25 normalization keeps ranking fair, and the accept decision stays tier-gated (see §6.2).

Fixed by recent rounds — do not re-report without fresh evidence: repeat-meal reusing the prior timestamp (BUG-015, regression-locked), anonymous undo/redo labels (now contextual, see §8.5), the `Unconfirmed` pill clipping at 390 px, the report `$kg` template leak, duplicate same-day PR rows, unrounded kcal targets, fabricated composite-meal suggestions (now tap-gated), and the dish browser capping at 100 rows.

#### Indian Dish / Unknown Dish
- There are **362 canonical dish records: 362 CURATED, 0 DRAFT_CURATED** (draft-graduation pass, see §0.1).
- Owner QA round 2026-10-03 (commits `e430d90`, `e7e820e`, `2c97484`, `fc75b78`): the "shows ~10 of 362" dish-browser report traced to a stale on-device corpus that could never refresh — the artifact now ships a content-derived `corpus_revision` in its own `build_manifest` (mirrored into generated `apps/mobile/src/data/corpus-revision.ts`) and `openNutritionDb` force-reimports on mismatch; browser headline counts come from the artifact, not literals; every row states what its estimate is uncertain about; the fat clarification question reaches EVERY fat slot (was 2 of 11 labels); 251 model-only dishes render a "What this estimate is unsure about" disclosure; the used-vs-absorbed oil semantics (see §0.1) charge fried dishes the absorbed share; 9 duplicate-food recipes were re-reviewed (aloo tikki now has its besan binder, "aloo inside aloo" is gone) and `scripts/audit-duplicate-slots.mjs` hard-fails same-food-twice dishes in `npm run check`. Still NOT TESTED (device): the refreshed-corpus cold start on hardware.
- The dish KB still speaks honestly: graduated records carry `assumptionClass: CURATED_PRIOR` priors, `requiresHumanRecipeCalibration: true`, and uncertainty models — the numbers are reviewed family priors computed deterministically from verified corpus ingredients, not lab measurements. Do not upgrade them to `VERIFIED` without new evidence.
- The unknown-dish builder is now a genuine multi-ingredient decomposer (searchable cross-corpus ingredient picker, editable grams and oil, shared yield model, per-ingredient breakdown, custom-ingredient creation, save-to-foods). It is still an ESTIMATE built from user-selected ingredients — never call its output verified dish nutrition.
- The composer now asks the dish uncertainty model's own high-impact clarification questions inline (Wave 5A: a "Clarify this estimate" disclosure, chips from the model's options, a visible Skip; answers re-derive per-serving grams through the SAME builder and are never persisted to the dish record). Still minimal: the free-form decomposer's own uncertainty/provenance surface — the clarifications ride the dish-KB uncertainty models, not an ad-hoc composed dish. A clarified estimate is still a prior; never call it verified.
- Shipped by recent rounds: the KB builds into the bundled corpus behind an integrity gate, the resolver puts CURATED identities above generic corpora, the browser reaches all 362 dishes, household variants persist to the writable user DB (OPFS on web) AND are searchable/resolvable via `HouseholdDishSource`. Free-form "a + b + c" combo queries are tap-gated suggestions — nothing is composed until every component auto-accepts and the user confirms.

#### Training
- Training is **not complete** despite older planning documents claiming otherwise.
- The Exercise Library had a confirmed serious device bug (owner physical QA, 2026-09-14): 0 exercises shown for 10–15 seconds, then ~225 rows that could not be selected, with Done/Android Back failing and trapping the user. No commit since has targeted that path — re-verify against current main on device before planning fixes.
- Owner QA round 2026-10-03 fixed the Programs & Schedule "does nothing" report (commit `90cce29`): the editor stored calendar weekday indexes while `scheduledRoutine` reads cycle days, so nothing ever matched unless a program started on Sunday. The editor now converts weekdays↔cycle days at one boundary (`weekdayToCycleDay`/`cycleDayToWeekday`), programs are EDITABLE (`saveProgram(id)`), `programDayStatus` distinguishes before/rest/scheduled/finished, and the false "auto-launching" copy is replaced with an honest one-tap description — all node-locked in `routines.test.ts`. Still NOT TESTED (device): the actual Train-tab program journey on hardware.
- The v0.2.0 training cleanup is AUTOMATICALLY VERIFIED (node locks), not device-verified: the Routines Create/New focus-loop jitter was root-caused (unstable focus-effect callback identity) and fixed red-first (25 refires → 1, locked in `routines-screen.test.ts`); the routine editor ships real advanced controls (progression labels, superset chips, per-exercise context, schema-backed planned values) and EVERY editor exit runs the "Discard changes?" confirm — including the T5-fix2 closures of the last two unguarded paths: "Launch workout" on the saved rows and notification/deep-link navigation (consulting the editor's published dirty state, `src/ui/editor-dirty.ts`).
- Active workout, abandoned-workout recovery, history, unit handling, and the complete training journey still need a focused device verification pass. Rest-timer controls landed in the Section-D round (see §7.2). Wave 5B fixed the restored-backup boot crash (seedExercises id collision, regression-locked in node) and made the active-workout card event-driven (`onWorkoutsChanged`) — both are node-side proofs; the Exercise Library device re-verification above is still the open gate.

#### Progress / Reports / Check-ins
- Analytics code exists, but user-facing verification is incomplete.
- Charts may still have poor axes, misleading scale, weak touch interaction, and unclear sparse-data behavior.
- Weekly/monthly reports and check-in discovery/consistency still require physical and arithmetic verification.
- The Section-D round fixed the report-side QA findings (`$kg` template leak, duplicate same-day PR rows, unrounded kcal targets); chart/report device QA remains open.

#### Settings / Onboarding / Backup
- Settings/profile management is still minimal, but onboarding is no longer "partial": the stepwise rebuild (12 gated steps), the kill-safe draft resume, the post-onboarding tutorial and the independent height/weight units are implemented and AUTOMATICALLY VERIFIED (unit-locked suites + the Playwright walk). The device pass is still owed and stays open: the real hardware journey, TalkBack speech, 130% font-scale on the new screens. Do not assume any OTHER onboarding-era promise beyond these surfaces is wired.
- Destructive restore/reset flows must not be tested casually against the owner's active data.
- The Apple Health row is hidden on web (iOS-only); do not reintroduce platform-dead controls.

#### AI / Photo
- Provider credentials ARE configured for current QA: the owner uses an OpenAI-compatible reseller gateway (custom base URL + key), live-verified server-side on 2026-09-30.
- Photo recognition under the v1.3.0 honesty contract is **AUTOMATICALLY VERIFIED** in suites and **live-probed** against the real gateway (thali scene identity, pizza gram RANGE + highest-impact question, intrinsic-vs-added fat semantics). Browser-side scan behavior (gateway CORS from web origins) is **NOT TESTED**.
- Structural persistence for assistant routine proposals is now real and test-locked (`saveRoutine` throws on failure), so a fake "SAVED" can no longer occur on web; the assistant write path is e2e-locked on the WEB build (Wave 5B: route-mocked OpenAI-compatible gateway, confirm → persisted 359 kcal → undo, cancel, honest 500 failure, provider seeded through the app's own settings screen). Native paths (SecureStore, stack/modal dismissal) and any LIVE-provider behavior remain **NOT TESTED** (§9.1 — no real credentials involved anywhere in the e2e).
- The Codex CLI bridge (§0.1) is a LOCAL, owner-operated provider path: failure honesty is live-verified, success paths are NOT TESTED (no credentials). Never claim model routing, image understanding, or completions for it; never describe the bridge as anything but plain HTTP on a LAN the owner trusts.
- AI features must route through the same reviewed deterministic logging path as manual food entry.

#### Deferred physical checks
- Full hardware network isolation and full device reboot persistence are currently deferred because the phone supplies internet connectivity to the development environment.
- Process-level force-stop/relaunch is allowed and already used.
- Wave 4 device audit (owner pass, all currently NOT TESTED (device) — see docs/design-system.md §7): the 130% font-scale layout walk (Android Settings → Display → Font size max: Home hero ring card, macro stat rows, slot-guide disclosure, set-table cells/prev/set-number columns, rest chip, tab bar labels); `adb shell am start -a android.intent.action.VIEW -d "nutai://scan"` (and `nutai://log`) deep-link taps; a native rebuild after the reanimated removal (autolinking-only risk — zero source imports); visual/screen-reader check of the 8 Wave 4 glyphs and the 12px honesty/warning icons.
- Wave 5 device audit (owner pass, NOT TESTED (device) — full list in VERIFICATION.md's Wave 5 entry): native screen-reader speech of the new surfaces (clarification cards, meal-detail honesty captions, recipe contribution captions, day-detail); `nutai://day` ADB taps; the on-device ActiveWorkoutCard subscription; live-provider SSE dialects + native SecureStore (the write-path e2e is route-mocked); the new day-detail/clarification layouts join the 130% walk. The parallel browser-emulation specs close the browser-verifiable halves; the coordinator amends the final counts.

### 0.3 Current priority order

Unless the owner explicitly changes priority, prefer this order:

1. **Training core reliability** — re-verify the Exercise Library device findings against current main first (last reproduced 2026-09-14), then active-workout polish.
2. **Food product-quality gaps** — macro visibility, recipe ingredient contributions, Home/day navigation and visual hierarchy.
3. **Progress, analytics, reports, check-ins** with real data verification (report arithmetic/copy fixed in the P2 round; chart axes/touch still need device QA).
4. **Real Indian-dish workflow** — dish-specific ingredient/quantity editor with yield, fat, portions, provenance; the KB browse/compose path is shipped, semantic decomposition is not. Do not fake it.
5. **Settings, onboarding, backup/restore UX, global navigation, cross-app visual hierarchy**.
6. **AI assistant/text interpretation/photo integration** — provider credentials are configured and the v1.3.0 honesty contract is live-probed; the active task is browser-side scan validation (gateway CORS from web origins), then assistant read/write flows (AIP-005/006).
7. **Release-gate physical tests** — hardware network isolation, reboot persistence, golden-set accuracy, store submission (see VERIFICATION.md "What is NOT built").

Do not work from stale phase labels alone. Current user-visible evidence outranks an old “COMPLETE” row.

---

## 1. Source-of-Truth Precedence

When information conflicts, use this order:

1. **Explicit instructions from the project owner in the current task/conversation.**
2. **Current physically verified user/device behavior and reproducible bug reports.**
3. **Non-negotiable product decisions in the master-plan PDF and accepted planning decisions.**
4. **Task acceptance criteria / ADRs / data-license requirements.**
5. **Reproducible current repository behavior and automated tests.**
6. **PLAN.md / VERIFICATION.md / walkthrough.md.**
7. **README.md or other descriptive/marketing text.**

Important consequences:

- A green test cannot overrule a reproducible device bug.
- A stale planning row marked `COMPLETE` cannot overrule a broken user journey.
- README language is not proof of implementation.
- If two higher-level requirements genuinely conflict, stop and report the conflict rather than choosing whichever is easiest to code.

---

## 2. Repository Discipline

- **This monorepo is the product.** Do not create a replacement Expo app, demo app, alternate scaffold, or parallel rewrite unless the owner explicitly requests it.
- Run `git status --short` before editing and record the baseline.
- The worktree is intentionally dirty during development. Preserve unrelated edits.
- **Do not commit, push, reset, clean, rebase, rewrite history, or delete branches** unless explicitly approved.
- Do not mass-format unrelated files.
- Do not delete apparently unused code before finding all callers and understanding whether it is part of a pending flow.
- If an implementation task becomes blocked by a deeper issue, document the blocker. Do not opportunistically redesign half the app.

---

## 3. Evidence Language — Mandatory

Every important claim must use one of these evidence classes:

- **PHYSICALLY VERIFIED** — directly observed on the real device through the actual user path.
- **AUTOMATICALLY VERIFIED** — confirmed by a test, command, DB query, build tool, or deterministic artifact check.
- **CODE-INSPECTED** — supported by source inspection only.
- **INFERRED** — expected from architecture but not directly proven.
- **NOT TESTED** — no valid evidence.
- **DEFERRED** — intentionally postponed for a named reason.

Do not collapse these into a vague “PASS”.

### 3.1 Words that require explicit evidence

Do not use these casually:

- complete
- fully verified
- production-ready
- flawless
- robust
- guaranteed
- zero data loss
- safe
- all criteria met
- works offline

If you use one, state the evidence immediately.

### 3.2 Self-review is not independent verification

An agent that wrote a feature must not treat its own summary as final proof.

Preferred sequence:

1. implement
2. run targeted tests
3. run full gate
4. exercise the production path
5. attempt adversarial failure cases
6. have a separate reviewer/subagent inspect the result where practical

For every feature believed correct, ask:

> “What is one realistic way this could still be wrong?”

Attempt that case before declaring completion.

---

## 4. Subagent / Multi-Agent Protocol

If the environment supports subagents, use them to reduce context overload, not to create chaos.

### Good uses
- independent repository research
- training vs progress vs settings audits in parallel
- hostile review of an implementation
- targeted root-cause analysis
- device/logcat investigation separate from code inspection

### Rules
- The coordinator owns the final synthesis.
- Audit subagents should default to **read-only**.
- Do not have multiple editing agents change the same files concurrently unless isolated worktrees/branches are used.
- Give each subagent a narrow contract and required evidence format.
- Do not ask five subagents to “review the whole app”.
- Do not treat subagent agreement as proof; two models can confidently agree on the same false inference.
- Require subagents to report `PHYSICALLY VERIFIED / AUTOMATICALLY VERIFIED / CODE-INSPECTED / INFERRED / NOT TESTED`.

For large QA passes, prefer domain splits such as:

- Training + Exercise Library
- Progress + Analytics
- Reports + Check-ins
- Profile + Settings + Onboarding
- Global navigation + UI/UX + performance

---

## 5. Immutable Product Principles

1. **AI interprets; deterministic systems decide numbers.**
   - Models may identify foods, parse text, suggest components, or ask clarifying questions.
   - Models never own final calories, macros, micronutrients, PRs, report aggregates, target math, or historical facts.

2. **Unknown is not zero.**
   - Missing nutrient values remain unknown/null unless a source explicitly says zero.

3. **Historical records are stable.**
   - Log-time per-100g snapshots are immutable.
   - Recipe edits create versions.
   - Later corpus updates do not silently rewrite old meals.

4. **User control wins.**
   - Suggestions require review.
   - Writes are explicit.
   - Important mutations are undoable/auditable.

5. **Offline-first core.**
   - Search, food logging, custom foods, recipes, training, history, and deterministic analytics must not require a cloud model.
   - True hardware network isolation remains a release-gate test even when local code paths appear network-independent.

6. **Uncertainty is honest.**
   - A generic prior is not a measurement.
   - Model self-confidence is not calibrated probability.

7. **Conflicts are surfaced, not averaged away.**

8. **No single opaque health score.**
   - Prefer transparent metrics and reports.

9. **Nutrition + training are one product.**
   - Shared identity, timeline, history, settings, and future sync rules.

10. **Privacy by default.**
    - Photos local unless explicitly uploaded.
    - Strip EXIF/GPS before cloud use.
    - Never ship shared production provider secrets.

11. **Fast, calm interaction.**
    - No shame colors.
    - No manipulative streak UX.
    - Do not bury the primary daily action under developer/admin controls.

---

## 6. Nutrition and Food Rules

### 6.1 Source hierarchy and provenance

Every nutrition number must remain attributable to its source.

Prefer, in practical order:

1. exact packaged label / verified barcode
2. user-measured recipe / household recipe
3. curated Indian Dish KB recipe
4. authoritative composition data such as IFCT
5. official restaurant nutrition
6. Open Food Facts where license/provenance permits
7. USDA FoodData Central
8. generic prior / structured estimate
9. AI-only estimate only as an explicit last resort

Do not flatten source identity into an untraceable master table.

### 6.2 Search must not hide useful sources

This is now IMPLEMENTED, not just a requirement. The router fans out to every source and merges; it must stay that way — do not regress to “first source wins”:

- `RouterSource.search` queries all sources in parallel, caps each corpus at 15 rows, and merges in priority order (user foods 100 → household recipes 90 → household dishes 85 → IFCT 80 → dish KB 75 → USDA 70 → Open Food Facts 60).
- `normalizeBm25` normalizes WITHIN each source cohort — cross-corpus BM25 magnitudes must never be compared directly.
- The accept/decision step in `resolveByText` is gated to the highest-priority source tier present, so a generic USDA row still cannot out-decide a matching dish-KB identity or IFCT row (P0-2 contract, locked by `resolver.golden.test.ts`).
- `ResolveResult.topCandidates` carries the merged ranked list so UIs can show every database's matches even when one row auto-accepts.

A search result set can therefore include:
- IFCT
- USDA
- custom/user foods
- household recipes
- saved household ("My Version") dishes
- CURATED and draft Indian dishes
- packaged/barcode results

Ranking may prioritize, but it must not silently erase useful alternate sources.

### 6.3 Indian Dish KB status semantics

- `DRAFT_CURATED`: structured draft; **not trusted nutrition-ready**. (Currently zero — the graduation pass mapped every draft; new drafts would only appear if future seed additions are not curated by `curate-drafts.mjs`.)
- `CURATED`: meaningfully reviewed recipe structure/ingredients/ratios/yield/portion with honest provenance.
- `VERIFIED`: stricter evidence level; do not promote merely because IDs resolve or validators pass.

Current reality: 362 CURATED, 0 DRAFT_CURATED.

The KB ships inside `apps/mobile/assets/nutrition.db` via `npm run data:build`; `npm run indian-dishes:verify` fails if the bundled rows or the CURATED FTS probe are missing, and `npm run indian-dishes:verify-mappings` hard-fails if any mapped slot's food id stops resolving in the shipped corpora (plus label-based fat/protein sanity warnings). Household variants saved from the dish composer go to the writable user DB (OPFS on web), never the read-only corpus, and the per-100 g snapshot contract (`apps/mobile/src/data/dish-snapshot.ts`) must be preserved by any new write path. Household variants are searchable and resolvable through `HouseholdDishSource`, which requires each saved slot to carry both a food id and the user's confirmed grams.

### 6.4 Unknown-dish fallback

The fallback is deterministic estimation from user-selected ingredients. It is now a real multi-ingredient builder:

- any number of ingredients (`extraIngredients`), deduped by food id with grams summed
- a searchable ingredient picker spanning user foods + IFCT + USDA (`apps/mobile/src/data/ingredient-options.ts`)
- inline creation of missing ingredients on a per-100 g basis (`createIngredientFood`) — saved into the custom food DB and immediately searchable
- editable grams per ingredient, an editable oil amount, and the shared cooked-yield model (`resolveCookedYieldGrams`)
- a live per-ingredient kcal/P/C/F breakdown scaled to the requested portion (`ingredientBreakdown`)
- `userfood:` ids participate in the arithmetic exactly like corpus rows

Never describe its output as:
- semantic dish understanding
- mapped recipe decomposition from KB data
- verified Indian dish nutrition

It is an estimate the user composes and confirms. Still missing from the flow: uncertainty/provenance capture and high-impact clarification questions from the dish uncertainty models.

### 6.5 Food review UX

Before persistence, the user should be able to understand/review the important facts:
- food name
- source/provenance
- serving/count/grams
- calories
- protein/carbs/fat
- selected date
- meal slot
- important assumptions when relevant

Do not make calories the only visible nutrition signal while macros silently log in the background.

---

## 7. Training Rules

Training is currently a high-risk area. Do not rely on older `Phase 3 COMPLETE` language.

### 7.1 Exercise Library

A valid Exercise Library journey must prove:
- loading state is explicit
- 0 exercises is not rendered as a fake final state while loading
- rows become selectable
- selected exercises return to the correct origin
- Done/Confirm works
- Android Back works
- routine/program/workout contexts are preserved
- loading does not take an unexplained 10–15 seconds without feedback

### 7.2 Active workout

Verify the actual user flow:
- add exercise
- add/edit/complete set
- warmup vs working set
- RPE/RIR where supported
- duplicate/delete
- previous values
- rest timer
- background/force-stop recovery
- finish summary
- history persistence

Editing a completed set must not silently make it incomplete unless the user intentionally changes completion state.

Rest timer current state: the workout rest card exposes −15 s / +15 s / Skip, the chosen duration is remembered in `training.rest_seconds` (15–600 s) and passed per set for auto-rest, and 0 completed sets no longer auto-starts a rest. This is locked by `packages/training/src/rest-invariants.test.ts`; physical device verification of the full training journey is still pending.

### 7.3 Units

Canonical persisted load may remain kg, but display/input must respect the user's unit preference consistently across:
- workout entry
- previous sets
- history
- PRs
- strength charts
- reports
- equipment/plate tools

No scattered hardcoded `kg` labels.

### 7.4 Abandoned sessions

A stale active workout must not accumulate absurd duration forever.
Provide a clear recovery decision when required: resume, discard, or correct duration.

---

## 8. UI / UX Rules

Treat UI quality as product correctness, not decoration.

**Consume the design system — `docs/design-system.md` is the reference.** One primitive per family (Screen/Header, Button, Field ×2, Badge, ChipRow, ItemRow, Sheet/MenuSheet, Toast, Skeleton, Empty, ProgressRing, PressableFX, Disclosure, ConfidenceChip, Icon); every colour pair must pass `npm run check:contrast`; identity colours never sit in a `<Text>` style (use the `*Text` grade slots); new icons follow the in-house extension protocol (no lucide dependency); new UI dependencies require an ADR.

### 8.1 Visual hierarchy

- One obvious primary action per screen/state.
- Secondary actions should not compete equally with the main task.
- Avoid flat black-on-black layouts where cards/actions are visually indistinguishable.
- Use spacing, elevation/borders, typography, and restrained accent treatment to create hierarchy.
- Home should prioritize daily status, eaten/remaining nutrition, weight/check-in, and workout resume rather than duplicating full diary administration.

### 8.2 Navigation

- Back must always have a defined outcome.
- No trapped screens.
- `Done`, `Save`, `Finish`, `Cancel`, `Back`, and `Close` must have consistent meanings.
- Preserve route context such as selected day and active workout origin.
- A global search label must match what it actually searches.

### 8.3 Forms

- Preserve user input after validation failure.
- Intermediate numeric text (`""`, `"1."`) must not explode into NaN state.
- Dirty forms warn before destructive exit.
- Keyboard must not hide required controls.
- Rapid repeated taps must not create duplicate writes.

### 8.4 Feedback

Every async mutation needs clear states where relevant:
- idle
- pending
- success
- failure + retry

Never show “saved successfully” before the write actually succeeds.

### 8.5 Undo / redo

Contextual undo must target a known operation ID/scope.
The UI should tell the user what will be undone/redone, not just display anonymous “Undo” / “Redo”.

Current implementation: the Home day timeline fetches the live undo/redo targets and labels them (“Undo: delete meal”, “Redo: update day status”). Preserve this when touching undo surfaces.

### 8.6 Charts

Charts must not visually exaggerate tiny changes without context.
Use:
- understandable dates/axes
- sensible padding/domains
- visible gaps for missing periods
- practical touch/scrub regions
- accessible textual summaries
- correct unit formatting

Never use internal session IDs as user-facing time axes.

---

## 9. AI / Assistant / Photo Rules

### 9.1 No credentials means NOT TESTED

Current QA has no configured provider key. Do not mark cloud behavior PASS/FAIL from absence of credentials.

### 9.2 Structured observation only

For food photos/text, AI should produce structured observations/candidates, not authoritative nutrition numbers.

Expected high-level pipeline:

`text/photo -> structured interpretation -> resolver/dish KB/ingredient mapping -> clarification if valuable -> Food Review -> deterministic calculation -> explicit save`

### 9.3 Assistant writes

- Proposal generation is not persistence.
- A success message requires a completed write.
- Writes must be validated, awaited, idempotent where appropriate, and produce pending/saved/failed/cancelled states.
- Unsupported actions must be explicit rather than silently faked.

### 9.4 Photo privacy and durability

- Strip EXIF/GPS before cloud upload.
- Pending scan state that promises recovery must be durable, not memory-only.
- Retry must preserve capture mode and user corrections.
- No shared production API secret in app bundle.

---

## 10. Database and Persistence Safety

- Never edit the shipped v1 migration in `packages/db-adapter/src/schema.ts`.
- Add forward-only numbered migrations.
- Every new persistent table must be added to backup/export rules in FK-safe order and round-trip tested.
- Multi-step writes must be transactional.
- Undo/redo must preserve complete aggregates, including child rows and relevant ledger/provenance data.
- Do not use destructive `INSERT OR REPLACE` patterns when they can detach/delete related rows.
- Do not silently omit tables during restore.
- Legacy/malformed data must be deterministically repaired when allowed or rejected with a clear error.

---

## 11. Package Purity

- `packages/*` must remain React-Native-free and importable under bare Node.
- Expo/native adapters belong under `apps/mobile`.
- New shared packages must be included in `scripts/check-node-purity.mjs`.
- Preserve explicit `.js` package import specifiers where required by the current Node/Metro compatibility setup.
- The web build consumes the same packages through WASM SQLite (`apps/mobile/src/db/expo-adapter.web.ts`: OPFS VFS user DB, read-only deserialized corpora) and shared shims (`src/ui/alert-web.ts`, `credentials.web.ts`). Keep platform differences inside guarded adapters; never let a web-only branch change deterministic numbers.

---

## 12. Licensing and Data Governance

- Preserve AGPL-3.0-or-later and the existing §7 app-store permission.
- Track code and data licensing separately.
- Preserve IFCT attribution/provenance and adapter boundaries.
- Open Food Facts has separate ODbL/provenance obligations.
- Do not silently ingest new datasets without documenting license, attribution, version, build process, and redistribution constraints.

---

## 13. Testing Requirements

Every nontrivial implementation must add/update relevant tests.

Core commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run check:node-purity
npm run check:contrast
npm run data:verify
npm run ifct:verify
npm run indian-dishes:verify
npm run indian-dishes:verify-mappings
npm run check
```

Current reference baseline (T5-fix2 review-fix wrap, 2026-10-05, working tree on `e6e3274`):
- 161 Vitest files, 1,915 tests (the v0.3.0 owner-QA wave added schema v13 favorites-only, favorites search source, meal-detail macro totals, per-item assistant review, keyboard/inset locks, branded barcode corpus; dirty-guard on Launch + the handler's dirty consult, the widget publish seam on `overrideTargets`, the ft/in height clamp consistency, the health-step CTA guard)
- 19/19 node-pure shared packages
- Contrast gate passing (104/104 pairs, light 52 + dark 52, + 24 logged — includes the Wave 5C filled option-chip pairs)
- USDA golden-query gate passing (26/26, 7,930 foods)
- 542-row IFCT Table 1 corpus verification passing
- 362 Indian dishes: 362 CURATED, 0 DRAFT_CURATED (bundled + integrity-gated)
- 1,451/1,451 mapped dish slots resolve in the shipped corpus (mapping-verification gate, incl. graduation gates)
- Playwright web e2e: 46 passed / 0 skipped / 0 failed (BUG-007/009 ticketed skips closed; includes the stepwise-onboarding walk, the unit-independence journey, the day-detail + assistant-write specs and the browser-emulation specs), re-run at this tree
- The v0.2.0 wave's suites are inside the counts: `tools/codex-bridge` (36 tests), training-surface + routines-screen locks, notification handler/scheduler/categories/settings, the onboarding flow/screens pins, wave3-screens additions, widget publish/snapshot locks

If counts change, update PLAN.md and VERIFICATION.md after the full gate.

Web e2e (from `apps/mobile`):

```bash
npx expo export --platform web   # the suite serves apps/mobile/dist itself
npx playwright test
```

### Required test style by change

- schema/migration: migration tests from every shipped version affected
- deterministic math: unit + boundary tests
- numeric invariants: property tests where useful
- persistence: real repository/service path, not duplicated SQL in tests
- backup: export/import/rollback/legacy tests
- undo/redo: scoped operation tests with intervening unrelated actions
- UI: production-path tests plus real device acceptance where interaction matters
- performance-sensitive loading: timing/instrumentation plus device observation

---

## 14. Task Workflow

### 14.1 Before editing

1. Read this file.
2. `git status --short`.
3. Read PLAN.md and the assigned task/ADR.
4. Inspect current implementation and all relevant callers.
5. Reproduce the reported bug where possible.
6. Build an acceptance map before touching architecture.

### 14.2 Acceptance map

For each requirement identify:

| Requirement | User path | Writers/readers | Persistence/recovery | Automated evidence | Runtime evidence |
|---|---|---|---|---|---|

Look for bypasses:
- alternate write paths
- direct SQL
- stale UI state
- background/process recovery
- backup/restore
- undo/redo
- old migrations
- route context

### 14.3 Implement in dependency order

Prefer:

`schema/invariant -> domain API -> persistence -> all callers -> UI -> tests -> docs`

Do not start with cosmetic UI if the underlying contract is still wrong.

### 14.4 Verification layers

1. static inspection
2. focused tests
3. production-path integration tests
4. migration/recovery tests when relevant
5. full `npm run check`
6. `git diff --check`
7. `git status --short`
8. real-device acceptance where required
9. adversarial failure case

If runtime verification cannot be performed, mark it `NOT TESTED` or `DEFERRED`. Never infer it from compilation.

---

## 15. Completion Rules

Use task statuses truthfully:

- `unstarted`
- `ready`
- `in_progress`
- `blocked`
- `deferred`
- `complete`

A task may be `complete` only when every required acceptance criterion has valid evidence and there is no known contract gap.

### Never mark complete when:
- the main user journey is broken
- required device testing is pending
- a feature only exists as a route/component but is not reachable/usable
- tests pass but a reproducible physical bug remains
- a fallback is being mislabeled as the full feature
- the UI claims success before persistence
- the documentation disagrees with current behavior

When finishing a task, update:
- its task file
- `docs/tasks/TASK_INDEX.md`
- `PLAN.md`
- `VERIFICATION.md` where evidence changed
- README only if user-facing public claims changed

---

## 16. Documentation Rules

Documentation must distinguish:
- implemented
- automatically verified
- physically verified
- partially verified
- deferred
- not tested

Do not preserve stale test counts or stale “phase complete” claims.

README is public-facing and should be concise and honest.
PLAN is the current execution/status map.
VERIFICATION is evidence, not narrative optimism.
walkthrough.md is a specific user-flow verification artifact, not the global project status.
AGENTS.md is the binding engineering contract.

---

## 17. Physical Device Constraints for Current Development

Current primary device: Android Samsung Galaxy M14 5G.

Current constraint:
- the phone may provide internet connectivity to the development environment
- therefore do not disable connectivity or reboot it during an active tethered session unless the owner explicitly approves

Allowed:
- ADB inspection
- screenshots
- logcat
- `am force-stop`
- relaunch
- non-destructive database inspection
- normal user interaction

Destructive reset/import/uninstall requires explicit approval.

---

## 18. Commands Reference

```bash
# Baseline
npm install
npm run lint
npm run typecheck
npm run test
npm run check:node-purity
npm run check:contrast
npm run data:verify
npm run ifct:verify
npm run indian-dishes:verify
npm run indian-dishes:verify-mappings
npm run check

# Diff / state
git status --short
git diff --check

# Mobile
cd apps/mobile
npm run typecheck
npx expo run:android --variant release

# Web + e2e (from apps/mobile)
cd apps/mobile
npx expo export --platform web      # production web bundle into dist/
python3 scripts/serve-3000.py       # serve dist/ with COOP/COEP headers + SPA fallback
npx playwright test                 # e2e suite (serves dist/ via serve-3000.py)

# Existing native release build path may also use Gradle directly
cd apps/mobile/android
./gradlew assembleRelease
```

Use Java/Android environment settings already proven for this repository. Do not casually change Gradle/JDK configuration while solving an unrelated product bug.

---

## 19. What Never Ships

- shared production provider/API secrets in APK/web bundle/config
- user photos with EXIF/GPS sent to cloud
- unvalidated model/OCR output treated as trusted system data
- fake save confirmations
- missing nutrition silently converted to zero
- DRAFT_CURATED dishes presented as verified nutrition
- generic unknown-dish fallback presented as semantic decomposition
- opaque health score
- social feed / leaderboard / manipulative gamification
- destructive data migration without explicit versioned migration and recovery tests

---

## 20. Final Agent Checklist

Before ending an implementation task, answer all of these:

1. What exact user-visible problem did I solve?
2. What production path changed?
3. What data invariant could I have broken?
4. Did I inspect every real caller/writer?
5. What tests were added?
6. What full gates were run?
7. What was physically verified?
8. What remains only code-inspected/inferred?
9. What adversarial case did I try?
10. Did I introduce or preserve any false UI/documentation claim?
11. Did I leave unrelated dirty work untouched?
12. What is still NOT TESTED?

If the answer to #12 is non-empty, report it plainly.
