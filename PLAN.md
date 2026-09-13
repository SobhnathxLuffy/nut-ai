# PLAN.md — Current Implementation Status

> **Last updated:** 2026-09-12
> **Audited at:** Schema v9, 414 tests, commit `04fe708b` plus uncommitted Phase 1-2 implementation
> **Worktree state:** Dirty with uncommitted implementation and planning changes

## Current Phase

**Phase 1: Foundation** — COMPLETE

Phase 1 implementation passes the full automated gate. Android device inspection
confirmed the migrated `user.db` contains migrations 1 through 9 and the Phase 1
tables/triggers remain intact after the Phase 2 schema additions.

**Phase 2: Nutrition** — COMPLETE

Nutrition sources, source routing, Open Food Facts barcode fallback, Indian alias
normalization, IFCT Table 1 ingestion, and household recipe version/yield/oil
logging are implemented. The bundled `ifct.db` contains all 528 food items from
IFCT 2017 Table 1 for the current macro/fibre nutrition contract. IFCT
micronutrients remain intentionally deferred to Phase 8 because the app does not
yet have the micronutrient schema and report surfaces.

**Phase 3: Training** — COMPLETE

Training schema, offline workout creation, active workout auto-recovery, plate calculator (bounded knapsack), PR detection, routines & programs, and superset/circuit groupings are implemented and verified.

**Phase 4: Search, Repeat Logging, and Timeline** — COMPLETE

Unified search contract and index (`@nutai/search`), food search ranking (IFCT > USDA, barcode priority, Hinglish aliases), exercise search ranking (custom boosts, equipment filters), shortcut read models (recents, favorites, usuals), repeat logging actions with atomic undo/redo, unified timeline contract (`@nutai/timeline`), 5-tab navigation (`UX-001`), and daily timeline mobile UI (`TLN-002`) are implemented, passing full check gates (473 tests) and verified on physical Android hardware.

**Phase 5: Day Completeness and Adaptive Check-ins** — COMPLETE

Day status rules (`complete`, `partial`, `unknown`, `fasting`), analytics exclusions, fasting intentionality, exercise calorie separation from targets, day finalization UI (`DayStatusControl`), atomic operation recording for undo/redo, weekly check-in metrics engine (`@nutai/goals`), adaptive intake target suggestions with 150 kcal safety bounds and macro locks, consent/safety guardrails (<18yo, pregnancy, ED screening, low BMI, versioned goal snapshots), and the weekly check-in mobile screen (`apps/mobile/app/checkin.tsx` & `progress.tsx`) are implemented and verified.

## What Works Today

| Area | Status | Evidence |
|------|--------|----------|
| Monorepo + npm workspaces | ✅ Working | `package.json` workspaces |
| TypeScript strict mode | ✅ Working | `npm run typecheck` clean |
| 16 Node-pure packages | ✅ Working | `check:node-purity` 16/16 |
| 504 unit + property tests | ✅ Working | `npm run test` 53 files |
| Schema v9 (UUID, ops, day, recipes) | ✅ Working | Android app-private `user.db` has migrations 1-9; FK/integrity clean |
| Operations / undo foundation | ✅ Working | Strict replay, ledger-safe undo, recipe undo/redo coverage |
| Day completeness storage | ✅ Working | Storage/restart/constraint tests pass |
| Backup round-trip | ✅ Working | Complete/atomic/secret-safe/user recipe tests pass |
| USDA nutrition.db (7,928 foods) | ✅ Working | `data:verify` 26/26 |
| Photo scan → pipeline → result | ✅ Working | `pipeline.e2e.test.ts` 18 tests |
| Deterministic gram reconciliation | ✅ Working | `gram-engine.test.ts` 39 tests |
| Confidence bands | ✅ Working | `confidence.test.ts` 22 tests |
| BYO key (Anthropic/OpenAI/Gemini) | ✅ Working | Provider adapters |
| Immutable nutrition snapshots | ✅ Working | per-100g at log time |
| 5-tab navigation + sticky FAB | ✅ Working | UX-001 (Home, Food, Train, Progress, You) |
| Food tab (dedicated) | ✅ Working | Food tab with shortcuts, day controls, copy-yesterday |
| Train tab | ✅ Working | Workouts, routines, programs, sets, supersets |
| Set/rep/load workout journal | ✅ Working | TRN-001+, auto-recovery, undo/redo, PR derivation |
| Exercise library | ✅ Working | 200+ exercises seeded, custom exercise taxonomy |
| Equipment / plate calculator | ✅ Working | EQP-001 bounded knapsack plate loading |
| Universal search & ranking | ✅ Working | SRH-001, SRH-002, SRH-003 (@nutai/search) |
| Shortcuts & repeat logging | ✅ Working | SRH-004, SRH-005 (recents, favorites, usuals, copy-yesterday) |
| Unified timeline | ✅ Working | TLN-001, TLN-002 (@nutai/timeline & DayTimeline) |
| Health score UI | ✅ Removed | AUD-002 completed |
| ESLint | ✅ Configured | `npm run lint` passes |
| Onboarding screens | 🔶 Partial | Routes exist, functionality partial |
| THIRD-PARTY-DATA.md | ✅ Created | Planning pass |
| Nutrition source interface | ✅ Working | Source-qualified USDA/IFCT/user/recipe/OFF adapters |
| IFCT data / adapter | ✅ Working | 528 IFCT Table 1 foods; official PDF hash in manifest |
| Open Food Facts adapter | ✅ Working | Barcode adapter, timeout, ODbL attribution, scanner fallback |
| Indian aliases / ontology | ✅ Working | 100+ transliteration + Hindi-script aliases covered |
| Recipe / dish family system | ✅ Working | Versioned recipes, yield/oil math, create/edit/log/undo |
| Day completeness UI | ✅ Working | ADP-001, ADP-002 (DayStatusControl on Home/Food) |
| Adaptive weekly check-in | ✅ Working | ADP-003, ADP-004, ADP-005 (/checkin screen, metrics, adaptive targets, guardrails) |
| Reports | ❌ Not started | TLN-003 |
| UUID / sync metadata | ✅ Schema ready | v2 migration |
| Cloud sync | ❌ Not started | SYN-001+ |
| Web app | ❌ Not started | WEB-001+ |
| Health Connect | ❌ Not started | HLT-001+ |
| Local AI | ❌ Not started | AIP-008+ |

## Next Task

Begin Phase 6: AI Integration and Voice/Camera Pipelines (`AIP-001: AI Provider Interface and Key Storage Contract`).

## Blockers

None.

## Commands

```bash
npm run check              # Full gate
npm run typecheck          # TypeScript strict
npm run test               # 504 tests
npm run check:node-purity  # 16/16 packages
npm run data:verify        # 26/26 USDA golden queries
npm run ifct:verify        # 528-row IFCT golden queries
```

## Planning Documents

See [docs/planning/00_INDEX.md](docs/planning/00_INDEX.md) for the full index.

## Update Protocol

When completing a task:
1. Update the task status in its file and `docs/tasks/TASK_INDEX.md`
2. Update the tables above
3. Update "Next Task" to the next ready task
4. Update "Blockers" if anything changed
