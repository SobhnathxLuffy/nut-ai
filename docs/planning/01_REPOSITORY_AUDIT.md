# Repository Audit (Current State)

This audit reflects the current state of the repository at commit `04fe708b54241a8409ff0daa63dfc54df39407ec` (2026-08-10) after the completion of Phase 1 foundation tasks.

## 1. Top-Level Structure
- Monorepo using `npm` workspaces.
- Directories: `apps/` (mobile, web), `packages/` (core logic), `eval/` (evaluation harness), `tools/` (data build scripts).
- Strict enforcement of "Node purity" for packages (no React Native imports).

## 2. Testing & Quality Baseline
- **Tests**: 363 unit and property tests passing across 26 test files.
- **Data Validation**: 26/26 golden queries passing for USDA parsing.
- **Node Purity**: 11/11 packages verify clean (free of React/React Native).
- **TypeScript**: `npm run typecheck` passes cleanly.
- **Lint**: ESLint configured and passing.

## 3. Database Schema (Version 4)
The application has successfully completed Phase 1 migrations (up to `USER_SCHEMA_VERSION = 4`).

### Core Identity & Tables
- Uses an Integer Primary Key (`id`) alongside a `uuid` TEXT column (UUIDv7) for all syncable entities.
- Implements 15 tables, covering core structures (e.g., `user_profile`, `goals`, `weight_entries`, `meals`, `log_items`).
- Implements `day_completeness` tracking (from `FND-004`).
- Implements `operations` logging for the undo system (`FND-003`).

### Two-Database Architecture
- `nutrition.db`: Read-only, bundled SQLite database containing USDA data (7,928 foods).
- `user.db`: Writable local database for all user state.

## 4. Mobile Architecture (apps/mobile)
- **Framework**: Expo SDK 51 / React Native.
- **Navigation**: Expo Router. Currently 3 tabs (Home, Progress, Profile) + FAB. (Needs migration to 5 tabs).
- **UI State**: Contains health score UI elements which are scheduled for removal (`AUD-002`). Defaults to imperial units currently.
- **Data Access**: `db-adapter` provides a strongly typed SQLite wrapper.

## 5. Packages (packages/)
11 distinct packages implementing domain logic:
1. `core-schema`: Zod definitions.
2. `db-adapter`: SQLite queries, migrations, atomic operations.
3. `gram-engine`: Volume-to-weight translation.
4. `totals`: Caloric and macro accumulations.
5. `resolver`: Text-to-database concept mapping.
6. `confidence`: Scoring bands for data provenance.
7. `repair`: Constraint correction.
8. `goals`: Target tracking.
9. `clamp`: Number boundaries.
10. `prompt`: Formatting queries for AI.
11. `pipeline`: Orchestrator of the full resolution flow.

## 6. Gaps to Address
- **Navigation**: Needs 5-tab target architecture implemented (`UX-001`).
- **Nutrition Sources**: Currently only USDA is wired. IFCT and Open Food Facts adapters are missing.
- **Training Engine**: The schema supports `exercise_entries` (calories only), but lacks a proper set/rep/load training schema.
- **AI Providers**: Only BYO-Key placeholders exist; needs full wiring.
