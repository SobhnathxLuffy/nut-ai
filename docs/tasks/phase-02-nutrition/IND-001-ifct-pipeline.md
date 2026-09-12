# IND-001: IFCT Ingestion Pipeline and Adapter

Status: complete
Phase: 2 - Nutrition
Depends on: NUT-001
Parallel-safe with: IND-002, NUT-002, REL-005
Conflicts likely in: tools/ifct-import, data manifests, license docs
Requirement links: docs/planning/10_INDIAN_FOOD_DATA_AND_RECIPES.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 6, 32
ADR links: docs/adr/ADR-006-ifct-integration.md

## Outcome
Authorized IFCT data can be reproducibly ingested into the nutrition source interface with provenance and validation.

## Why now
India-first nutrition needs the primary source before aliases, recipes, and evaluation can be trustworthy.

## In scope
- Implement public ingestion pipeline; add fixtures; connect permission manifest; add adapter tests.

## Out of scope
- Unlicensed data; manual copied database blobs; recipe engine changes beyond source rows.

## Files expected to change
- Existing: tools/nutrition-data, docs/data, THIRD-PARTY-DATA.md. Proposed: tools/ifct-import.

## Data/migration impact
- Generated source DB must carry version/license manifest. User backup unaffected. Rollback excludes generated IFCT artifact.

## Implementation contract
- Each row has stable source ID, nutrients, units, version, attribution, and validation status.

## Acceptance criteria
- Given permitted IFCT input, when pipeline runs, then validated rows are queryable through NutritionSource.

## Tests required
- Importer tests, adapter tests, manifest validation, golden queries for Indian foods.

## Commands
- `npm run test -- --run ifct`
- `npm run data:verify`
- `npm run check`

## Manual verification
- Run importer on permitted fixture and inspect manifest/attribution output.

## Risks and rollback
- Risk: licensing ambiguity. Do not include data until permission record is clear.

## Current evidence and remaining work
- Implemented: official PDF extraction from IFCT 2017 Table 1, reproducible
  normalized CSV generation, strict row-count/duplicate/numeric/mass-balance
  validation, SQLite `ifct.db` build, source hash and manifest metadata, IFCT
  source adapter, bundled app asset loading, and full-data golden queries.
- Corpus scope: all 528 food items in IFCT 2017 Table 1 are bundled for the
  current macro/fibre nutrition contract. Deeper IFCT micronutrient tables are
  deferred to Phase 8 (`MIC-001`/`MIC-002`) because the app does not yet have the
  micronutrient schema, reports, or display contract.
- Evidence: source PDF SHA-256
  `e87629581a58faca286f4886504bc75f33d6d3771a50fb4e40e2afee2b2b32dd`;
  normalized CSV SHA-256
  `894006e2aa34ffcb510debff88705e78c40df88e2e7dcee65bbd944f9fcc4785`;
  `ifct.db` contains 528 IFCT rows.
- Verified: `npm run ifct:extract`, `npm run ifct:build`, `npm run ifct:verify`,
  IFCT adapter/corpus tests, and Samsung SM-M146B Food Database search for
  `ragi` returning `ifct:A010`.
- Remaining: none for Phase 2. Attach external permission correspondence before
  wider public/commercial release if required.
