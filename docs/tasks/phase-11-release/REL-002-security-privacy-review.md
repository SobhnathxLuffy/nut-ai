# REL-002: Security Hardening and Privacy Review

Status: unstarted
Phase: 11 - Accessibility, security, performance, and release
Depends on: SYN-006, AIP-007
Parallel-safe with: REL-003
Conflicts likely in: auth, sync, media, provider keys, logging
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 15, 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 27, 32
ADR links: docs/adr/ADR-013-sync-architecture.md, docs/adr/ADR-014-ai-providers.md, docs/adr/ADR-015-photo-storage.md

## Outcome
The product has a completed security/privacy review covering provider keys, photos, sync, backups, RLS, logs, and release builds.

## Why now
All sensitive flows exist and must be hardened before beta or public release.

## In scope
- Audit secrets, backups, logs, EXIF stripping, RLS, sync conflicts, object storage, and web bundle contents.
- Add or fix automated checks.
- Document residual risks and release blockers.

## Out of scope
- New sync features.
- New AI providers.
- Marketing copy.

## Files expected to change
- Existing: privacy/security code paths, tests, docs.
- Proposed: security review report and release gate evidence.

## Data/migration impact
- May require migration only if unsafe fields need removal or encryption.
- Backup format must remain restorable and secret-free.
- Rollback follows per-fix strategy.

## Implementation contract
- No shared API keys in APK or web bundle.
- User provider keys are OS/browser secure-storage only.
- Photos obey retention and deletion policy.

## Acceptance criteria
- Given exported backup, then it contains no provider keys or raw transient media.
- Given Supabase RLS tests, then cross-account access is denied.
- Given release bundle scan, then no shared provider secret appears.

## Tests required
- Secret scan tests.
- RLS/storage negative tests.
- Backup privacy regression tests.
- Dependency audit review.

## Commands
- `npm audit`
- `npm run test -- --run security`
- `npm run check`

## Manual verification
- Inspect release-like mobile and web bundles, logs, backups, and storage policies.

## Risks and rollback
- Risk: late findings require architectural changes. Treat high-severity issues as release blockers.
- Rollback by disabling affected features until fixed.

## Completion update
- Mark REL-002 complete here and in TASK_INDEX.md.
- Update risk register and release checklist.
