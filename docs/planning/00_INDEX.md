# Planning Documentation Index

> **Repository:** [Blueturboguy07/nut-ai](https://github.com/Blueturboguy07/nut-ai)
> **Audited commit:** `04fe708b54241a8409ff0daa63dfc54df39407ec` (2026-08-10)
> **Planning pass date:** 2026-09-11

This directory contains the complete implementation-ready specification system
for evolving Nut AI into an India-first, offline-first nutrition and
strength-training platform.

## Root Documents

| Document | Purpose |
|----------|---------|
| [AGENTS.md](../../AGENTS.md) | Binding rules for every implementation agent |
| [PLAN.md](../../PLAN.md) | Current implementation status and next task |
| [THIRD-PARTY-DATA.md](../../THIRD-PARTY-DATA.md) | Data source license/permission manifest |
| [README.md](../../README.md) | Repository overview (update minimally) |
| [VERIFICATION.md](../../VERIFICATION.md) | Existing verification report (needs update) |

## Planning Specifications

| # | Document | Scope |
|---|----------|-------|
| 01 | [Repository Audit](01_REPOSITORY_AUDIT.md) | Complete audit of current codebase |
| 02 | [Product Specification](02_PRODUCT_SPEC.md) | Full product requirements |
| 03 | [Requirements Traceability](03_REQUIREMENTS_TRACEABILITY.md) | PDF → spec → task → test mapping |
| 04 | [Target Architecture](04_TARGET_ARCHITECTURE.md) | Package structure, data flows, diagrams |
| 05 | [Package and Dependency Map](05_PACKAGE_AND_DEPENDENCY_MAP.md) | Import rules, API surfaces, test types |
| 06 | [Domain Model](06_DOMAIN_MODEL.md) | Entity relationships and ER diagrams |
| 07 | [Database Schema and Migrations](07_DATABASE_SCHEMA_AND_MIGRATIONS.md) | Schema v1→v11, migration plan |
| 08 | [Backup, Undo, and Recovery](08_BACKUP_UNDO_AND_RECOVERY.md) | Backup versioning, undo, crash recovery |
| 09 | [Nutrition Engine](09_NUTRITION_ENGINE.md) | Pipeline stages, source routing, modes |
| 10 | [Indian Food Data and Recipes](10_INDIAN_FOOD_DATA_AND_RECIPES.md) | IFCT, ontology, recipes, household learning |
| 11 | [Training Engine](11_TRAINING_ENGINE.md) | Exercises, sets, workouts, routines, programs |
| 12 | [Equipment and Plate Loading](12_EQUIPMENT_AND_PLATE_LOADING.md) | Inventory, plate calculator, constraints |
| 13 | [AI, Chat, and Provider Architecture](13_AI_CHAT_AND_PROVIDER_ARCHITECTURE.md) | Assistants, providers, security |
| 14 | [Offline, Sync, and Web](14_OFFLINE_SYNC_AND_WEB.md) | Local-first, sync, web stack |
| 15 | [Mobile and Web UX](15_MOBILE_AND_WEB_UX.md) | Screen specs, accessibility, states |
| 16 | [Privacy, Security, and Safety](16_PRIVACY_SECURITY_AND_SAFETY.md) | Threat model, data inventory, release |
| 17 | [Testing and Evaluation](17_TESTING_AND_EVALUATION.md) | Test stack, E2E journeys, budgets |
| 18 | [Roadmap and Release Gates](18_ROADMAP_AND_RELEASE_GATES.md) | 12-phase build order with gates |
| 19 | [Risk Register](19_RISK_REGISTER.md) | Project risks and mitigations |
| 20 | [Open Questions](20_OPEN_QUESTIONS.md) | Blocking unknowns with recommended defaults |
| 21 | [Glossary](21_GLOSSARY.md) | Project-specific term definitions |

## Architectural Decision Records

See [docs/adr/README.md](../adr/README.md) for the full ADR index.

| ADR | Title |
|-----|-------|
| [ADR-001](../adr/ADR-001-monorepo-tooling.md) | Preserve npm workspaces |
| [ADR-002](../adr/ADR-002-mobile-database.md) | Two-database architecture |
| [ADR-003](../adr/ADR-003-web-stack.md) | Web stack (Vite + React) |
| [ADR-004](../adr/ADR-004-identity-strategy.md) | UUID + integer PK identity |
| [ADR-005](../adr/ADR-005-nutrition-source-adapter.md) | Nutrition source adapter |
| [ADR-006](../adr/ADR-006-ifct-integration.md) | IFCT authorized integration |
| [ADR-007](../adr/ADR-007-recipe-versioning.md) | Recipe versioning |
| [ADR-008](../adr/ADR-008-universal-search.md) | Universal search |
| [ADR-009](../adr/ADR-009-training-domain.md) | Training domain boundaries |
| [ADR-010](../adr/ADR-010-pr-derivation.md) | PR storage strategy |
| [ADR-011](../adr/ADR-011-timeline-strategy.md) | Timeline hybrid approach |
| [ADR-012](../adr/ADR-012-undo-operations.md) | Undo/operations log |
| [ADR-013](../adr/ADR-013-sync-architecture.md) | Sync provider abstraction |
| [ADR-014](../adr/ADR-014-ai-providers.md) | AI provider modes |
| [ADR-015](../adr/ADR-015-photo-storage.md) | Photo storage/retention |
| [ADR-016](../adr/ADR-016-health-adapters.md) | Health Connect/HealthKit |
| [ADR-017](../adr/ADR-017-units-and-dates.md) | Units, dates, timezones |
| [ADR-018](../adr/ADR-018-health-score-removal.md) | Health score removal |
| [ADR-019](../adr/ADR-019-observability.md) | Privacy-safe observability |
| [ADR-020](../adr/ADR-020-testing-stack.md) | Testing tools and gates |

## Implementation Backlog

See [docs/tasks/README.md](../tasks/README.md) for the task workflow and
[docs/tasks/TASK_INDEX.md](../tasks/TASK_INDEX.md) for the complete
dependency-ordered task table.

## Data and Templates

| Document | Purpose |
|----------|---------|
| [IFCT Ingestion and Permission](../data/IFCT_INGESTION_AND_PERMISSION.md) | IFCT pipeline design and permission record |
| [Source Manifest Template](../data/SOURCE_MANIFEST_TEMPLATE.md) | Template for nutrition source manifests |
| [Task Template](../templates/TASK_TEMPLATE.md) | Template for implementation task files |
| [ADR Template](../templates/ADR_TEMPLATE.md) | Template for architectural decisions |
| [Migration Checklist](../templates/MIGRATION_CHECKLIST.md) | Checklist for database migrations |
| [Release Checklist](../templates/RELEASE_CHECKLIST.md) | Pre-release verification checklist |

## How to Use This System

1. **Start here** → Read this index to understand what exists.
2. **Before any task** → Read [AGENTS.md](../../AGENTS.md) for binding rules.
3. **Check current state** → Read [PLAN.md](../../PLAN.md) for what's next.
4. **Pick a task** → Open [TASK_INDEX.md](../tasks/TASK_INDEX.md), find the
   first `ready` task with all dependencies met.
5. **Understand the task** → Read the task file, linked ADRs, and specs.
6. **Implement** → Follow the task's contracts and acceptance criteria.
7. **Verify** → Run the task's test commands, then `npm run check`.
8. **Update** → Mark the task complete, update PLAN.md and TASK_INDEX.md.
