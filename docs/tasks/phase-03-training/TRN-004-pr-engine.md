# TRN-004: PR Detection and Progress Graph

Status: complete
Phase: 3 - Training
Depends on: TRN-002
Parallel-safe with: ADP-003, TLN-004
Conflicts likely in: progression package, PR read models, Progress UI
Requirement links: docs/planning/11_TRAINING_ENGINE.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 16, 18
ADR links: docs/adr/ADR-010-pr-derivation.md

## Outcome
The app derives PRs and displays one core exercise progress graph from completed workouts.

## Why now
Workout history exists; progress signals are needed before analytics and reports.

## In scope
- Implement PR derivation; e1RM and volume helpers; add one graph surface.

## Out of scope
- Full reports; program progression; web dashboard.

## Files expected to change
- Existing: workout history, Progress tab. Proposed: packages/progression.

## Data/migration impact
- Prefer derived PRs; cache only if rebuildable. Backup excludes caches.

## Implementation contract
- PR types include heaviest load, e1RM, rep-range, set volume, session volume, duration/distance where valid.

## Acceptance criteria
- Given workout fixtures, then derived PRs match expected records.

## Tests required
- Unit tests for PR types; graph component tests; node-purity test.

## Commands
- `npm run test -- --run progression`
- `npm run check`

## Manual verification
- Complete workouts and confirm PR feed/progress graph updates.

## Risks and rollback
- Risk: fake precision. Show transparent formulas and units.

## Completion update
- Mark TRN-004 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
