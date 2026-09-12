# TRN-006: Android Active Workout Live Controls

Status: deferred
Phase: 10 - Local Android AI and live controls
Depends on: TRN-003
Parallel-safe with: AIP-008
Conflicts likely in: Android notifications, active workout state, native background limits
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 8; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 14, 20, 42
ADR links: docs/adr/ADR-009-training-domain.md

## Outcome
Android shows active workout notification/live controls for rest timer, elapsed time, and one-tap return after the core app workout recovery is proven.

## Why now
The original prompt explicitly defers Android live controls until later; the task exists so the backlog is complete without implementing it early.

## In scope
- Add Android notification/live control integration.
- Keep active workout state synchronized with TRN-003 persistence.
- Handle background, process death, and notification permission states.

## Out of scope
- iOS Live Activities.
- Wear OS app.
- New workout domain features.

## Files expected to change
- Existing: active workout state, Android app config, Train route.
- Proposed: Android notification module/tests.

## Data/migration impact
- No schema migration expected.
- Notification state is derived from active workout state and excluded from backup.
- Rollback disables live controls and preserves in-app mini-card.

## Implementation contract
- Notification controls cannot be the source of truth; persisted workout session is.
- Permission denied state keeps workout usable in app.
- Controls must not drain battery with excessive wakeups.

## Acceptance criteria
- Given active workout, then Android notification shows elapsed/rest state and returns to the session.
- Given process death, then restored app and notification agree on active workout.
- Given denied notification permission, then the in-app mini-card still works.

## Tests required
- Android integration tests with mocked notification actions.
- Process-death recovery tests.
- Manual battery/performance smoke check.

## Commands
- `npm --prefix apps/mobile run typecheck`
- `npm run test -- --run active-workout`
- `npm run check`

## Manual verification
- Start workout on Android, background app, use notification actions, kill/restart app, and finish workout.

## Risks and rollback
- Risk: Android background limits vary by OS version. Feature-gate and keep in-app fallback.
- Rollback by disabling notification registration.

## Completion update
- Mark TRN-006 complete or deferred-with-reason here and in TASK_INDEX.md.
- Update mobile UX docs with permission states.
