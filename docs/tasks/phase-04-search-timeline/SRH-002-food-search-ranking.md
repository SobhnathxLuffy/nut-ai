# SRH-002: Food Search Ranking and Filters

Status: unstarted
Phase: 4 - Search, repeat logging, and timeline
Depends on: SRH-001, IND-003
Parallel-safe with: SRH-003, SRH-004
Conflicts likely in: Food tab search UI, resolver ranking fixtures
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 4, 5, 6; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 6, 35
ADR links: docs/adr/ADR-008-universal-search.md, docs/adr/ADR-007-recipe-versioning.md

## Outcome
Food search ranks IFCT, USDA, user foods, recipes, recent items, and saved meals with visible provenance and useful filters.

## Why now
The unified contract exists before repeat logging, but food-specific ranking must be tuned before high-speed meal entry uses it.

## In scope
- Connect Food tab search to SRH-001.
- Add filters for source, recipe/user item, recent/frequent/favorite, and micronutrient coverage when present.
- Preserve source attribution in every result row.

## Out of scope
- AI photo analysis.
- Web sync or shared search service.
- New nutrition data ingestion.

## Files expected to change
- Existing: mobile Food/search routes, resolver tests, nutrition source UI components.
- Proposed: food-search ranking fixtures.

## Data/migration impact
- No schema migration expected.
- If user search filters are persisted, add them to backup v2.
- Rollback restores existing Food search component.

## Implementation contract
- IFCT and household recipe matches outrank generic USDA matches when query confidence is equal.
- Exact barcode/package matches outrank aliases.
- Missing micronutrient data must not be displayed as zero.

## Acceptance criteria
- Given "arhar dal", when searched, then the toor/tuvar canonical item appears with IFCT provenance.
- Given a saved household recipe and generic food with the same label, when searched, then the household recipe is visually distinguishable.
- Given no results, then the UI offers manual custom food creation without network dependency.

## Tests required
- Ranking fixture tests for aliases, source priority, and saved recipes.
- UI tests for filters and empty state.
- Regression test that previous USDA golden queries still pass.

## Commands
- `npm run data:verify`
- `npm run test -- --run food-search`
- `npm run check`

## Manual verification
- Search common Indian foods, a packaged item, a saved recipe, and an unknown item on Android.
- Confirm result provenance is visible before logging.

## Risks and rollback
- Risk: source priority hides useful western results. Keep source filter and score diagnostics.
- Rollback by leaving SRH-001 intact and reverting only Food tab adoption.

## Completion update
- Mark SRH-002 complete here and in TASK_INDEX.md.
- Update traceability only if new requirement coverage is added.
