# TLN-002: Daily Timeline Mobile UI

Status: unstarted
Phase: 4 - Search, repeat logging, and timeline
Depends on: TLN-001, SRH-005, TRN-003
Parallel-safe with: None
Conflicts likely in: Home/Food navigation, tab shell, active workout mini-card
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 3, 12; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 2, 36, 42
ADR links: docs/adr/ADR-011-timeline-strategy.md

## Outcome
Home and Food expose a unified daily timeline with meals, workouts, weight, PRs, check-ins, repeat actions, and active-workout return affordance.

## Why now
The timeline is the visible surface that connects search, repeat logging, and active workout recovery before adaptive check-ins depend on day status.

## In scope
- Render timeline events from TLN-001 in the mobile app.
- Add day navigation, empty states, offline behavior, and repeat shortcuts.
- Add active-workout mini-card outside Train.

## Out of scope
- Weekly/monthly reports.
- Web timeline implementation.
- Android live notification controls.

## Files expected to change
- Existing: app navigation shell, Home tab, Food tab, active workout state.
- Proposed: timeline UI components and test fixtures.

## Data/migration impact
- No schema migration expected.
- Repeat actions must create normal operation log entries.
- Rollback returns Home/Food to previous per-feature lists.

## Implementation contract
- Timeline rows must have stable dimensions and accessible labels.
- Empty, loading, offline, permission-denied, and undo-restored states must be explicit.
- Active-workout mini-card must survive tab navigation and deep link back to the workout.

## Acceptance criteria
- Given a mixed day, when Home opens, then all events appear in chronological order.
- Given an active workout, when the user leaves Train, then a mini-card shows elapsed/rest state and returns to the workout.
- Given a blank day, then the timeline shows logging actions without claiming missing data is zero.

## Tests required
- UI tests for mixed timeline, blank day, day navigation, repeat action, and active-workout mini-card.
- Accessibility checks for row labels and touch targets.
- Manual Android process-death recovery check inherited from TRN-003.

## Commands
- `npm --prefix apps/mobile run typecheck`
- `npm run test -- --run timeline`
- `npm run check`

## Manual verification
- On Android, log food, weight, and workout entries, navigate days, repeat an item, background the app, and return via the mini-card.

## Risks and rollback
- Risk: navigation churn affects all tabs. Keep route changes scoped and behind existing state contracts.
- Rollback by disabling the unified timeline route and restoring previous Home/Food components.

## Completion update
- Mark TLN-002 complete here and in TASK_INDEX.md.
- Update docs/planning/15_MOBILE_AND_WEB_UX.md screen inventory if routes change.
