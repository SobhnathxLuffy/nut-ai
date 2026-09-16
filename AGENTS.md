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
- The latest verified automated baseline is **583 tests across 71 files**, with lint, typecheck, node-purity, USDA data verification, IFCT verification, and Indian-dish verification passing.
- The **Reliable Food Logging + Personal Food/Recipe Management** slice has been physically exercised on Android for review-before-save, historical dates, edit/delete/undo, repeats, custom foods, recipe logging/versioning, dirty-form protection, rapid-save protection, keyboard handling, and process-level persistence.
- Core nutrition writes use immutable snapshots and deterministic arithmetic rather than trusting model-generated calories/macros.

### 0.2 Known current shortcomings — do not silently relabel these as complete

#### Home / Food UX
- Home is still visually cluttered and lacks good previous-day navigation.
- Eaten vs remaining nutrition hierarchy is weak.
- Repeat-meal currently appears to reuse the prior meal timestamp instead of using the repeat time.
- Undo/redo feedback does not clearly tell the user what action will be undone/redone.
- Search/review/edit surfaces emphasize calories more than macros; protein/carbs/fat visibility needs work.
- Food search appears to surface only one source family at a time instead of a useful combined candidate set from IFCT, USDA, user foods, recipes, and curated dish data.
- Recipe ingredient rows do not clearly show the calories/macros contributed by the entered ingredient quantity.

#### Indian Dish / Unknown Dish
- There are **362 canonical dish records: 50 CURATED and 312 DRAFT_CURATED**.
- The 312 drafts are **not trusted ready-to-log dishes** and must never be presented as such.
- The current unknown-dish builder is a **manual deterministic fallback**, not semantic dish decomposition.
- Unrelated unknown dishes can receive the same generic base-ingredient/fat/method choices. Do not call that dish-specific understanding.
- A real dish editor/decomposition flow still needs dish-specific ingredients, editable quantities, yield, fat, portions, provenance, and uncertainty.

#### Training
- Training is **not complete** despite older planning documents claiming otherwise.
- The Exercise Library has a confirmed serious device bug: it can show 0 exercises for 10–15 seconds, later load ~225, then fail selection; Done and Android Back can fail, trapping the user.
- Active workout, rest timer, abandoned-workout recovery, history, unit handling, and the complete training journey still need a focused verification/fix pass.

#### Progress / Reports / Check-ins
- Analytics code exists, but user-facing verification is incomplete.
- Charts may still have poor axes, misleading scale, weak touch interaction, and unclear sparse-data behavior.
- Weekly/monthly reports and check-in discovery/consistency still require physical and arithmetic verification.

#### Settings / Onboarding / Backup
- Settings/profile management and onboarding remain partial.
- Do not assume every onboarding promise is wired to production behavior.
- Destructive restore/reset flows must not be tested casually against the owner's active data.

#### AI / Photo
- The user has not yet configured AI provider credentials for current QA.
- Cloud AI behavior, assistant writes, semantic text decomposition, and photo recognition must therefore be treated as **NOT TESTED**, not failed and not complete.
- AI features must route through the same reviewed deterministic logging path as manual food entry.

#### Deferred physical checks
- Full hardware network isolation and full device reboot persistence are currently deferred because the phone supplies internet connectivity to the development environment.
- Process-level force-stop/relaunch is allowed and already used.

### 0.3 Current priority order

Unless the owner explicitly changes priority, prefer this order:

1. **Training core reliability** — Exercise Library selection/navigation/loading, then active workout.
2. **Food product-quality gaps** — merged source results, repeat timestamp, macro visibility, Home/day navigation, clearer undo/redo, recipe ingredient contributions.
3. **Real Indian-dish workflow** — browseable dish library + dish-specific ingredient/quantity editor; do not fake semantic decomposition.
4. **Workout UX/recovery/rest timer/units/history**.
5. **Progress, analytics, reports, check-ins** with real data verification.
6. **Settings, onboarding, backup/restore UX, global navigation, cross-app visual hierarchy**.
7. **AI assistant/text interpretation/photo integration** after provider credentials are configured and the deterministic review pipeline is ready.

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

Do not implement “first source wins” if the product requirement is to let the user choose among meaningful candidates.

When relevant, a search result set should be able to include:
- IFCT
- USDA
- custom/user foods
- household recipes
- CURATED Indian dishes
- packaged/barcode results

Ranking may prioritize, but it must not silently erase useful alternate sources.

### 6.3 Indian Dish KB status semantics

- `DRAFT_CURATED`: structured draft; **not trusted nutrition-ready**.
- `CURATED`: meaningfully reviewed recipe structure/ingredients/ratios/yield/portion with honest provenance.
- `VERIFIED`: stricter evidence level; do not promote merely because IDs resolve or validators pass.

Current reality: 50 CURATED, 312 DRAFT_CURATED.

### 6.4 Unknown-dish fallback

The current fallback is manual deterministic estimation.

Never describe it as:
- semantic dish understanding
- mapped recipe decomposition
- verified Indian dish nutrition

unless the runtime actually has dish-specific component knowledge.

A future proper flow should support:
- dish/component candidates
- editable ingredient list
- ingredient quantities
- cooking fat quantities
- yield/cooked weight
- portion strategy
- uncertainty/provenance
- high-impact clarification questions
- deterministic final totals

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
npm run data:verify
npm run ifct:verify
npm run indian-dishes:verify
npm run check
```

Current reference baseline at the time of this document:
- 71 Vitest files
- 583 tests
- 18/18 node-pure shared packages
- USDA golden-query gate passing
- 528-row IFCT Table 1 corpus verification passing
- 362 Indian dishes: 50 CURATED, 312 DRAFT_CURATED

If counts change, update PLAN.md and VERIFICATION.md after the full gate.

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
npm run data:verify
npm run ifct:verify
npm run indian-dishes:verify
npm run check

# Diff / state
git status --short
git diff --check

# Mobile
cd apps/mobile
npm run typecheck
npx expo run:android --variant release

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
