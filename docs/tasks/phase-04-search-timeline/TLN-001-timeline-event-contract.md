# TLN-001: Unified Timeline Event Contract

Status: unstarted
Phase: 4 - Search, repeat logging, and timeline
Depends on: FND-003, TRN-002, IND-003
Parallel-safe with: SRH-005
Conflicts likely in: timeline read models, operation replay, date utilities
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 12; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 18, 36
ADR links: docs/adr/ADR-011-timeline-strategy.md, docs/adr/ADR-017-units-and-dates.md

## Outcome
A shared read model produces chronological timeline events for meals, body metrics, workouts, check-ins, PRs, and operations.

## Why now
The daily timeline UI and reports need one event model before rendering and analytics split across mobile and web.

## In scope
- Define timeline event types, IDs, ordering, date boundaries, and display payloads.
- Build local read functions for day and date range queries.
- Include empty, deleted, and undo/restored states.

## Out of scope
- Chart rendering.
- Web UI.
- Push notifications.

## Files expected to change
- Existing: date utilities, meal/workout read models.
- Proposed: packages/timeline, timeline fixtures.

## Data/migration impact
- Prefer derived read model with no new table.
- If cached, cache must be rebuildable and excluded from backup.
- Rollback removes timeline package and restores per-screen queries.

## Implementation contract
- Day boundaries use the canonical timezone rules in ADR-017.
- Event ordering is timestamp, event priority, then stable ID.
- Deleted items appear only when a debug or undo context requests them.

## Acceptance criteria
- Given food, weight, workout, and PR records on one day, when queried, then events are returned in deterministic chronological order.
- Given timezone travel, when querying a local day, then records use the user's local day at logging time.
- Given a deleted meal, then normal timeline queries omit it while undo context can reference it.

## Tests required
- Unit tests for ordering, date boundaries, deletion filtering, and mixed entity payloads.
- Snapshot fixtures for a dense day.
- Node-purity test for timeline package.

## Commands
- `npm run test -- --run timeline`
- `npm run check:node-purity`
- `npm run check`

## Manual verification
- Seed a day with meal, workout, weight, and PR entries and inspect event order in a debug screen or test harness.

## Risks and rollback
- Risk: timezone regressions can corrupt user trust. Keep timezone fixtures explicit.
- Rollback by leaving existing Home/Food queries until TLN-002 adopts the contract.

## Completion update
- Mark TLN-001 complete here and in TASK_INDEX.md.
- Link new event types from docs/planning/06_DOMAIN_MODEL.md.
