# REL-006: Beta Release Gate and Store Prep

Status: unstarted
Phase: 11 - Accessibility, security, performance, and release
Depends on: REL-001, REL-002, REL-003, REL-004, REL-005
Parallel-safe with: None
Conflicts likely in: release checklist, store metadata, build configuration
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 1, 15, 17; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 1, 32
ADR links: docs/adr/ADR-020-testing-stack.md

## Outcome
The project has a signed-off beta release candidate with store metadata, compliance evidence, known limitations, and rollback plan.

## Why now
All hardening gates must pass before public beta or store submission work begins.

## In scope
- Complete release checklist.
- Prepare beta build configuration, changelog, disclaimers, privacy labels, and known limitations.
- Verify no planned-but-unbuilt features are advertised.

## Out of scope
- Implementing missing feature work.
- Changing product scope.
- Public launch after beta feedback.

## Files expected to change
- Existing: release checklist, README/status docs, app metadata, privacy docs.
- Proposed: beta release notes.

## Data/migration impact
- Release candidate must include migration/backup compatibility notes.
- Rollback plan must include downgrade/restore guidance.
- No schema migration expected in this task unless release blockers require a fix.

## Implementation contract
- README and store copy must describe actual behavior, not roadmap items.
- Medical disclaimer and privacy policy must be present.
- Release build must pass full gate and manual smoke tests.

## Acceptance criteria
- Given release checklist, then every blocking item is complete or explicitly waived with owner.
- Given public-facing copy, then it does not claim unimplemented features.
- Given beta build, then install, onboarding, logging, backup, sync, and restore smoke tests pass.

## Tests required
- Full repository check.
- Mobile release smoke test.
- Web build smoke test if web is in beta scope.
- Manual privacy/compliance review.

## Commands
- `npm run check`
- `npm --prefix apps/mobile run typecheck`
- `npm --prefix apps/web run build`

## Manual verification
- Install beta build on Android, complete onboarding, log food and workout, export/import backup, and verify privacy settings.

## Risks and rollback
- Risk: release copy drifts from implementation. Compare README, PLAN, and store copy before signing off.
- Rollback by pulling beta build and publishing recovery instructions.

## Completion update
- Mark REL-006 complete here and in TASK_INDEX.md.
- Update PLAN.md to the next post-beta task or maintenance status.
