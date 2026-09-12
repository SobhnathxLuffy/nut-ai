# SRH-004: Recent, Frequent, Favorite, and Usual Meals

Status: complete
Phase: 4 - Search, repeat logging, and timeline
Depends on: FND-003, IND-003
Parallel-safe with: SRH-002, SRH-003
Conflicts likely in: logging history, operations, Food tab shortcuts
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 4, 5; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 9, 34
ADR links: docs/adr/ADR-011-timeline-strategy.md, docs/adr/ADR-012-undo-operations.md

## Outcome
The app exposes recent foods, frequent foods, favorites, saved meals, and usual meals as structured reusable logging targets.

## Why now
Fast repeat logging needs reusable entities and frequency read models before copy actions can safely mutate today's log.

## In scope
- Define recency and frequency calculations.
- Add favorite/usual-meal user actions through operations.
- Keep saved meals and household recipes distinct.

## Out of scope
- Social sharing.
- Cloud sync of favorites beyond local schema readiness.
- Full meal-planning calendar.

## Files expected to change
- Existing: meal log schema/read models, Food tab shortcuts, operation handlers.
- Proposed: packages/logging-shortcuts.

## Data/migration impact
- May add favorite/usual metadata tables with UUIDs and soft delete.
- Backup v2 must round-trip metadata.
- Undo must restore previous favorite/usual state.

## Implementation contract
- Recents are derived from log history; favorites and usual meals are user-authored state.
- Reusing an item snapshots nutrition at log time and does not mutate historical meals.
- Frequency windows must ignore deleted and test fixture rows.

## Acceptance criteria
- Given a logged meal, when it is favorited, then it appears in search shortcuts and survives app restart.
- Given a recent item is relogged, then a new meal entry is created with its own immutable snapshot.
- Given undo is tapped after adding a usual meal, then the log and shortcut state return to the prior state.

## Tests required
- Unit tests for recency/frequency windows.
- Operation/undo tests for favorite and usual-meal mutations.
- Backup round-trip tests for persisted shortcut state.

## Commands
- `npm run test -- --run logging-shortcuts`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Log, favorite, relog, and undo a meal on Android.
- Restart the app and confirm shortcuts persist.

## Risks and rollback
- Risk: duplicated concepts confuse users. Keep labels and data model distinctions explicit.
- Rollback by hiding shortcuts while retaining harmless derived recents.

## Completion update
- Mark SRH-004 complete here and in TASK_INDEX.md.
- Update docs/planning/15_MOBILE_AND_WEB_UX.md if shortcut placement changes.
