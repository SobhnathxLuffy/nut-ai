# Task Template

Use this template for every implementation task file.

```markdown
# <ID>: <Title>

**Status:** ready | blocked | deferred | complete
**Phase:** <phase number and name>
**Depends on:** <task IDs>
**Parallel-safe with:** <task IDs>
**Conflicts likely in:** <file paths>
**Requirement links:** <spec section refs>
**ADR links:** <ADR IDs>

## Outcome

One observable result that proves this task is complete.

## Why Now

Dependency reason — why this task must happen at this point in the sequence.

## In Scope

- Explicit change 1
- Explicit change 2

## Out of Scope

- Guard against scope creep item 1
- Guard against scope creep item 2

## Files Expected to Change

- `path/to/existing-file.ts` — description of change
- `path/to/new-file.ts` [NEW] — what it implements

## Data/Migration Impact

- Schema version: v<N> (if applicable)
- Migration: description
- Backup: tables added to EXPORT_TABLES
- Sync: columns added
- Rollback/recovery: how to reverse if needed

## Implementation Contract

- Types and interfaces to create/modify
- Invariants that must hold
- Algorithms or formulas
- UI states (if applicable)
- Error behavior

## Acceptance Criteria

- [ ] Given X, When Y, Then Z
- [ ] Given A, When B, Then C

## Tests Required

- Unit: specific test cases
- Property: invariants to fuzz
- Integration: end-to-end scenarios
- E2E: device/browser steps

## Commands

```bash
# Focused validation
npm run test -- --filter <pattern>

# Full gate
npm run check
```

## Manual Verification

- Exact device/browser steps to verify behavior

## Risks and Rollback

- Failure mode 1 → recovery approach
- Failure mode 2 → recovery approach

## Completion Update

When done, update:
- [ ] This task file status → `complete`
- [ ] `docs/tasks/TASK_INDEX.md`
- [ ] `PLAN.md` current status
- [ ] Any linked spec documents
```
