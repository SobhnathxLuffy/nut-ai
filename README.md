# Nut AI

An open-source AI photo calorie tracker that never shows a number it cannot justify.

Point your camera at a meal and get calories and macros — with an honest uncertainty range, the
assumptions it made shown as editable chips, and a correction flow that recomputes everything locally
and instantly. No subscription, no paywall, no account, no server.

<img src="docs/img/hero.png" alt="Nut AI home screen" width="320" />

> **Status: alpha.** The full loop works on iPhone, Android, and the web — scan, review, correct,
> log, track. On-device inference and the published accuracy numbers are still ahead. Expect sharp edges.
>
> The web app runs the same Expo Router code and the same deterministic engine; the web QA round
> that closed every P0 blocker (WEB-001 … WEB-011) is documented in
> [docs/qa/p0-web-fixes.md](docs/qa/p0-web-fixes.md) and [VERIFICATION.md](VERIFICATION.md).

## What works today

- **Photo scans** with your own AI key: the model identifies components (a burger comes back as
  patty, bun, and toppings — never one blob), the deterministic engine does every number, and each
  row shows its uncertainty band and where its data came from.
- **Four camera modes** — food photo, **barcode** (bundled-database hits cost nothing and never
  touch a model), **nutrition label** (transcribes the printed panel, refuses to guess a missing
  serving weight), and **receipt** (reads the line items, then fetches each item's published
  nutrition with the merchant as the brand).
- **India-first nutrition lookup** with the authorized IFCT 2017 Table 1 corpus bundled locally:
  528 Indian food rows, stable IFCT source codes, attribution, and USDA fallback.
- **Household recipes** with immutable versions, raw-to-cooked yield, oil/ghee accounting, and
  per-serving logging.
- **Web lookup for branded and restaurant food**: when the local database misses — or a logo in
  frame names a brand — one search against the provider's own tool transcribes the published
  nutrition facts, source URL attached. Menu ambiguity comes back as options that each carry their
  own macros, so answering "which sandwich?" is instant and free.
- **Fix Result**: describe what's wrong in a sentence; only what you mention changes.
- **A health score with a published formula** — fixed arithmetic over what you logged, reasons shown
  on tap, never an "AI" number.
- **Exercise logging** where Run and Weight lifting use MET × your body weight × minutes (no model),
  Describe is the one AI-estimated path and says so, and Manual is your number verbatim.
- **Adaptive targets** that re-derive from your weigh-in trend, with hand-set targets always
  respected.
- **Export / import**: one JSON file with everything; restore it from the first onboarding screen on
  a new phone. Your API key never travels in it.

---

## Why this exists

Photo calorie trackers converged on a bad pattern: show one confident number, hide the uncertainty, and
paywall the correction. The number is a guess — portion estimation alone carries 26–37%+ MAPE across
every published model — and presenting a guess as a fact is the actual product failure.

Nut AI is built around one rule:

> **The inference model never owns a number the user sees.**

The model is a perception device. It answers *what foods are here, what form are they in, how big
relative to what else is in frame, what reference objects are visible, what could I not see.* Then:

- **Grams** come from a deterministic reconciliation ladder — packaged label, discrete count, your
  personal prior, reference-object geometry, standard portion, and only last the model's own estimate.
  When the top two sources disagree by more than 35%, that becomes a *question*, not a blend.
- **Nutrition** comes from a real database row, snapshotted at log time and immutable thereafter.
- **Totals** are arithmetic.
- **Confidence** comes from measured per-category error against a kitchen-scale-weighed golden set —
  not from asking the model how sure it is.

Every consequence of that rule is a feature: corrections are free and offline, historical logs never
silently change, and the two worst bugs in this product category become structurally impossible.

## Two ways to run it

Chosen during onboarding, changeable any time, and presented neutrally:

- **Bring your own key** — your own Anthropic / OpenAI / Google key. Your photo goes to the provider you
  named and nowhere else. Typically well under a cent per scan.
- **On-device** — free, private, works on a plane. Accuracy is **unproven** and will be measured and
  published before it ships as a default.

Either way, barcode scanning, label OCR, text search, manual entry and the entire correction flow work
offline with no key at all.

## What we deliberately do not clone

No paywalled shutter button. No social feed. No streak-restore purchase. No opaque "AI health score".
No red numbers for missed goals — red is reserved for safety warnings, never for food or bodies.

## Repository layout

```
apps/mobile/      the Expo app — the ONLY package with React Native imports
packages/         pure TypeScript, importable under plain Node:
  core-schema     Zod source of truth for every payload shape
  gram-engine     the reconciliation ladder, densities, yields, oil absorption
  nutrition-sources  USDA, IFCT, user-food, recipe and Open Food Facts adapters
  resolver        food name → source-qualified database row
  totals          recompute, macro reconciliation, rounding
  confidence      measured bands, structural widening, per-meal quadrature
  repair          the question bank and expected-value gating
  goals           BMR/TDEE/macros, EWMA trend, adaptive TDEE
  prompt          system prompt, few-shots, prompt versioning
  db-adapter      one interface, two impls: expo-sqlite | better-sqlite3
  clamp           the deterministic sanity clamp
eval/             accuracy harness — imports the real engine, runs under Node
```

**`packages/*` must stay React-Native-free.** This is enforced by `npm run check:node-purity`, which
both scans for forbidden imports and actually imports every package under bare Node. It is not a style
rule: the accuracy harness has to run the *real* gram engine and resolver against the golden set. If
those become RN-only, the harness can only score raw model output — which measures the wrong thing,
because most of the accuracy lives between the model and the number.

## Put it on your phone

You build it yourself — that is the deal with an app that has no server, no account, and no store
listing taking a cut. One-time setup, ~20 minutes.

**iPhone** (needs a Mac with [Xcode](https://apps.apple.com/app/xcode/id497799835)):

```bash
git clone https://github.com/Blueturboguy07/nut-ai.git
cd nut-ai && npm install
npm run data:build                      # builds the bundled USDA nutrition database
cd apps/mobile && npm run prebuild      # generates the native project
open ios/NutAI.xcworkspace              # then: pick your phone, press Run (⌘R)
```

Xcode will ask you to pick a signing team the first time — your free Apple ID works (apps signed
this way re-install every 7 days; a $99/yr developer account removes that limit).

**Android** (any computer with [Android Studio](https://developer.android.com/studio)'s SDK):

```bash
git clone https://github.com/Blueturboguy07/nut-ai.git
cd nut-ai && npm install
npm run data:build
cd apps/mobile && npx expo run:android --variant release   # phone plugged in, USB debugging on
```

Photo scans use your own AI key (Anthropic, OpenAI, or Google), added during onboarding or later in
Profile — typically well under a cent per scan, and the app works without one for barcode, label,
search and manual logging.

## Your data stays yours

- Everything lives in a local SQLite database on the phone. **App updates never touch it**, on
  either platform. The only thing that deletes it is you: "Start over" in Profile, or uninstalling
  the app.
- **Export data** in Profile writes one JSON file with every meal, weight, workout, goal and
  setting. **Restore from a backup** on the first onboarding screen (or Import in Profile) brings
  it all back — that is the move-to-a-new-phone path.
- Your API key is the one thing a backup never contains: keys live in the OS Keychain/Keystore,
  out-of-band from your data, and are never written to any file. Re-enter the key once after a
  restore.

## Development

Requires Node ≥ 20.19.

```bash
npm install
npm run check        # lint + typecheck + tests + node-purity + USDA/IFCT data checks
```

**Expo Go is not a supported development mode.** The camera, SQLite, Keychain key storage, HealthKit,
and file export/import all require a compiled app — build with Xcode or `expo run:android` as shown
above.

## Planning and Agent Workflow

- [AGENTS.md](AGENTS.md) defines the binding implementation rules for coding agents.
- [PLAN.md](PLAN.md) records the current planning status, next task, blockers, and validation commands.
- [docs/planning/00_INDEX.md](docs/planning/00_INDEX.md) links the implementation-grade product plan, ADRs, task backlog, traceability matrix, and release gates.
- [docs/qa/p0-web-fixes.md](docs/qa/p0-web-fixes.md) records the web QA round and the closing evidence for every web P0 (WEB-001 … WEB-011).

## Licensing

Application code is **AGPL-3.0-or-later**, with a GNU AGPL §7 additional permission allowing
distribution through app stores — see [`LICENSE`](LICENSE). Without that grant, App Store distribution
would conflict with the AGPL.

The bundled nutrition database is a **separate work under separate terms** (CC0, ODbL, CC BY 4.0, OGL
v3.0 depending on the source) — see `THIRD-PARTY-DATA.md`. Data licenses and code licenses are legally
independent; neither discharges the other.

## Medical disclaimer

Nut AI's estimates are AI-generated approximations and may not be accurate. Nut AI is not a medical
device and does not diagnose, treat, cure, or prevent any medical condition. It is not a substitute for
professional nutritional or medical guidance — consult a registered dietitian or healthcare provider for
personalized advice.

# QA TESTING PROMPT FOR AI TO USE
You are the FINAL DEEP PRODUCT QA AUDITOR for Nut AI.

This is a serious full-product audit.

I am spending limited high-value model credits on this pass, so do NOT waste them on:
- architecture planning
- generic advice
- restating obvious code structure
- repeating existing documentation
- shallow happy-path testing
- screenshot spam
- prematurely fixing bugs before completing discovery

Your job is to FIND EVERYTHING WRONG WITH THE CURRENT PRODUCT.

That includes:

- functional bugs
- data bugs
- persistence bugs
- incorrect calculations
- misleading calculations
- false success states
- broken navigation
- missing expected actions
- incomplete workflows
- inconsistent behavior
- bad UX
- confusing terminology
- dead ends
- accessibility problems
- responsive-layout problems
- browser-specific problems
- mobile-parity problems
- state-loss problems
- race conditions
- duplicate writes
- invalid validation
- missing error states
- bad empty states
- bad loading states
- stale state
- weird edge cases
- performance issues
- security problems
- poor discoverability
- incomplete features
- features that technically work but are badly designed
- anything that makes the product feel unfinished

Do not restrict QA to crashes.

A feature can be a bug even if it "works" technically but provides bad/misleading UX.

==================================================
CORE CONTEXT
==================================================

Nut AI is an India-first, offline-first nutrition + strength-training application.

The Web app now uses the SAME Expo Router application and mostly the SAME screen/component code as mobile.

The Web build is NOT a separate simplified demo.

Core domain/business logic is shared.

This means Web QA is intended to reveal a large majority of bugs that likely affect the mobile product too.

However, do NOT claim that Web testing verifies native-only Android behavior.

Some behaviors still require physical Android acceptance later:
- hardware Back
- Android process death
- actual SecureStore
- haptics
- Android notification behavior
- true background execution
- camera hardware behavior
- Android filesystem/media permissions
- actual device performance

==================================================
KNOWN CURRENT BUG
==================================================

There is already one confirmed problem:

SETTINGS / PROFILE:

"Start onboarding again"

currently does NOT work.

You MUST:

1. reproduce it
2. determine what actually happens
3. determine what should happen
4. determine whether the route/action is dead, broken, disabled, or silently failing
5. inspect related onboarding/reset/restart flows
6. inspect whether it risks wiping data unexpectedly
7. classify severity
8. include it in final backlog

Do NOT silently fix it during discovery.

==================================================
IMPORTANT PRODUCT PRINCIPLES
==================================================

Preserve these when judging correctness.

--------------------------------
FOOD / NUTRITION
--------------------------------

AI interprets.
Deterministic code calculates.

AI must NOT own authoritative calories/macros.

Nutrition must come from deterministic sources such as:
- IFCT
- USDA
- user-defined food
- recipe snapshots
- household dish composition
- other trusted source records

Unknown nutrient != zero.

Unknown ingredient != zero.

Historical logs must remain immutable.

Editing upstream food/recipe/dish data must not rewrite old logged nutrition.

Food Review is the trusted review/save boundary for meal logging where appropriate.

--------------------------------
INDIAN DISHES
--------------------------------

There are approximately:

362 canonical Indian dish identities

with states such as:
- CURATED
- DRAFT_CURATED
- HOUSEHOLD / MY VERSION

Curated and draft must NOT be visually or semantically equivalent.

Draft dishes must not fabricate trusted nutrition.

Unknown dishes must not receive unrelated generic templates.

A household recipe must not overwrite the canonical dish definition.

--------------------------------
TRAINING
--------------------------------

Completed set edits must preserve completion unless the user explicitly marks the set incomplete.

Editing:
- load
- reps
- RPE
- RIR
- notes
- tempo
- kind/type

must not silently clear completed_at.

Training calculations must remain consistent:
- working set count
- volume
- heaviest set
- e1RM
- PR state

--------------------------------
ASSISTANT
--------------------------------

Assistant must not claim successful persistence before the real repository write succeeds.

Meal Assistant proposals should use Food Review where review is required.

Proposal states should honestly represent reality:
- PROPOSED
- PENDING
- SAVED
- FAILED
- CANCELLED

No fake success.

--------------------------------
DATES
--------------------------------

The product uses local calendar semantics.

Check:
- today
- yesterday
- Monday/Sunday boundaries
- this week
- last week
- month boundary
- year boundary
- leap day
- timezone behavior

==================================================
AUDIT RULES
==================================================

READ AGENTS.md FIRST.

Do not commit.
Do not push.
Do not reset.
Do not clean the worktree.

During the PRIMARY DISCOVERY PASS:

DO NOT MODIFY PRODUCT CODE.

You may create temporary QA scripts/test fixtures outside production paths if needed.

Do not fix bugs during discovery.

We want ONE COMPLETE BACKLOG first.

==================================================
EVIDENCE DISCIPLINE
==================================================

Use these evidence classes:

[AUTOMATICALLY VERIFIED]
Observed through browser automation/tests/repository/database assertions.

[CODE-INSPECTED]
Confirmed by source inspection.

[INFERRED]
Logical conclusion but not directly executed.

[NOT TESTED]
Explicitly not tested.

Do NOT call browser automation:
PHYSICALLY VERIFIED.

Reserve that term for actual physical device tests.

==================================================
QA STRATEGY
==================================================

Use Playwright/browser automation aggressively.

Prefer:

- role selectors
- labels
- accessibility selectors
- testIDs
- direct DOM assertions
- direct route checks
- input state
- repository/database verification
- browser console logs
- deterministic calculations

Avoid coordinate clicking unless absolutely necessary.

Do not take screenshots after every action.

Capture screenshots only when:

- layout is wrong
- visual hierarchy is questionable
- responsive behavior is broken
- chart rendering is wrong
- clipping/wrapping occurs
- modal positioning is wrong
- a bug needs visual evidence

Use screenshots as evidence, not as the primary testing mechanism.

==================================================
PHASE 0 — BASELINE
==================================================

Before testing:

1. Read AGENTS.md
2. git status --short
3. git diff --check
4. npm run check
5. record:
   - exact test file count
   - exact test count
   - existing failures if any
   - Web build status
   - current browser
   - current Web URL
   - existing stored test data

Do not alter existing user/project data unnecessarily.

Where destructive testing is required, use isolated test records or a test DB/profile.

==================================================
PHASE 1 — COMPLETE ROUTE INVENTORY
==================================================

Inspect:

apps/mobile/app

and the actual running UI.

Build a map of EVERY production-reachable route.

Include:

- tab routes
- nested screens
- modals
- onboarding routes
- reports
- editor screens
- scanner/camera flows
- Assistant
- profile/settings
- legacy/dead routes if discovered

For each route note:

- reachable?
- from where?
- user purpose
- primary actions
- back/cancel/done behavior
- data read
- data write
- obvious dead ends

Then use this route inventory to ensure no major area is skipped.

==================================================
PHASE 2 — FIRST-TIME USER / ONBOARDING
==================================================

This needs deep testing.

Test the full onboarding flow from a clean test state if safe.

Inspect every step.

Check:

- wording
- progress indication
- Back behavior
- Skip behavior
- required vs optional fields
- units
- weight
- height
- sex/gender fields if present
- birthday/age
- activity
- calorie targets
- macro targets
- dietary preferences
- training preferences
- goals
- API/provider setup if present
- permissions
- final completion

Try invalid input.

Try:

- blank values
- zero values
- huge numbers
- negative numbers
- weird decimal formats
- accidental double-click
- Back after entering data
- reload halfway through onboarding
- browser close/reopen halfway
- direct navigation to later step
- finishing twice

Check whether onboarding state is:
- persisted
- lost
- partially saved
- incorrectly marked complete

CRITICAL KNOWN BUG:

Profile/Settings
→ "Start onboarding again"

is currently broken.

Reproduce and deeply inspect.

Check:
- button click
- route transition
- console
- state mutation
- onboarding completion flag
- whether data is cleared
- whether data SHOULD be cleared
- whether button implies reset or merely rerun
- whether previous user data survives
- whether returning to onboarding causes destructive behavior

Decide what expected UX should be based on current product semantics.

Also inspect similarly named controls:
- reset everything
- redo onboarding
- edit profile
- change goals
- wipe data

Ensure wording clearly distinguishes destructive from non-destructive operations.

==================================================
PHASE 3 — HOME DASHBOARD
==================================================

Audit the Home screen as a real user.

Inspect:

- calories eaten
- calories remaining
- macros
- macro targets
- date
- timeline
- recent meals
- weight/check-in entry
- active workout/resume
- streaks
- shortcuts
- day navigation
- previous/future dates

Known prior concerns to re-check:

- clutter
- weak hierarchy
- too much flat black UI
- meal placement
- historical days
- Monday/day navigation
- wrapping text such as "Unconfirmed"
- repeat meal using wrong/original timestamp
- useful priorities being buried

Test:

- empty day
- partially logged day
- very full day
- many meals
- long food names
- no targets
- target changes
- different date
- yesterday
- future day if permitted
- active workout
- no workout

Check consistency with Food tab totals.

Home and Food must not disagree about:
- kcal
- protein
- carbs
- fat
- logged meals
- date

==================================================
PHASE 4 — FOOD SEARCH
==================================================

Test food search aggressively.

Queries:

rice
white rice
brown rice
roti
chapati
egg
milk
paneer
chicken
banana
apple
dal
rajma
idli
dosa
poha
upma
litti
litti chokha
aloo paratha
biryani
random nonsense
partial words
typos

Check:

- search latency
- source merging
- source labeling
- duplicate results
- IFCT results
- USDA results
- custom foods
- recipes
- Indian Dish matches
- recent foods
- favorites/saved foods if present

Known previous problem:
search returned one source instead of useful merged results.

Determine current behavior.

Look for:
- wrong food mappings
- wrong aliases
- unrelated fuzzy matches
- duplicate entries
- stale query results
- race conditions from rapid typing
- empty loading flashes
- "no results" before load finishes

Test rapid query changes.

Test clear query.

Test very long query.

Check keyboard focus and Enter behavior.

==================================================
PHASE 5 — FOOD REVIEW
==================================================

This is a critical trust boundary.

Test:

- selected food identity
- source/provenance
- grams
- servings
- serving unit
- date
- meal slot
- nutrition calculation
- Save
- Cancel
- Back
- duplicate save prevention

Try:

- 0 grams
- negative grams
- huge grams
- decimals
- blank field
- non-numeric text
- changing serving then grams
- switching date
- switching meal slot
- double-click Save
- Back during Save
- reload before Save

Verify the resulting DB row.

Ensure:
- nutrition snapshots are immutable
- logged date is correct
- slot is correct
- source is preserved
- no unintended duplicates

==================================================
PHASE 6 — HISTORICAL FOOD LOGGING
==================================================

Test logging to:

- today
- yesterday
- previous week
- previous month
- Dec 31
- Jan 1
- leap day where deterministic date fixtures permit

Then inspect:

- Food tab
- Home
- Reports
- Assistant reads

All must attribute the log to the same date.

Look for UTC/local-time shifting.

==================================================
PHASE 7 — RECENT / REPEAT MEAL
==================================================

Test repeating an existing meal.

Verify:
- food/component snapshot
- new date
- new time if time is modeled
- meal slot
- provenance
- quantities

Known old concern:
repeat meal reused original timestamp.

Determine current behavior.

Double-click repeat.

Repeat old historical meal today.

Repeat into another slot.

==================================================
PHASE 8 — MEAL DETAIL / EDIT / DELETE
==================================================

Open logged meals.

Test:

- inspect
- edit quantity
- edit date
- edit slot
- delete
- undo
- redo
- Back
- reload after edits

Verify arithmetic after edit.

Verify deletion does not delete unrelated items.

Verify undo text clearly identifies what will be undone.

Check old concern:
generic "Undo/Redo" lacking action context.

==================================================
PHASE 9 — CUSTOM FOODS
==================================================

Test full CRUD.

Create:

- normal custom food
- duplicate name
- blank name
- long name
- zero calorie food
- missing optional nutrients
- grams and ounces if supported

Test:
- Save
- Save & Log
- search
- edit
- soft delete
- restore if supported
- log
- historical immutability after editing source food

Test browser reload.

Ensure old logs don't change when custom food changes.

==================================================
PHASE 10 — RECIPES
==================================================

Test:

create recipe
add ingredient
search ingredient
change quantity
remove ingredient
change servings
change yield
save
edit
delete
undo if supported
reuse
log through Food Review

Check each ingredient contribution.

Known desired behavior:
ingredient editor should show useful kcal/P/C/F contribution.

Determine whether it does.

Test:
- empty recipe
- one ingredient
- many ingredients
- duplicate ingredient
- missing nutrient ingredient
- huge yield
- zero servings
- fractional servings

Check versioning.

Edit recipe after logging it.

Old historical meal must remain unchanged.

==================================================
PHASE 11 — INDIAN DISHES LIBRARY
==================================================

Deep audit.

Verify displayed canonical count.

Expected roughly:
362 identities

Check filters:
- All
- Curated
- Draft / Needs Review
- My Version / Household

Verify counts if shown.

Search:

litti chokha
aloo gobi
aloo paratha
idli
rajma chawal
chole bhature
biryani

Check:
- aliases
- regions
- category
- status label
- visual distinction
- trusted vs untrusted messaging

A Draft dish must NOT look equally trustworthy as Curated.

==================================================
PHASE 12 — DISH COMPOSER
==================================================

This is one of the most important semantic QA areas.

Test CURATED dishes.

Inspect whether components are genuinely dish-specific.

Specifically:

Aloo Paratha

Verify it actually contains defining potato filling or appropriate equivalent composition.

If a supposedly CURATED dish lacks defining components, report it.

Test DRAFT dishes.

Aloo Gobi:
- must not fabricate trusted nutrition
- unresolved ingredients must remain unresolved
- partial resolved ingredients must not produce a misleading complete total

Test Litti Chokha specifically.

The old system produced unrelated generic ingredients.

Verify there is NO:
- bottle gourd/lauki nonsense
- unrelated generic gravy template
- universal fake base ingredient

Test:

add ingredient
remove ingredient
replace ingredient
search IFCT
search USDA if supported
grams
count/unit
fat
yield
water
final weight
servings
portion

Check deterministic contribution per ingredient:
- kcal
- P
- C
- F

Check total arithmetic independently.

If required ingredients remain unresolved:
total should clearly remain incomplete or partial.

Unknown != zero.

==================================================
PHASE 13 — HOUSEHOLD / MY VERSION
==================================================

Create household variants.

Verify:

- canonical record unchanged
- household variant separate
- correct name/status
- version persistence
- edit
- reload
- log
- historical immutability

Create multiple variants.

Check duplicate naming.

Check deleting household version.

Check whether logs survive deletion.

==================================================
PHASE 14 — CAMERA / WEB UPLOAD
==================================================

Web uses browser image upload/capture fallback.

Test:

- route opens
- choose image
- cancel file picker
- unsupported file
- large image
- invalid file
- retry

Do NOT claim physical camera parity.

Inspect only Web upload behavior.

If inference provider unavailable:
ensure honest failure/manual fallback.

No fake AI output.

==================================================
PHASE 15 — ASSISTANT UI
==================================================

Test Assistant screen even without cloud key.

Inspect:

- empty state
- messages
- proposal cards
- failure states
- retry
- cancellation
- scrolling
- long responses
- input
- keyboard
- repeated send
- disabled buttons
- provider missing state

Deterministic fixture proposals should be tested.

==================================================
PHASE 16 — ASSISTANT WRITE SAFETY
==================================================

Test fixture meal proposal lifecycle.

Expected:

PROPOSED
→ review action
→ Food Review opens
→ NOT SAVED YET
→ explicit Save
→ repository succeeds
→ SAVED

Test:

Cancel Food Review
→ must NOT claim SAVED

Simulated write failure
→ FAILED

Retry
→ success or useful failure

Double-confirm
→ one write

Double-Save
→ one meal

Check exact diary/database state.

==================================================
PHASE 17 — ASSISTANT READ QUERIES
==================================================

Test deterministic read queries where supported:

"What did I eat today?"
"Yesterday?"
"How much protein today?"
"This week?"
"Last week?"
"Last workout?"

Seed known values and independently calculate answers.

Test:
- Monday
- Sunday
- month boundary
- year boundary
- leap day

Last workout must read actual strength workout records.

No legacy exercise_entries nonsense.

==================================================
PHASE 18 — TRAIN DASHBOARD
==================================================

Audit:

- Quick Workout
- routines
- programs
- workout history
- Exercise Library
- active workout resume
- empty states
- shortcuts
- discoverability

Look for:
- duplicate buttons
- unclear hierarchy
- dead-end cards
- wording inconsistencies

==================================================
PHASE 19 — EXERCISE LIBRARY
==================================================

Test:

load
search
filters
custom exercises
exercise detail
Back
clear query
rapid query changes

Search:

bench
squat
curl
press
deadlift

Verify search remains responsive.

Check default list.

Check complete exercise corpus.

No fake 0 results during initialization.

==================================================
PHASE 20 — EXERCISE DETAIL
==================================================

Test context-sensitive actions.

No active workout:
- Start Quick Workout
- Add to Routine

Active workout:
- Add to Active Workout
- Add to Routine

Check routine chooser.

Check Create New Routine pre-seed.

Check duplicates.

Check rapid tapping.

Check Back/Cancel.

==================================================
PHASE 21 — CUSTOM EXERCISES
==================================================

Create custom exercise.

Test:
- name
- tracking type
- muscles
- equipment
- save
- search
- use in workout
- use in routine
- edit
- delete if supported
- persistence

Ensure Exercise Library cache updates immediately.

==================================================
PHASE 22 — QUICK WORKOUT
==================================================

Create a fresh workout.

Test:

add exercise
remove exercise
replace exercise
duplicate exercise
reorder if supported

Create sets:
- warmup
- normal
- failure/other kinds if available

Fields:
- load
- reps
- RPE
- RIR
- tempo
- notes

Test invalid values.

==================================================
PHASE 23 — COMPLETED SET INVARIANT
==================================================

Required adversarial flow:

1. Create Bench Press set
2. 40 kg × 8
3. Complete
4. Record completed state
5. Edit to 42.5 kg
6. Verify still complete
7. Edit reps to 7
8. still complete
9. edit RPE
10. still complete
11. edit RIR
12. still complete
13. edit notes
14. still complete
15. undo
16. redo
17. still coherent
18. explicit uncomplete
19. ONLY NOW completion may clear

Verify database.

==================================================
PHASE 24 — TRAINING ANALYTICS
==================================================

Independently compute:

volume
heaviest working set
e1RM

Example:

40 × 8

Epley:
40 × (1 + 8/30)

Then edit to:
42.5 × 7

Verify UI/history updates.

Check PRs.

Warmup must not contaminate working-set metrics where inappropriate.

==================================================
PHASE 25 — REST TIMER
==================================================

Audit current implementation.

Check:

- default duration
- auto start
- skip
- add/subtract time if available
- per-exercise setting
- completion state
- multiple timers
- navigation away
- browser background tab
- resume

Look for missing features too.

Prior product concerns included:
- fixed 90s timer
- missing ±15 sec
- no per-exercise rest
- weak completion feedback

Determine CURRENT behavior.

==================================================
PHASE 26 — ROUTINES
==================================================

Test:

create
name
notes/settings
Add Exercises
search
multi-select
selected state
search while selections retained
confirm selection
remove
duplicates
save
reopen
edit
delete

Use:
bench
squat
curl

Create custom exercise and include it.

Check duplicate-add protection.

Check preserving routine title/settings while opening picker.

==================================================
PHASE 27 — PROGRAMS
==================================================

Exercise every currently reachable Programs feature.

Determine what Programs currently actually do.

Test:
- create
- edit
- assign routines
- schedule
- delete
- navigation
- persistence

Do not complain about features that never existed unless there is a clear product expectation from existing UI.

Report incomplete/placeholder behavior.

==================================================
PHASE 28 — ABANDONED WORKOUT
==================================================

Create active workout.

Manipulate time if fixtures/dev tools permit.

Simulate old active workout.

Check:

- elapsed duration
- resume
- discard
- finish
- duration correction
- absurd multi-hour/multi-day duration

Known prior concern:
abandoned workouts could accumulate ridiculous duration.

Report current behavior.

==================================================
PHASE 29 — WORKOUT HISTORY
==================================================

Inspect completed workouts.

Test:

- list
- date
- duration
- exercises
- sets
- volume
- reopen
- detail
- editing if supported
- deletion if supported

Look for missing useful information.

==================================================
PHASE 30 — KG / LB CONSISTENCY
==================================================

This deserves a dedicated pass.

Switch unit preference if possible.

Inspect:

- bodyweight
- workout load input
- previous set values
- PRs
- exercise detail
- training history
- strength charts
- reports
- plate helper
- routine defaults

Canonical storage can remain kg.

DISPLAY must respect preference.

Find every hard-coded "kg".

==================================================
PHASE 31 — PLATE HELPER / EQUIPMENT
==================================================

Test:

- target load
- bar weight
- plates
- impossible loads
- decimals
- kg/lb if supported
- Back
- navigation from workout

Verify arithmetic.

==================================================
PHASE 32 — PROGRESS
==================================================

Audit all Progress tabs.

Use seeded data.

Check:

- weight chart
- calories/macros
- strength
- measurements if present
- date labels
- axes
- units
- empty states
- sparse data
- many data points

Known previous concern:
Strength chart used session IDs as x-axis and hard-coded kg.

Determine current status.

Check chart tooltips/clicks on Web.

==================================================
PHASE 33 — WEEKLY REPORT
==================================================

Seed known week.

Verify arithmetic independently.

Check:

- calorie averages
- macros
- weight trend
- workout totals
- completeness
- dates
- ranges

Monday/Sunday semantics.

==================================================
PHASE 34 — MONTHLY REPORT
==================================================

Same discipline.

Test:
- month with data
- sparse month
- month boundary
- February/leap year if feasible

Look for misleading conclusions.

==================================================
PHASE 35 — CHECK-IN
==================================================

Test:

- bodyweight
- units
- date
- macros/goals if present
- validation
- edit/history
- duplicate same-day entry

Previous product concern:
check-ins had weak discoverability/report integration.

Determine current state.

==================================================
PHASE 36 — GOALS
==================================================

Test Edit Goals.

Verify append-only effective-date semantics.

Change targets today.

Check previous historical day.

Old day should use historical target where product semantics require.

No retroactive corruption.

==================================================
PHASE 37 — PROFILE / SETTINGS
==================================================

Audit EVERY setting.

Do not skip obscure ones.

For each:
- current value
- change
- Save
- reload
- verify

Inspect:

- profile data
- units
- targets
- theme/settings if present
- API/provider settings
- export/import
- health integrations
- onboarding restart
- destructive reset
- privacy/security wording

Again:

"Start onboarding again" is KNOWN BROKEN.

Test thoroughly.

==================================================
PHASE 38 — BACKUP EXPORT
==================================================

On Web:

test export.

Verify downloaded backup:
- exists
- valid format
- contains expected tables/data
- excludes secrets if required

Do not accept "file downloaded" as full proof.

==================================================
PHASE 39 — BACKUP IMPORT
==================================================

Test import into isolated test profile/data.

Verify:

- foods
- meals
- recipes
- dishes
- routines
- workouts
- settings

Test malformed backup.

Test wrong version.

Test cancel.

Test duplicate import behavior.

Ensure credential/API secrets are handled according to product policy.

==================================================
PHASE 40 — RESET / DELETE DATA
==================================================

This is dangerous.

Use isolated test state.

Test resetEverything / equivalent.

Verify:
- confirmation
- explicit destructive wording
- database cleanup
- onboarding state
- credentials behavior
- backup implications

Ensure "Start onboarding again" does NOT accidentally behave like full wipe unless explicitly designed that way.

==================================================
PHASE 41 — RESPONSIVE WEB LAYOUT
==================================================

Test viewport widths:

~360px
390px
430px
768px
1024px
1440px

Check:

- text clipping
- overflowing cards
- huge whitespace
- giant stretched forms
- modal positioning
- sticky buttons
- bottom navigation
- charts
- tables
- search fields
- keyboard focus

Desktop Web should not simply stretch a phone form across 2 meters of monitor.

Report areas needing max-width/layout adaptation.

==================================================
PHASE 42 — KEYBOARD / MOUSE UX
==================================================

Test:

Tab navigation
Shift+Tab
Enter
Space
Escape
arrow keys where appropriate

Forms should not require touchscreen behavior.

Check:
- focus outline
- modal focus trapping
- search focus
- Enter submitting wrong action
- accidental form submission

==================================================
PHASE 43 — ACCESSIBILITY
==================================================

Inspect accessibility tree.

Look for:

- unlabeled buttons
- duplicate labels
- icon-only controls
- incorrect roles
- bad heading hierarchy
- disabled controls exposed as enabled
- inaccessible modals
- poor keyboard order
- insufficient descriptive labels

Do not attempt a full legal accessibility certification.

Find practical major issues.

==================================================
PHASE 44 — ERROR STATES
==================================================

Where feasible simulate:

- database failure
- invalid data
- missing bundled DB
- failed save
- failed import
- unavailable provider
- invalid API key
- network unavailable for cloud action
- corrupted payload

Every failure should:
- not corrupt data
- not claim success
- explain enough
- offer retry/recovery where appropriate

==================================================
PHASE 45 — LOADING STATES
==================================================

Audit major async screens.

Never show:
0 items
No results
empty history

before loading actually completes.

Check:
- Exercise Library
- Food Search
- Indian Dishes
- Recipes
- Reports
- Assistant

Look for spinners that never stop.

==================================================
PHASE 46 — RAPID ACTION / RACE TESTING
==================================================

Rapidly:

double-click Save
double-click Add Exercise
double-click Complete Set
double-click Finish Workout
double-click Add to Routine
double-click Log Meal
double-click custom food save

Navigate Back mid-save.

Switch tabs mid-operation.

Reload during pending operation.

Find duplicate rows or corrupted state.

==================================================
PHASE 47 — MULTI-TAB WEB BEHAVIOR
==================================================

Open Nut AI in two browser tabs using same origin.

Test:

- meal write in A, view in B
- workout modification
- settings change
- same record edit concurrently

Look for:
- lost writes
- stale UI
- database corruption
- confusing divergence

Classify whether Web-specific.

==================================================
PHASE 48 — RELOAD PERSISTENCE
==================================================

Create clearly named QA records:

QA Food ...
QA Recipe ...
QA Dish ...
QA Routine ...
QA Workout ...

Reload.

Verify each.

Close/reopen browser context with preserved profile if possible.

Verify again.

==================================================
PHASE 49 — OFFLINE WEB BEHAVIOR
==================================================

If Web is intended to support meaningful offline use:

after required assets are initially loaded, simulate offline.

Determine what works.

Do NOT assume full PWA support unless implemented.

Report actual behavior.

==================================================
PHASE 50 — STORAGE LIMITS / LOCALSTORAGE DB
==================================================

Inspect current Web persistence implementation.

Current implementation reportedly uses SQLite WASM with localStorage-backed persistence.

Measure/inspect:

- DB size
- localStorage usage
- quota risk
- behavior near quota
- failure mode on quota exceeded

This is important.

Do not fabricate conclusions.

If database architecture presents realistic risk for larger user histories, report it prominently.

==================================================
PHASE 51 — WEB CREDENTIAL SECURITY
==================================================

Current Web build reportedly falls back to localStorage for provider keys.

Treat this as a SECURITY REVIEW ITEM.

Verify current behavior.

Report clearly:

- key is accessible to same-origin JS?
- visible in browser storage?
- any UI warning?
- user expectation?

Do not call localStorage equivalent to mobile SecureStore.

Classify severity based on intended production Web deployment.

==================================================
PHASE 52 — CONSOLE / RUNTIME AUDIT
==================================================

Throughout ALL testing record:

- console.error
- console.warn
- uncaught exceptions
- unhandled Promise rejections
- React warnings
- DOM warnings
- routing errors
- SQLite errors
- WASM errors

Deduplicate repeated errors.

For each unique issue:
- route
- action
- severity
- likely Web-only/shared

==================================================
PHASE 53 — PERFORMANCE
==================================================

Measure meaningful timings, not synthetic vanity numbers.

Inspect:

- initial app boot
- DB initialization
- Home load
- Food Search
- Indian Dishes
- Dish Composer
- Exercise Library
- search typing
- routine picker
- Progress charts
- Reports

Find:
- long JS tasks
- frozen interaction
- unnecessary rerenders
- huge lists
- excessive DB queries

Do not require micro-optimization.

Flag anything that feels meaningfully slow.

==================================================
PHASE 54 — DATA CONSISTENCY AUDIT
==================================================

Cross-check the same underlying data across multiple surfaces.

Example:

Log meal
→ Food tab
→ Home
→ weekly report
→ Assistant "protein today"

All should agree.

Complete workout
→ Train history
→ Progress Strength
→ weekly report
→ Assistant last workout

All should agree.

Change bodyweight
→ Check-in
→ Progress
→ reports

All should agree.

This is one of the highest-value audit phases.

==================================================
PHASE 55 — COPY / TERMINOLOGY AUDIT
==================================================

Look for inconsistent naming:

Quick workout / Quick Workout
Exercise Library / Exercise library
Calories / kcal
Meal / food
Draft / Needs Review
My Version / Household
Done / Save / Confirm

Check button wording.

A button should clearly tell the user what it does.

==================================================
PHASE 56 — PRODUCT COMPLETENESS AUDIT
==================================================

Now stop thinking only like a tester.

Think like a user.

For each major product area ask:

"What obvious thing would a reasonable user expect to do next?"

Look for missing workflow connections.

Examples:

- Exercise Detail used to be a dead end
- routine creation used to have weak exercise selection
- Dish identity may exist without a useful next action
- chart may show data but offer no history
- setting may exist but not actually update behavior

Report meaningful missing features.

Do NOT invent enormous unrelated features.

Focus on gaps implied by existing UI/product.

==================================================
PHASE 57 — VISUAL / UX AUDIT
==================================================

Inspect screenshots selectively.

Evaluate:

- hierarchy
- spacing
- typography
- visual density
- contrast
- button prominence
- primary vs secondary actions
- empty states
- warning states
- loading states
- cards
- forms
- charts
- modals
- bottom bars

Known historical concern:
too much flat black UI with weak hierarchy.

Determine current state objectively.

==================================================
PHASE 58 — MOBILE PARITY CLASSIFICATION
==================================================

For every bug found classify:

SHARED LIKELY
Same screen/business logic likely affects Android too.

WEB-ONLY
Browser adapter/layout/input specific.

MOBILE-ONLY UNKNOWN
Cannot know from Web.

NATIVE VERIFICATION REQUIRED
Needs Samsung test.

This will tell us which fixes need physical retesting.

==================================================
PHASE 59 — CODE INSPECTION AFTER BEHAVIOR DISCOVERY
==================================================

ONLY after discovering a bug through product use:

inspect relevant source.

Determine likely root cause.

Do NOT perform enormous speculative source audits unrelated to observed behavior.

For each important bug include likely files/functions.

==================================================
PHASE 60 — EXISTING TEST QUALITY
==================================================

Review tests relevant to major discovered bugs.

Ask:

"Why didn't existing tests catch this?"

Identify:
- missing integration coverage
- shallow unit assertions
- absent E2E journey
- missing regression test

Recommend the smallest useful automated regression test for each P0/P1.

==================================================
FINAL OUTPUT — VERY IMPORTANT
==================================================

DO NOT FIX ANYTHING YET.

Produce one massive consolidated:

NUT AI PRODUCT QA MASTER BACKLOG

==================================================
SECTION A — EXECUTIVE SUMMARY
==================================================

Report:

- overall product health
- core journeys that genuinely work
- major blockers
- most dangerous data-integrity issues
- largest UX problems
- largest missing-feature gaps
- Web-specific concerns
- shared/mobile-likely concerns

Do not give meaningless numeric scores.

==================================================
SECTION B — P0
==================================================

P0 means:

- data corruption
- wrong trusted nutrition
- destructive behavior
- false save
- impossible core product journey
- severe persistence loss
- security-critical issue

For each:

ID
Title
Area
Reproduction
Expected
Actual
Evidence
Data impact
Likely files
Web/shared classification
Recommended regression test

==================================================
SECTION C — P1
==================================================

Major broken feature or serious workflow problem.

Same format.

==================================================
SECTION D — P2
==================================================

Meaningful UX/product defect.

Same format.

==================================================
SECTION E — P3
==================================================

Polish.

Do not bury P0/P1 under 500 cosmetic notes.

==================================================
SECTION F — MISSING FEATURES / PRODUCT GAPS
==================================================

Separate missing/incomplete product functionality from bugs.

For each:

- feature area
- current limitation
- why it matters
- smallest sensible improvement
- whether existing architecture already supports it

==================================================
SECTION G — UI/UX BACKLOG
==================================================

Group by:

Home
Food
Training
Progress
Assistant
Settings
Onboarding
Global navigation
Web responsiveness

==================================================
SECTION H — DATA INTEGRITY FINDINGS
==================================================

Nutrition
historical snapshots
recipes
dishes
workouts
analytics
goals
dates
units
backup

==================================================
SECTION I — CROSS-SCREEN CONSISTENCY
==================================================

List any disagreements between:

Home
Food
Reports
Assistant
Training
Progress

==================================================
SECTION J — PERSISTENCE RESULTS
==================================================

List every object tested across reload.

PASS / FAIL.

==================================================
SECTION K — CONSOLE ERRORS
==================================================

Deduplicated unique errors/warnings.

==================================================
SECTION L — PERFORMANCE
==================================================

Meaningful slow paths.

Include measured timings where available.

==================================================
SECTION M — SECURITY / PRIVACY
==================================================

Especially:
- Web localStorage API keys
- backups
- destructive reset
- exposed secrets
- browser storage behavior

==================================================
SECTION N — ONBOARDING
==================================================

Dedicated report.

Include the known broken:

"Start onboarding again"

flow.

==================================================
SECTION O — MOBILE RETEST LIST
==================================================

After future fixes, list exactly what STILL needs Samsung verification.

Do NOT tell us to physically retest pure deterministic logic unnecessarily.

==================================================
SECTION P — AUTOMATION GAPS
==================================================

List Playwright tests that should be added.

Prioritize P0/P1 regression journeys.

==================================================
SECTION Q — TEST COVERAGE
==================================================

Routes tested
Routes partially tested
Routes not tested

Flows completed
Flows failed

==================================================
SECTION R — TOP FIX GROUPS
==================================================

Cluster findings into coherent implementation slices.

Example style:

GROUP 1 — data integrity
GROUP 2 — onboarding/settings
GROUP 3 — Food UX
GROUP 4 — Training UX
GROUP 5 — Progress/charts
GROUP 6 — Web security/storage

Do not solve them.

Just group them so another coding agent can implement efficiently.

==================================================
FINAL RULES
==================================================

Do not commit.
Do not push.
Do not modify production code in discovery.

Do not finish early because major happy paths work.

Do not treat "no exception" as product correctness.

Do not ignore UX problems.

Do not ignore missing expected functionality.

Do not hide uncertainty.

If something was not tested:
say NOT TESTED.

If something requires Android:
say NATIVE VERIFICATION REQUIRED.

Use the browser aggressively.

Use the database to validate writes.

Use independent arithmetic to validate numbers.

Use screenshots selectively.

Take as much time as necessary within this run.

This is intended to be the deepest single QA audit of Nut AI so far.
