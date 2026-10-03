# PLAN.md — Current Nut AI Implementation Status

> **Last updated:** 2026-10-03
> **Evidence baseline:** 1,595 tests / 140 files, Playwright web e2e 36 passed / 0 skipped / 0 failed at `1eef079` (the parallel browser-emulation specs land separately), 19/19 node-pure packages, contrast gate 104/104 pairs (light 52 + dark 52), USDA (26/26, 7,930 foods) + IFCT (542 rows) + Indian-dish (362 CURATED, 1,451 slots) + dish-mapping (1,451/1,451 slots) verification passing, Android food-flow device verification completed, five QA/product rounds closed (web P0 WEB-001…011, product P0/P1/P2 Sections B/C/D, search+decompose round, draft-graduation round), UI/UX Waves 1–4 complete (design system gated + documented — docs/design-system.md), Wave 5 QA-completion closed (day-detail view, recipe contributions, composer clarifications, honesty persistence v12, event-driven workout card, assistant write-path e2e, protein-chip AA fix).
> **Worktree:** Waves 4a–4d + Wave 5A/5B are committed (`16809c2`…`0025f28`, `a06ad42`, `1eef079`); the Wave 5C wrap (protein-chip AA fix + this record refresh) sits uncommitted in the worktree. Preserve unrelated edits; do not reset or clean them.

## 1. Executive Status

Nut AI has a strong technical foundation and a substantially improved food-logging stack, but the **whole application is not product-complete**.

The previous phase labels overstated completion in several places. Current status must follow actual user/device behavior, not historical milestone names.

### Closed since the last plan revision (2026-09-14)

- **The web app is built and gated** — same Expo Router screens + deterministic engine, offline, with the user DB on OPFS, a DOM `Alert` shim, all four camera modes plus manual-GTIN entry, and a Playwright e2e suite run by GitHub Actions on every push.
- **Four QA rounds closed** (36 findings total): web P0 (WEB-001…011), product Section-B P0, Section-C P1, Section-D P2 — per-bug evidence in `docs/qa/`.
- **Indian Dish KB pipeline shipped** — 362 dishes bundled by `data:build` behind an integrity gate, ALL 362 records CURATED via the draft-graduation pass (`curate-drafts.mjs`: family priors + name-derived mappings + ~150 audited per-dish overrides), resolver ranks dish identities above generic corpora and shows their deterministic kcal in search rows, full dish browsing, household variants persisting to the writable user DB AND searchable/resolvable through `HouseholdDishSource`, tap-gated combo suggestions, synonym-expanded ingredient search (methi → fenugreek, curd → yogurt) across user foods + IFCT + USDA.
- **Multi-source search shipped** — one query merges rows from user foods, household recipes/dishes, dish KB, IFCT, USDA and Open Food Facts with per-source BM25 normalization and a tier-gated accept decision.
- **Food/Home fixes landed** — repeat-meal timestamp (BUG-015), contextual undo/redo labels, recoverable review dates, friendly workout validation errors, day-status wrap, report PR hygiene.

### Overall

| Area | Current status | Notes |
|---|---|---|
| Foundation / DB / deterministic nutrition | **Strong / verified** | Strict TS, migrations, operations, SQLite, immutable nutrition snapshots, deterministic totals |
| Food logging core | **Strong / physically verified** | Search → Review → dated save → edit/delete/undo → persistence |
| Custom foods | **Strong / physically verified** | CRUD, validation, g/oz, Save & Log, dirty-state protection |
| Recipes | **Strong / physically verified** | Ingredient search, yield, servings, versioning, log via Food Review, delete/undo |
| Indian Dish KB | **Partial / pipeline shipped + clarifications** | 362 dishes bundled + integrity-gated; browser reaches all; household variants persist AND are searchable; composer asks the uncertainty models' clarification questions (answers never persist); drafts still not nutrition-ready as-is (none left) |
| Unknown dish fallback | **Strong / deterministic** | Multi-ingredient decomposer: cross-corpus ingredient picker, editable grams/oil, shared yield model, per-ingredient breakdown, custom-ingredient creation, save-to-foods; still an estimate, not semantic KB nutrition |
| Home / Food UX | **Improved / two owner-QA gaps closed** | Wave 5: dedicated day-detail view (`/day-detail`, DayStrip drill-in with synced selection, `nutai://day`), recipe per-ingredient contributions, composer clarifications; the 2026-09 owner-QA visual-hierarchy items (clutter, eaten-vs-remaining, macro visibility) remain open |
| Training | **Partial / device verification outstanding** | Wave 5B: restored-backup boot crash (seedExercises id collision) fixed + regression-locked, active-workout card event-driven (`onWorkoutsChanged`); the Exercise Library 2026-09-14 device findings still need re-verification on current main before any fix work |
| Web app | **Built / automated-verified** | Offline Expo web build; OPFS user DB, DOM alert shim, camera modes + manual GTIN; Playwright e2e in CI; not yet device/browser-matrix QA'd |
| UI design system | **Strong / automated-verified; device a11y audit pending** | Waves 1–4 + 5C: tokens + 7-step type scale + the full primitive library gated (eslint hex/fontSize/tap-target, type-scale sweeps, Icon/Badge/ChipRow locks); contrast gate 104/104 pairs (the filled-chip deviation is closed and gate-locked); dynamic-type caps + Android TextInput scaling; `nutai://` deep links (incl. `day`); 64-glyph icon set, zero text glyphs; docs/design-system.md is the reference. NOT TESTED (device): 130% layout walk, deep-link ADB taps, native rebuild after reanimated removal, glyph/screen-reader rendering (browser-verifiable halves covered by the in-flight emulation specs) |
| Progress / analytics | **Partial / incompletely verified** | Engines/screens exist; visual correctness and real-data QA still required |
| Weekly / monthly reports | **Implemented, report math hardened** | `$kg` template leak, duplicate same-day PR rows, unrounded targets fixed in the P2 round; screens still need user/device verification |
| Check-ins | **Implemented but partial** | Discoverability and consistency with reports require verification |
| Profile / Settings | **Partial** | Important profile/preferences workflows remain incomplete or unverified |
| Onboarding | **Partial** | Routes exist; persistence/promises/UX need dedicated pass |
| Backup/export | **Foundation exists** | Non-destructive export should be reverified; destructive restore deferred |
| AI assistant / semantic text | **Write path e2e-locked (web build)** | Route-mocked OpenAI-compatible gateway: confirm → persisted 359 kcal → undo, cancel no-op, honest 500 failure; provider seeded through the app's settings screen; message dedupe + monotonic ids locked. Native paths + live-provider behavior NOT TESTED (AGENTS §9.1) |
| Photo AI | **Live-probed + honesty-contract verified; browser CORS open** | Provider credentials configured (AGENTS §0.2); v1.3.0 honesty contract live-probed (thali/pizza fixtures); browser-side scan (gateway CORS from web origins) NOT TESTED |
| Cloud sync / health integrations / local AI | **Not built / deferred** | Not current priority (web is built — see its row above) |

---

## 2. Verified Automated Baseline

Latest verified gate (Wave 5C wrap, 2026-10-03):

- ESLint: clean, 0 errors/warnings
- TypeScript: strict, packages + mobile clean
- Vitest: **1,595 passed across 140 files**
- Node purity: **19/19** packages
- Contrast gate (`check:contrast`): **104/104 pairs pass** (light 52, dark 52; 24 logged — includes the filled option-chip pairs)
- USDA `data:verify`: **26/26** golden queries passing
- IFCT verification: **542-row Table 1 corpus** accepted
- Indian dishes: **362 total, 362 CURATED, 0 DRAFT_CURATED** (draft-graduation pass), bundled + integrity-gated
- Dish mapping verification: **1,451/1,451** mapped slots resolve in the shipped corpus (1,070 IFCT + 381 USDA), 0 errors, graduation gates active
- Playwright web e2e: **36 passed / 0 skipped / 0 failed** at `1eef079` (exported bundle, CI on every push; includes the day-detail + assistant-write specs; the parallel browser-emulation specs land separately)
- `git diff --check`: clean

Run `npm run check` after every substantive implementation slice.

---

## 3. Current Food Slice — What Is Actually Done

### Physically verified on Android

- Food Search loading/ready/error lifecycle no longer silently hangs in the verified path.
- Selecting a food opens **Food Review** instead of immediately writing to the diary.
- Food Review supports serving/count/grams/date/meal slot and explicit Save/Cancel.
- Historical dates persist correctly after force-stop/relaunch.
- Meal Detail supports inspection, gram edits, name/date/slot edits, delete, contextual undo.
- Custom foods support list/search/create/edit/delete, validation, grams/ounces, Save & Log.
- Recipes support ingredient search, quantities, cooked yield, servings, versioned edits, logging via Food Review, delete/undo.
- Rapid multi-tap save protection works in tested flows.
- Dirty custom-food/recipe forms warn on Android Back/Cancel.
- Keyboard, long-name handling, accessibility labels, and dark theme were exercised in this slice.
- Process-level force-stop/relaunch preserves tested food data.

### Known remaining Food/Home issues from owner QA

Status after the 2026-09 QA rounds:

1. Home visual hierarchy is cluttered. — **OPEN**
2. Eaten nutrition is not as clear as remaining nutrition. — **OPEN**
3. Home lacks practical previous-day navigation while Food has it. — **DONE** (Wave 5A/B O4: `/day-detail` route with a strict `?date=` parser, DayStrip chips drill in with Home's selection synced, `nutai://day` alias; the BUG-007 e2e journey updated to the drill-in + back path)
4. Repeat Meal preserves the original meal timestamp. — **FIXED** (BUG-015; repeat time used; regression-locked in `repeat-logging.test.ts`)
5. Day status text such as `Unconfirmed` wraps poorly. — **FIXED** (2×2 wrapping grid at narrow widths)
6. Search/review/edit show calories more clearly than protein/carbs/fat. — **OPEN**
7. Search should offer a merged/ranked candidate set across sources. — **DONE** (`RouterSource` fan-out merge with per-source BM25 normalization, `ResolveResult.topCandidates`, tier-gated auto-accept; regression-locked in `multi-source.test.ts` and the multi-source e2e spec)
8. Undo/Redo UI should identify the action being undone/redone. — **FIXED** (live contextual labels, AGENTS §8.5)
9. Recipe ingredient rows should show nutrient contribution for the entered amount. — **DONE** (Wave 5A O3: per-ingredient `→ 170 kcal · 11.0g P · 30.0g C · 0.5g F` captions, live in the editor + stored-derived in the list; contributions reconcile with the engine totals at 1e-10, regression-locked)

These are real product gaps. Do not mark the entire Food area complete until resolved or intentionally deferred.

---

## 4. Indian Dish KB / Unknown Dish Status

### Current corpus

- 362 canonical dish records
- 50 `CURATED`
- 0 `DRAFT_CURATED` (312 graduated 2026-09-28; the graduation pass is part of `data:build`)

### What exists

- curated dish arithmetic through verified ingredient mappings/recipes where available
- draft dish discoverability with explicit untrusted/unavailable status
- a multi-ingredient deterministic decomposer: searchable cross-corpus ingredient picker (user foods + IFCT + USDA), editable grams per ingredient, editable oil amount, shared cooked-yield model, live per-ingredient kcal/P/C/F breakdown, inline custom-ingredient creation that saves into the searchable custom food DB
- draft-graduation pass (`tools/indian-dishes/curate-drafts.mjs`) + name-derived ingredient mappings from a corpus-validated pin list; supplemental USDA reference rows for plain tea and brewed coffee (the only ingredient words genuinely absent from both corpora)
- mapping integrity gate (`indian-dishes:verify-mappings`): every mapped slot resolves in the shipped corpora, with fat/protein label sanity checks

### What does **not** exist yet

The dish-KB composer now asks the uncertainty models' high-impact clarification
questions (Wave 5A — answers re-derive the estimate and are never persisted).
Still open: uncertainty/provenance capture inside the FREE-FORM decomposer — an
ad-hoc composed dish has no uncertainty model behind it.

The decomposer's output is an estimate the user composes and confirms — it must not be described as verified KB nutrition. Draft templates with generic slots still fail closed.

---

## 5. Critical Current Blocker — Training Exercise Library

Owner physical QA found the Exercise Library critically broken:

- initially displays 0 exercises / empty state for roughly 10–15 seconds
- later loads about 225 exercises
- loaded exercise rows cannot be selected
- Done does not complete selection
- Android Back does not leave the library
- user can become trapped and must kill/reopen the app

### Status

**Training is not complete.**

Evidence note: this report is from the 2026-09-14 owner device QA (pre-Section-B build). No commit since has touched the Exercise Library loading/selection path, so treat it as *reported, unverified on current main* until re-run on device — do not mark it fixed without that re-run, and do not plan around it as definitely still broken either.

### Next engineering slice

**Training Core Reliability: Exercise Library → Active Workout**

Required acceptance path:

`Train → Start/Resume Workout → Add Exercise → Library loads clearly → select exercise → return to workout → add/complete/edit sets → rest → background/force-stop recovery → Finish → History`

The first implementation task should fix loading, selection, origin context, Done, and Back before broad workout polish.

---

## 6. Remaining Training QA

Still requires focused physical verification/fixes:

- active workout set entry
- warmup vs working-set behavior
- editing a completed set
- duplicate/delete/undo
- previous values
- RPE/RIR / notes
- supersets/circuits
- rest timer background expiry (±15 s controls, remembered duration via `training.rest_seconds`, and no auto-start on an empty set list are implemented and unit-locked by `rest-invariants.test.ts`; background expiry still needs device QA)
- abandoned-workout recovery and duration correction
- finish summary
- PR/e1RM correctness
- history reopen/edit
- kg/lb consistency across training and strength views

---

## 7. Progress / Reports / Check-in

Implemented code/screens exist, but owner QA still needs to validate:

- Overview / Body / Nutrition / Strength / Training
- 7D / 30D / 3M / 6M / 1Y / ALL
- chart dates/axes/scale/gaps/touch targets
- sparse and one-point states
- nutrition eligibility/completeness logic
- strength e1RM / rep PR / warmup exclusion
- training frequency / muscle sets / duration
- weekly report current + previous week
- monthly current/previous/sparse month
- check-in discoverability and proposal confirmation
- report/check-in contract consistency

Do not add more charts until the existing records/actions are trustworthy and understandable.

---

## 8. Settings / Onboarding / Backup

### Settings/Profile

Need dedicated pass for:
- editable profile values
- units consistency
- goal editing
- diet preference
- provider/API settings
- theme / notifications
- platform-appropriate health integrations
- truthful connection status
- non-destructive profile editing vs destructive reset

### Onboarding

Need safe fresh-profile QA for:
- Back/Next
- resumable answers
- validation
- maintenance/cut/gain correctness
- truthful feature promises
- final idempotent persistence

### Backup

- export foundation exists
- secrets must remain excluded
- destructive restore must be tested only with explicit owner approval or isolated data

---

## 9. AI / Photo Status

Current QA has **no provider credentials configured**.

Therefore:

- cloud assistant inference: NOT TESTED
- semantic free-text food interpretation: NOT TESTED / incomplete unless proven locally
- photo recognition provider path: NOT TESTED
- model-specific accuracy/cost: NOT TESTED

When implemented/verified, all AI must route through:

`structured interpretation → resolver/dish/ingredient mapping → clarification → Food Review → deterministic totals → explicit save`

AI must never become the source of authoritative nutrition numbers.

---

## 10. Prioritized Implementation Roadmap

Closed while this roadmap has been in force (do not re-plan): web app + e2e CI, QA rounds web-P0 / B / C / D, rest-timer controls, contextual undo labels, dish-KB pipeline + browsing, tap-gated combos, recoverable dates, friendly workout errors, Wave 5 (day-detail view + DayStrip drill-in, recipe ingredient contributions, composer clarifications, honesty persistence v12, event-driven workout card + seedExercises crash fix, assistant message dedupe, assistant write-path e2e incl. BUG-007/009 ticket closure, protein-chip AA fix).

### Slice 1 — Training Core Reliability **NEXT**

Re-verify the Exercise Library on device against current main, then fix whatever reproduces. Restore a complete add-exercise path.

Then verify active workout basics.

### Slice 2 — Food Product Quality

- merged/ranked multi-source search results (recipes folded in; corpora + user foods + dish KB already reachable)
- macro visibility in search/review/edit — **still open** (owner-QA visual item)
- Home previous-day navigation — **DONE** (Wave 5 day-detail view)
- Home/Food visual hierarchy — **still open** (owner-QA visual item)
- recipe ingredient nutrient contributions — **DONE** (Wave 5 O3)

### Slice 3 — Indian Dish Workflow

- 50 curated vs 312 draft transparency (browse + compose paths shipped)
- real editable dish ingredients/quantities/yield/portion
- replace generic “decompose” illusion with honest generic fallback until dish-specific data exists

### Slice 4 — Training Completion

- active workout UX
- rest timer background expiry (controls + remembered duration shipped)
- abandoned-session recovery
- history
- units
- PR/e1RM acceptance

### Slice 5 — Progress / Reports / Check-ins

Verify and repair analytics, charts, navigation, and advice contracts with real DB comparisons.

### Slice 6 — Profile / Settings / Onboarding / Backup

Make setup and profile management truthful, persistent, and recoverable.

### Slice 7 — AI Assistant + Photo

Only after provider credentials are configured and deterministic review/logging contracts are stable.

### Slice 8 — Cross-App UI/UX / Release Polish

Consolidate hierarchy, navigation, error/loading/empty states, accessibility, performance, and release signing.

---

## 11. Deferred Release-Gate Tests

Due current tethering constraint:

- true hardware network isolation
- full phone reboot persistence

These remain required before a serious release claim.

Other later release work:
- proper release keystore/signing (current development APK has been verified with development/debug signing in prior audit)
- fresh install onboarding
- upgrade migration on a preserved populated database
- backup restore in isolated environment
- provider-key AI acceptance

---

## 12. Update Protocol

After each implementation slice:

1. run focused tests
2. run `npm run check`
3. run `git diff --check`
4. physically test required journeys
5. classify evidence as physical / automated / code-inspected / inferred / not tested / deferred
6. update this file only with proven status
7. update `VERIFICATION.md` with evidence, not optimism
8. update README only if public-facing capabilities changed
9. never mark a broad phase complete while a critical user path in that phase is reproducibly broken
