# ADP-002: Completeness UI and Day Finalization

Status: unstarted
Phase: 5 - Day completeness and adaptive check-ins
Depends on: ADP-001, TLN-002
Parallel-safe with: ADP-003
Conflicts likely in: Home and Food day controls
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 3, 11; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 33
ADR links: docs/adr/ADR-011-timeline-strategy.md

## Outcome
Users can mark a day complete, partial, unknown, or fasting from the timeline without the app using shamey or body-negative language.

## Why now
The storage and exclusion rules exist; users need a reliable way to supply the signal before adaptive check-ins launch.

## In scope
- Add day-status control to Home/Food timeline.
- Show status history and undo where supported.
- Provide empty, offline, and edited-day states.

## Out of scope
- Weekly check-in recommendations.
- Notification reminders.
- Medical advice.

## Files expected to change
- Existing: Home/Food timeline components, operation handlers, accessibility labels.
- Proposed: day status selector component.

## Data/migration impact
- Uses FND-004 and FND-003 operation log.
- Backup unchanged beyond stored day status.
- Rollback hides the selector and leaves statuses readable.

## Implementation contract
- Status changes are explicit user actions and undoable.
- Red is reserved for safety warnings, not missed targets.
- Changing past days must recalculate affected read models.

## Acceptance criteria
- Given a day with meals, when marked COMPLETE, then reports include it.
- Given the user taps undo after changing status, then the prior status returns.
- Given a screen reader, then each status option has a clear label and consequence.

## Tests required
- UI tests for status selection, undo, and past-day edits.
- Accessibility tests for labels and touch target sizes.
- Integration test that status mutation updates analytics inputs.

## Commands
- `npm --prefix apps/mobile run typecheck`
- `npm run test -- --run day-status`
- `npm run check`

## Manual verification
- On Android, mark today and a prior day with all statuses and inspect timeline/report inputs.

## Risks and rollback
- Risk: controls add friction. Keep defaults passive and actions reversible.
- Rollback by hiding controls from the timeline route.

## Completion update
- Mark ADP-002 complete here and in TASK_INDEX.md.
- Update mobile UX docs with final control placement.
