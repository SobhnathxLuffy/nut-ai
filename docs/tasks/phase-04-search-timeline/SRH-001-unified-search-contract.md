# SRH-001: Unified Search Contract and Local Index

Status: complete
Phase: 4 - Search, repeat logging, and timeline
Depends on: NUT-001, IND-002, TRN-001
Parallel-safe with: None
Conflicts likely in: resolver/search contracts, package exports, mobile search routes
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 4, 5, 14; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 3, 35
ADR links: docs/adr/ADR-008-universal-search.md

## Outcome
A shared search contract can query food, recipes, saved meals, exercises, and actions from one local index without requiring network access.

## Why now
Repeat logging, timeline jump targets, assistant tool resolution, and web search reuse need one stable search interface before UI work fans out.

## In scope
- Define typed search entities, result scoring fields, source namespaces, and pagination.
- Build the first local index/read model from existing food, recipe, and exercise tables.
- Preserve offline behavior and deterministic ranking inputs.

## Out of scope
- New cloud search services.
- Visual redesign of the Food or Train tabs.
- Assistant natural-language routing.

## Files expected to change
- Existing: resolver package exports, nutrition source contracts, Train exercise contracts.
- Proposed: packages/search, packages/search/src/index.ts, search test fixtures.

## Data/migration impact
- No schema migration unless an index metadata table is required.
- Backup format must include any persisted user search preferences.
- Rollback removes the search package and falls back to existing resolver paths.

## Implementation contract
- Search input must include query, locale, entity scopes, limit, and optional filters.
- Results must include stable entity ID, entity type, display label, score, matched tokens, and provenance.
- Ranking must be deterministic under Node and React Native.
- Empty queries may return recent/frequent shortcuts only when the caller opts in.

## Acceptance criteria
- Given a Hinglish alias, when food scope is searched, then the canonical food or recipe appears with matched alias evidence.
- Given an exercise name, when exercise scope is searched, then custom and built-in exercises are both represented.
- Given no network, when search runs, then results and errors are identical to online mode.

## Tests required
- Unit tests for scoring normalization, scope filters, pagination, and empty-query behavior.
- Integration test that imports the search package under bare Node.
- Fixture tests for food alias and exercise matches.

## Commands
- `npm run typecheck`
- `npm run test -- --run packages/search`
- `npm run check:node-purity`
- `npm run check`

## Manual verification
- Build the mobile app and search for a food alias, a saved recipe, and an exercise from the same entry point.
- Toggle airplane mode and repeat the searches.

## Risks and rollback
- Risk: ranking changes existing food search expectations. Roll back by keeping existing resolver as the Food tab path until SRH-002 adopts the contract.
- Risk: index rebuild cost on startup. Keep rebuild lazy and measurable.

## Completion update
- Mark SRH-001 complete here and in TASK_INDEX.md.
- Update PLAN.md next task if SRH-002 or SRH-003 becomes ready.
- Add any new package boundary to docs/planning/05_PACKAGE_AND_DEPENDENCY_MAP.md.
