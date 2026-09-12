# TLN-003: Weekly and Monthly Reports Engine

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: ADP-003, TLN-001
Parallel-safe with: NUT-002
Conflicts likely in: reports engine, analytics fixtures
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 12; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 37, 18
ADR links: docs/adr/ADR-011-timeline-strategy.md

## Outcome
Weekly and monthly report payloads summarize nutrition, training, body metrics, exclusions, and uncertainty from local structured data.

## Why now
Day completeness and timeline contracts are stable, so report calculations can be built before chart UI and web dashboards.

## In scope
- Implement report range aggregation.
- Include completeness exclusions, protein compliance, calorie averages, training consistency, and PR summaries.
- Return neutral unavailable states for missing data.

## Out of scope
- Exported PDF reports.
- Causal claims between metrics.
- Health adapter writes.

## Files expected to change
- Existing: timeline and goals analytics modules.
- Proposed: packages/reports, report fixtures.

## Data/migration impact
- Reports are derived and should not be backed up unless cached.
- Cached report data must be rebuildable.
- Rollback removes report routes and keeps timeline analytics.

## Implementation contract
- Missing micronutrients are unknown, not zero.
- Partial/unknown days use ADP-001 exclusion rules.
- Report payloads are platform-neutral for mobile and web.

## Acceptance criteria
- Given complete week fixtures, then report totals match hand-calculated values.
- Given excluded days, then the report lists denominator evidence.
- Given no workout data, then training sections show unavailable states.

## Tests required
- Unit tests for weekly/monthly aggregation.
- Snapshot tests for complete, partial, and sparse reports.
- Node-purity tests for reports package.

## Commands
- `npm run test -- --run reports`
- `npm run check:node-purity`
- `npm run check`

## Manual verification
- Seed complete and incomplete weeks and inspect report payloads in a debug view or story.

## Risks and rollback
- Risk: report arithmetic drift. Keep fixture math readable and deterministic.
- Rollback by hiding report entry points.

## Completion update
- Mark TLN-003 complete here and in TASK_INDEX.md.
- Update docs/planning/17_TESTING_AND_EVALUATION.md with report fixtures.
