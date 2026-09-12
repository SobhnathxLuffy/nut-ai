# REL-001: Accessibility Audit and Remediation

Status: unstarted
Phase: 11 - Accessibility, security, performance, and release
Depends on: WEB-003, HLT-003
Parallel-safe with: REL-003 after audit scope split
Conflicts likely in: mobile UI, web UI, color and typography tokens
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 3, 15; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 2, 38
ADR links: docs/adr/ADR-020-testing-stack.md

## Outcome
Mobile and web meet the accessibility release gate for navigation, logging, workout, reports, sync, and health integration flows.

## Why now
All major surfaces exist; accessibility remediation can be complete and evidence-backed rather than speculative.

## In scope
- Audit screen reader labels, focus order, contrast, target sizes, dynamic text, and keyboard access.
- Fix issues across mobile and web.
- Add regression tests for critical flows.

## Out of scope
- New product features.
- Visual redesign unrelated to accessibility.
- Store submission.

## Files expected to change
- Existing: mobile/web UI components, theme tokens, tests.
- Proposed: accessibility audit report.

## Data/migration impact
- No data migration.
- Rollback reverts individual UI changes if regressions appear.

## Implementation contract
- Food/body language remains neutral and red is reserved for safety warnings.
- Controls must be reachable by screen reader and keyboard where platform supports it.
- Text must fit at supported dynamic text sizes.

## Acceptance criteria
- Given critical flows, then screen reader labels are meaningful and order is logical.
- Given high text scale, then controls do not overlap.
- Given keyboard web navigation, then core flows are operable.

## Tests required
- Accessibility automated checks.
- Component tests for labels/states.
- Manual TalkBack, VoiceOver, and keyboard audit notes.

## Commands
- `npm run test -- --run accessibility`
- `npm --prefix apps/web run build`
- `npm run check`

## Manual verification
- Complete food logging, workout, sync settings, and report review with TalkBack and keyboard.

## Risks and rollback
- Risk: broad UI touch area. Keep remediations scoped to audited defects.
- Rollback by reverting specific UI remediation patches.

## Completion update
- Mark REL-001 complete here and in TASK_INDEX.md.
- Attach audit evidence to release checklist.
