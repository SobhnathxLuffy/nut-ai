# PLAN.md — Current Nut AI Implementation Status

> **Last updated:** 2026-09-14
> **Evidence baseline:** 583 tests / 71 test files, 18/18 node-pure packages, USDA + IFCT + Indian-dish verification passing, Android food-flow device verification completed, owner manual QA in progress.
> **Worktree:** Dirty by design; substantial uncommitted implementation exists. Do not reset or clean it.

## 1. Executive Status

Nut AI has a strong technical foundation and a substantially improved food-logging stack, but the **whole application is not product-complete**.

The previous phase labels overstated completion in several places. Current status must follow actual user/device behavior, not historical milestone names.

### Overall

| Area | Current status | Notes |
|---|---|---|
| Foundation / DB / deterministic nutrition | **Strong / verified** | Strict TS, migrations, operations, SQLite, immutable nutrition snapshots, deterministic totals |
| Food logging core | **Strong / physically verified** | Search → Review → dated save → edit/delete/undo → persistence |
| Custom foods | **Strong / physically verified** | CRUD, validation, g/oz, Save & Log, dirty-state protection |
| Recipes | **Strong / physically verified** | Ingredient search, yield, servings, versioning, log via Food Review, delete/undo |
| Indian Dish KB | **Partial** | 50 CURATED, 312 DRAFT_CURATED; drafts are not nutrition-ready |
| Unknown dish fallback | **Partial / generic** | Manual deterministic estimate exists; real semantic dish decomposition does not |
| Home / Food UX | **Partial** | Clutter, weak hierarchy, repeat timestamp bug, source federation/macros visibility gaps |
| Training | **Broken in critical path** | Exercise Library currently traps/blocks workout selection on device |
| Progress / analytics | **Partial / incompletely verified** | Engines/screens exist; visual correctness and real-data QA still required |
| Weekly / monthly reports | **Implemented but partial** | Existing screens/aggregation need user/device verification and UX cleanup |
| Check-ins | **Implemented but partial** | Discoverability and consistency with reports require verification |
| Profile / Settings | **Partial** | Important profile/preferences workflows remain incomplete or unverified |
| Onboarding | **Partial** | Routes exist; persistence/promises/UX need dedicated pass |
| Backup/export | **Foundation exists** | Non-destructive export should be reverified; destructive restore deferred |
| AI assistant / semantic text | **Not currently verified** | No provider key configured in current QA; older fake-write behavior must not be assumed fixed |
| Photo AI | **Architecture exists, current cloud path not verified** | No provider key configured; local photo/privacy pipeline requires later acceptance pass |
| Cloud sync / web / health integrations / local AI | **Not built / deferred** | Not current priority |

---

## 2. Verified Automated Baseline

Latest verified gate:

- ESLint: clean, 0 errors/warnings
- TypeScript: strict, packages + mobile clean
- Vitest: **583 passed across 71 files**
- Node purity: **18/18** packages
- USDA `data:verify`: passing
- IFCT verification: **528-row Table 1 corpus** accepted
- Indian dishes: **362 total**, **50 CURATED**, **312 DRAFT_CURATED**
- `git diff --check`: clean for latest food slice

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

1. Home visual hierarchy is cluttered.
2. Eaten nutrition is not as clear as remaining nutrition.
3. Home lacks practical previous-day navigation while Food has it.
4. Repeat Meal appears to preserve the original meal timestamp instead of using the repeat time.
5. Day status text such as `Unconfirmed` wraps poorly.
6. Search/review/edit show calories more clearly than protein/carbs/fat.
7. Search appears to expose only one source family at a time; desired UX is a merged/ranked candidate set from IFCT, USDA, custom foods, recipes, and curated dishes.
8. Undo/Redo UI should identify the action being undone/redone.
9. Recipe ingredient rows should show nutrient contribution for the entered amount.

These are real product gaps. Do not mark the entire Food area complete until resolved or intentionally deferred.

---

## 4. Indian Dish KB / Unknown Dish Status

### Current corpus

- 362 canonical dish records
- 50 `CURATED`
- 312 `DRAFT_CURATED`

### What exists

- curated dish arithmetic through verified ingredient mappings/recipes where available
- draft dish discoverability with explicit untrusted/unavailable status
- a manual deterministic fallback using selected base ingredient + fat + cooking method + portion

### What does **not** exist yet

A real semantic dish-specific decomposition flow for arbitrary Indian foods.

Current owner QA demonstrated that an unknown query such as `litti chokha` can fall into the same generic selector used for unrelated foods. That fallback must not be described as mapped litti/chokha nutrition.

### Needed future work

- browseable Indian Dishes library
- clear curated vs draft status
- dish-specific aliases/components/templates
- editable ingredient list
- editable ingredient quantities
- fat quantities
- cooked yield / cooked mass
- portion strategy
- provenance and uncertainty
- household/custom variant save path
- later: AI/text/photo can propose structure, but deterministic engine remains source of numbers

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
- rest timer duration/adjustment/background expiry
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

### Slice 1 — Training Core Reliability **NEXT**

Fix Exercise Library loading/selection/navigation and restore a complete add-exercise path.

Then verify active workout basics.

### Slice 2 — Food Product Quality

- merged/ranked multi-source search results
- macro visibility in search/review/edit
- repeat timestamp
- Home previous-day navigation
- Home/Food visual hierarchy
- named undo/redo feedback
- recipe ingredient nutrient contributions

### Slice 3 — Indian Dish Workflow

- browseable dish library
- 50 curated vs 312 draft transparency
- real editable dish ingredients/quantities/yield/portion
- household variant path
- replace generic “decompose” illusion with honest generic fallback until dish-specific data exists

### Slice 4 — Training Completion

- active workout UX
- rest timer
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
