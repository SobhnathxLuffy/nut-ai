# Task Implementation Guide

Welcome to the task execution directory. This document outlines the strict workflow and rules for implementing any task in this repository.

## 1. Prerequisites and Binding Rules
Before starting ANY task, you MUST read [AGENTS.md](../../AGENTS.md). The rules within `AGENTS.md` are binding and override any local suggestions if there is a conflict.
You should also review [PLAN.md](../../PLAN.md) to understand the current state of the project.

## 2. Full Task Workflow

The binding, detailed implementation method is
[AGENTS.md Section 8](../../AGENTS.md#8-evidence-driven-task-workflow). It
requires an acceptance map, inspection of every production path, layered tests,
and runtime evidence where the task calls for it. The checklist below is only a
quick execution reminder; it does not replace that protocol.

Follow this exact sequence when picking up a task:

1. **Select Task:** Choose an unassigned, unblocked task from `TASK_INDEX.md`.
2. **Check Dependencies:** Ensure all prerequisite tasks listed in the task's markdown file are marked as `completed`.
3. **Read `AGENTS.md`:** Re-familiarize yourself with the system constraints.
4. **Read Task File:** Read the specific `docs/tasks/[PHASE]/[TASK_ID].md` file top to bottom.
5. **Read Linked ADRs/Specs:** Read any documents in `docs/planning/` or `docs/adr/` linked by the task.
6. **Build Acceptance Map:** Map every requirement to its production callers,
   persistence/recovery paths, tests, and required runtime evidence.
7. **Inspect Code:** Find every reader, writer, migration, backup entry, UI caller,
   and adapter affected by the contract.
8. **Implement:** Encode the invariants, wire every real path, and add regression tests.
9. **Run Task Tests:** Execute specific tests related to your code (`npm run test -- --run [name]`).
10. **Run Full Gate:** Execute the full CI gate locally to ensure no regressions:
   - `npm run check` (Runs lint, typecheck, tests, node-purity, and data verification)
   - `npm run typecheck` (Runs tsc)
   - `npm run test` (Runs all Vitest tests)
11. **Run Artifact and Runtime Checks:** Validate links/diffs/status and perform
    the exact device/browser/data journey required by the task.
12. **Update Task Status:** Change status to `complete` only after every acceptance
    criterion and required automated and manual check passes. Otherwise keep it
    `in_progress` and name the pending evidence.
13. **Update `TASK_INDEX.md`:** Keep the matching task row synchronized.
14. **Update `PLAN.md`:** Record the evidence, pending checks, and next ready task.

## 3. Important Commands Reference

- Formatting & Linting: `npm run check`
- Typechecking: `npm run typecheck`
- Testing (All): `npm run test`
- Testing (Specific): `npm run test -- --run "totals"`

## 4. Handling Blockers
If you encounter a blocker (e.g., missing dependency, ambiguous requirement, upstream bug):
- **Document and Stop:** Note the blocker in the task file under a `## Blockers` section.
- **Do Not Improvise:** Do not guess the requirements or build temporary hacks to bypass core architectural blockers. Raise the issue to the user.

## 5. Handling Scope Creep
- **Stick to the Spec:** Implement *only* what the task specifies.
- If you notice refactoring opportunities or "nice-to-have" features, create a new task in the backlog or note it in `20_OPEN_QUESTIONS.md`. Do not bundle unrelated changes into the current task.

## 6. Completion Protocol
When a task is done, ensure the following files are updated before ending your turn:
1. The specific `docs/tasks/.../[TASK_ID].md` file.
2. `docs/tasks/TASK_INDEX.md`.
3. Root [PLAN.md](../../PLAN.md) (if applicable).
