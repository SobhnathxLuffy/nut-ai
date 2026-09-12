# MIC-001: Micronutrient Storage and Coverage Model

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: IND-001, FND-001
Parallel-safe with: TLN-003
Conflicts likely in: schema.ts, nutrition snapshots, source adapters
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 6, 13; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 29, 39
ADR links: docs/adr/ADR-005-nutrition-source-adapter.md, docs/adr/ADR-006-ifct-integration.md

## Outcome
Micronutrients are stored with amount, unit, source, source version, missing/estimated status, and coverage metadata.

## Why now
Reports can summarize macros, and IFCT ingestion exists; micronutrient fidelity must be added before UI implies completeness.

## In scope
- Extend source adapter output and logged nutrition snapshots for micronutrients.
- Track unknown, zero, estimated, and measured values distinctly.
- Add day-level coverage calculation.

## Out of scope
- Micronutrient UI.
- Supplement recommendations.
- Medical target advice.

## Files expected to change
- Existing: schema.ts, nutrition source adapters, totals engine, backup tests.
- Proposed: micronutrient fixtures.

## Data/migration impact
- Requires schema migration and backup v2 updates.
- Existing logs preserve macro snapshots and may have unknown micronutrient coverage.
- Rollback migration must avoid fabricating zero values.

## Implementation contract
- Missing does not equal zero.
- Every nutrient value includes nutrient ID, amount, unit, source ID/version, and quality flag.
- Aggregation must preserve unknown coverage percentages.

## Acceptance criteria
- Given a food with known vitamin C zero, then zero is stored distinctly from unknown.
- Given mixed known/unknown entries, then day coverage reflects partial data.
- Given backup round-trip, then micronutrient quality flags survive.

## Tests required
- Migration tests.
- Source adapter fixture tests.
- Totals/coverage aggregation tests.
- Backup round-trip tests.

## Commands
- `npm run test -- --run micronutrients`
- `npm run data:verify`
- `npm run check`

## Manual verification
- Inspect logged foods with known zero, known nonzero, and unknown micronutrients.

## Risks and rollback
- Risk: schema size grows quickly. Keep nutrient values normalized and source-versioned.
- Rollback by hiding micronutrients and preserving macro snapshots.

## Completion update
- Mark NUT-002 complete here and in TASK_INDEX.md.
- Update schema and nutrition planning docs.
