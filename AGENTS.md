# AGENTS.md — Binding Rules for All Implementation Agents

> **Every coding agent working on this repository MUST read this file before making
> any change.** These rules are non-negotiable and override any implicit
> assumption a model may carry.

## 1. Source-of-Truth Order

When requirements conflict, resolve using this precedence (highest first):

1. Explicit non-negotiable decisions in the master planning prompt.
2. Agreed decisions and V3 additions in the master-plan PDF.
3. Reproducible current repository behavior and tests.
4. Existing README / VERIFICATION claims.
5. Recommended reversible defaults in ADRs.

Never weaken a non-negotiable requirement merely because the current app does not
implement it.

## 2. Repository Discipline

- **This IS the application.** All work happens inside this monorepo. Do not
  create a separate starter app, greenfield Expo project, parallel demo, or
  replacement scaffold. Evolve the existing codebase.
- **Do not commit or push** unless the task file explicitly requests it and the
  project owner has approved.
- **Inspect `git status`** before writing any file. Preserve all user changes
  and unrelated work.
- **Do not delete branches, rewrite Git history, or reset the worktree.**

## 3. Database Safety

- **Never edit the v1 migration** (`MIGRATIONS[0]` in
  `packages/db-adapter/src/schema.ts`). It has shipped to real devices.
- **Add forward-only migrations.** Each gets a new version number and its own
  `Migration` entry. See `migrate.ts` for the runner.
- **Every new persistent table** must be added to the backup allowlist in
  `apps/mobile/src/data/backup-core.ts` (`EXPORT_TABLES`), exported in
  foreign-key-safe order, and round-trip tested.
- **Never silently rewrite historical data.** Logged nutrition snapshots are
  immutable. Recipe edits create versions. Exercise replacement never merges
  histories.

## 4. Package Purity

- `packages/*` MUST stay React-Native-free and importable under bare Node.
- This is enforced by `npm run check:node-purity` and is load-bearing: the eval
  harness runs the real engine under Node.
- The Expo SQLite adapter lives in `apps/mobile/src/db/`, NOT in `packages/`.
- When adding a new shared package, update the node-purity gate script
  (`scripts/check-node-purity.mjs`) to include it.

## 5. Immutable Product Principles

Every agent must respect these in code, tests, and UI:

1. **AI interprets; deterministic systems decide numbers.** Models may identify
   food or parse language. They never own final totals, historical facts, PRs,
   adaptive targets, or report numbers.
2. **Offline is a real mode, not an error screen.** With airplane mode and no API
   key, users can search, log, edit, train, view history, export, and recover.
3. **Historical records are stable.** Immutable per-100g snapshots at log time.
   Recipe edits create versions. No silent rewrites.
4. **Unknown ≠ zero.** Missing micronutrients stay unknown.
5. **Uncertainty is honest.** Show ranges and contributors. Model self-confidence
   is not calibrated probability.
6. **Conflicts are surfaced**, not silently averaged.
7. **Fast and calm daily interaction.** No shame colors, no streak manipulation,
   no beginner clutter with advanced metrics.
8. **Nutrition and training are one product** sharing identity, timeline, sync.
9. **No separate Home Workout silo.** Location is metadata; equipment determines
   suggestions.
10. **User control wins.** AI suggestions require review. Writes are explicit,
    undoable, auditable.
11. **Private by default.** Photos local unless explicitly synced. EXIF/GPS
    stripped before cloud. Users control retention.
12. **No single health score.** Use transparent metrics and reports.

## 6. Licensing

- Preserve **AGPL-3.0-or-later** and the **§7 app-store permission**.
- Track code and data licenses separately. See `THIRD-PARTY-DATA.md`.
- **IFCT** is authorized for public inclusion by the project owner. Use it
  through the `IFCTSource` adapter. Preserve attribution and provenance.
- Open Food Facts has separate license/provenance obligations.
- Never flatten source provenance into an untraceable master table.

## 7. Testing Requirements

Every implementation task MUST add or update tests. Required gates:

```bash
npm run lint          # zero unexpected warnings
npm run typecheck     # strict TypeScript for all packages + app
npm run test          # vitest — unit + property + integration
npm run check:node-purity  # all shared packages Node-importable
npm run data:verify   # golden-query gate
```

Full gate: `npm run check`

### Test types per change:
- **Schema/migration**: migration tests from every shipped version
- **Deterministic rules**: unit tests with edge cases
- **Numeric invariants**: property tests (fast-check)
- **Backup**: export/import round-trip tests
- **UI routes**: component tests where valuable
- **New packages**: add to node-purity gate

## 8. Evidence-Driven Task Workflow

Passing tests are evidence, not proof that a product task is complete. An agent
must prove that the task's contract is implemented through the real application
paths and survives the relevant failure and recovery paths.

### 8.1 Orient Before Planning

1. Read this file (`AGENTS.md`).
2. Run `git status --short`; preserve all existing work and record the baseline.
3. Read `PLAN.md`, `docs/tasks/TASK_INDEX.md`, and the assigned task file.
4. Read every linked requirement, ADR, data-license note, and relevant open
   question. Do not plan from the task title alone.
5. Inspect the current implementation and tests before proposing files or APIs.
   Search for all readers, writers, migrations, backup entries, UI callers, and
   platform adapters affected by the contract.
6. Reproduce the current focused and full validation baselines. Distinguish a
   pre-existing failure from one introduced by the task.

### 8.2 Build an Acceptance Map

Before editing, translate prose into a small internal acceptance map:

| Requirement | Production path | Persistence/recovery impact | Test evidence | Runtime evidence |
|---|---|---|---|---|
| What must be true | Every real caller that must enforce it | Migration, backup, undo, sync, restart | Unit/property/integration test | Device/browser/data inspection |

Use the map to find omissions. For example, adding UUID columns to a schema does
not satisfy an identity requirement if onboarding, manual logging, exercise
logging, or updates can still write null UUIDs. Testing a helper directly does
not prove those production write paths call it.

For each requirement, explicitly inspect these dimensions when relevant:

- **Create, update, delete, undo, and redo**, including idempotent replay.
- **Fresh install and every shipped migration path**, with populated rows.
- **Backup export, validation, import, rollback, and legacy-format import**.
- **Process restart, offline behavior, and interrupted operations**.
- **UI reachability and feedback**, including empty, error, and only-item states.
- **Boundary validation and security**, including malformed and untrusted input.
- **Data provenance and licensing**, especially for nutrition sources.

### 8.3 Plan in Dependency and Risk Order

1. Respect task dependencies and migration order. Do not start a blocked task
   because its UI looks convenient to build first.
2. Implement foundational contracts before their callers: types and invariants,
   then migrations/storage, domain helpers, production adapters/write paths, UI,
   and finally documentation.
3. Identify high-risk invariants before coding. Examples include no data loss,
   immutable nutrition snapshots, unknown not becoming zero, stable UUIDs,
   atomic replay, and complete backup restoration.
4. Keep scope inside the assigned task, but fix every production path required
   for that task to be truthful. A narrowly passing helper with unwired callers
   is unfinished, not good scope discipline.
5. If the task text conflicts with a higher source of truth, follow the
   precedence in Section 1 and document the discrepancy.

### 8.4 Implement From the Invariant Outward

1. Encode critical invariants at the strongest practical boundary: schema
   constraints/triggers for persisted data, typed and validated domain APIs for
   application input, and allowlists for dynamic database operations.
2. Wire the shared implementation into **all** real mutation paths. Search again
   after editing to catch bypasses and direct SQL writes.
3. Keep multi-step writes atomic. Idempotency checks and writes belong in the
   same transaction; backup import must either restore the whole valid snapshot
   or leave the existing database unchanged.
4. Preserve complete aggregates. Undoing or backing up a meal includes its
   children and associated ledger/provenance rows, not only the parent record.
5. Never use destructive convenience behavior such as silent table omission,
   partial restore, or `INSERT OR REPLACE` when it can delete or detach related
   rows.
6. Treat legacy and malformed data as first-class cases. Forward migrations must
   repair allowed legacy states deterministically or reject invalid states with
   a clear error.
7. Add tests while implementing so each discovered failure becomes a permanent
   regression test.

### 8.5 Verify in Layers

Run verification from fastest and narrowest to broadest:

1. **Static inspection:** search for bypassing callers, stale schema versions,
   incomplete backup allowlists, unsafe SQL interpolation, and false status text.
2. **Focused tests:** exercise the changed unit or package and its edge cases.
3. **Production-path integration tests:** call the same repository/service API
   used by the app against a real in-memory database; do not duplicate its SQL in
   the test.
4. **Migration and recovery tests:** start from populated old schemas, migrate,
   restart, export/import, corrupt input, and verify rollback/data equality.
5. **Full gate:** run `npm run check` and report exact counts/results.
6. **Artifact checks:** run `git diff --check`, Markdown/local-link validation,
   and inspect `git status --short`.
7. **Runtime verification:** when required, build and run the actual mobile/web
   application. Perform the task file's exact manual journey and inspect durable
   state after restart. A successful compilation or app launch alone is not the
   journey.

If a runtime step cannot be performed, record it as pending. Do not convert an
automated pass into a manual pass by inference.

### 8.6 Completion Is an Evidence Decision

Use status words truthfully:

- `unstarted`: no implementation work has begun.
- `ready`: dependencies are satisfied and work may begin.
- `in_progress`: implementation or any required automated/manual verification is
  still outstanding.
- `blocked`: a named external decision or dependency prevents progress.
- `deferred`: intentionally postponed by the roadmap or owner.
- `complete`: every acceptance criterion and required automated and manual check
  has passed, with no known contract gap.

Before marking `complete`, re-read the task from top to bottom and check each
acceptance criterion individually. Then update the task file,
`docs/tasks/TASK_INDEX.md`, `PLAN.md`, and any verification count or schema
version affected by the work. Never write "100% complete" while required device,
browser, data, permission, or recovery checks remain pending.

### 8.7 Phase 1 Case Study: How to Audit a Plausible Implementation

Phase 1 initially looked complete: migrations existed, helpers had tests, the
suite passed, and the app built. A contract audit still found important gaps:

- UUID/sync columns were added and old rows were backfilled, but several normal
  app write paths could create new rows without that metadata.
- Undo restored a meal and items but omitted related scan-cost ledger rows; a
  convenience replace operation could damage relationships.
- Operation helpers accepted dynamic entity and column names without strict
  allowlists, and idempotency checks were not consistently atomic.
- Backup import could accept an incomplete table set and then erase omitted
  tables; nested local photo paths were not fully scrubbed.
- Day-status validation lived in a helper but could be bypassed by direct writes.
- The undo control disappeared in the empty state after deleting the only meal.
- Documentation reported completion before the required Android journeys ran.

The correction process was:

1. Convert each task requirement into invariants and list every production
   writer/reader that could uphold or bypass it.
2. Add database-level protections and deterministic migration repairs where
   persisted correctness mattered.
3. Route onboarding, meal, manual-food, weight, goal, and exercise writes through
   the corrected contracts.
4. Make operations, backup, and undo preserve complete related data and fail
   atomically on invalid input.
5. Add production-path integration tests and adversarial migration/backup tests,
   not only helper tests.
6. Run the full gate, link/diff checks, build the Android app, migrate a populated
   physical-device database, inspect schema/data/triggers, and cold-restart it.
7. Leave tasks requiring unperformed tap-throughs as `in_progress` even though
   all automated checks passed.

The reusable lesson is: reason from observable product invariants toward code,
then gather independent evidence back from code toward the user journey. File
existence, test count, compilation, and confident prose are never substitutes
for that closed loop.

## 9. Scope Discipline

- Implement exactly what the task file specifies.
- Do not refactor unrelated code.
- Do not add features not in the current task.
- Do not rename files that other tasks reference unless the task requires it.
- If you discover a blocking issue, document it and stop. Do not improvise a
  redesign.

## 10. Commands Reference

```bash
# Development
npm install                    # install all workspace deps
npm run check                  # full gate: lint + typecheck + test + purity + data
npm run test                   # vitest only
npm run test -- --watch        # vitest watch mode

# Data pipeline
npm run data:build             # build USDA nutrition.db
npm run data:verify            # golden-query validation

# Mobile
cd apps/mobile
npx expo run:android --variant release   # build to device
npm run typecheck                         # app-level typecheck

# Purity
npm run check:node-purity      # verify packages/* are Node-clean
```

## 11. File Conventions

- TypeScript strict mode everywhere.
- Explicit `.js` import specifiers in `packages/*` (Metro compatibility).
- Zod schemas in `@nutai/core-schema` for all domain contracts.
- SQL migrations in `packages/db-adapter/src/schema.ts`.
- Backup table allowlist in `apps/mobile/src/data/backup-core.ts`.
- API keys in `expo-secure-store`, never in database or backups.

## 12. What Never Ships

- Shared production API secrets in APK/web bundle/Expo config.
- User photos with EXIF/GPS metadata to cloud services.
- Unvalidated AI/OCR output treated as system instructions.
- A single "health score" number.
- Social feed, leaderboard, gamification, supplement marketplace.
- Exercise-form camera scoring, smartwatch OS, GPS running platform.
