# NUT-001: Nutrition Source Interface and USDA Adapter

Status: complete
Phase: 2 - Nutrition
Depends on: AUD-001
Parallel-safe with: IND-001, SRH-001, AIP-001
Conflicts likely in: nutrition source contracts, resolver adapter
Requirement links: docs/planning/09_NUTRITION_ENGINE.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 3, 6
ADR links: docs/adr/ADR-005-nutrition-source-adapter.md

## Outcome
Existing USDA lookup is wrapped behind a source interface with provenance and no regression.

## Why now
IFCT, user foods, recipes, and micronutrients need one source adapter contract.

## In scope
- Define NutritionSource; wrap USDA; preserve golden queries; expose source metadata.

## Out of scope
- Importing IFCT; recipe modeling; UI redesign.

## Files expected to change
- Existing: resolver, nutrition data tool, tests. Proposed: packages/nutrition-sources.

## Data/migration impact
- No migration expected. Logged snapshots continue to store source metadata. Rollback restores direct USDA resolver path.

## Implementation contract
- Source rows include source ID, version, license/provenance, per-100g nutrients, and confidence metadata.

## Acceptance criteria
- Given a USDA golden query, then result values and provenance match previous behavior.

## Tests required
- Adapter unit tests, golden-query regression, node-purity import test.

## Commands
- `npm run data:verify`
- `npm run test -- --run nutrition-source`
- `npm run check`

## Manual verification
- Search existing foods and compare results to pre-task verification.

## Risks and rollback
- Risk: adapter indirection changes ranking. Preserve fixtures before refactor.

## Current evidence and remaining work
- Implemented: `NutritionSource` contract, USDA adapter, source-qualified IDs,
  source ID/version/attribution provenance, USDA source filtering, backward
  compatibility for older rows without `source_id`, and multi-database resolver
  context.
- Verified: focused USDA/resolver/pipeline tests pass; full Food Database UI on
  Samsung SM-M146B shows USDA corpus count and source attribution.
- Remaining: none for Phase 2. Micronutrient expansion is tracked in Phase 8.
