# IND-003: Recipe, Version, Yield, and Oil Model

Status: complete
Phase: 2 - Nutrition
Depends on: IND-002, FND-001
Parallel-safe with: SRH-004, AIP-003, TLN-001
Conflicts likely in: recipe schema, gram engine, backup allowlists
Requirement links: docs/planning/10_INDIAN_FOOD_DATA_AND_RECIPES.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 8, 9, 10
ADR links: docs/adr/ADR-007-recipe-versioning.md

## Outcome
Household recipes model raw ingredients, cooked yield, oil/ghee absorption, serving size, and immutable recipe versions.

## Why now
Aliases and source rows exist; recipes are needed before photo analysis or repeat logging can be accurate for Indian meals.

## In scope
- Add recipe/domain model; implement yield/oil math; add fixtures for roti, rice, dal, sabzi, curry.

## Out of scope
- Recipe sharing; meal planning calendar; cloud sync.

## Files expected to change
- Existing: gram engine, schema, resolver. Proposed: packages/recipe-engine.

## Data/migration impact
- Schema migration for recipes/versions/components. Backup v2 round-trips versions. Rollback keeps existing food logging.

## Implementation contract
- Logged meals reference immutable recipe version snapshots. Oil/ghee assumptions are explicit and editable.

## Acceptance criteria
- Given dal recipe fixture, then raw/cooked yield and per-serving macros match expected math.

## Tests required
- Unit/property tests for yield/oil, migration tests, backup tests, resolver integration tests.

## Commands
- `npm run test -- --run recipe`
- `npm run check`

## Manual verification
- Create/edit a household recipe and log one serving in dev UI/test harness.

## Risks and rollback
- Risk: recipe edits changing history. Enforce immutable versions.

## Current evidence and remaining work
- Implemented: recipe/version/component schema, immutable version history,
  display-name component snapshots, yield/oil serving math, backup round-trip,
  recipe source adapter, append-only create/edit/log repository, recipe
  operations undo/redo, and a mobile create/edit/log surface.
- Verified: recipe engine tests, repository tests, migration tests, backup
  round-trip, and Android schema v9 inspection on Samsung SM-M146B.
- Remaining: none for Phase 2. Dedicated repeat logging and timeline UX starts
  in Phase 4.
