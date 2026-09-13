# AIP-002: Photo Preprocessing and Privacy Filter

Status: complete
Phase: 6 - AI providers, photo analysis, and chat
Depends on: AIP-001
Parallel-safe with: AIP-005
Conflicts likely in: media pipeline, upload preparation, photo retention settings
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 4, 15; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 27
ADR links: docs/adr/ADR-015-photo-storage.md

## Outcome
Every photo sent to AI providers is normalized, size-bounded, stripped of EXIF/GPS metadata, and governed by retention settings.

## Why now
Provider calls must not launch until the media privacy boundary is testable.

## In scope
- Implement preprocessing for camera/gallery images.
- Strip metadata before cloud processing.
- Define local temporary file lifecycle and deletion behavior.

## Out of scope
- Supabase object storage.
- Local multimodal model runtime.
- Body progress photo features beyond retention rules.

## Files expected to change
- Existing: camera/gallery pipeline, media utilities, settings.
- Proposed: media privacy test fixtures.

## Data/migration impact
- May add photo retention preference.
- Backup excludes raw transient media and includes only user-retained metadata references.
- Rollback blocks cloud photo analysis until privacy processing is restored.

## Implementation contract
- EXIF/GPS stripping must run before provider serialization.
- Image dimensions and bytes must respect provider-independent bounds.
- Temporary files are deleted after success, failure, or user cancellation unless explicitly retained.

## Acceptance criteria
- Given an image with GPS EXIF, when preprocessed, then the provider payload has no GPS metadata.
- Given a too-large photo, when preprocessed, then it is resized deterministically.
- Given provider failure, then temporary files are cleaned up.

## Tests required
- Unit tests with EXIF fixture images.
- Integration tests for cancellation/failure cleanup.
- Manual filesystem/log inspection on Android.

## Commands
- `npm run test -- --run photo-privacy`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Capture and choose gallery photos with location metadata enabled, then verify sanitized payload metadata.

## Risks and rollback
- Risk: native image libraries differ by platform. Keep Android-first fixtures and iOS smoke checks.
- Rollback by refusing cloud upload if sanitizer fails.

## Completion update
- Mark AIP-002 complete here and in TASK_INDEX.md.
- Update docs/planning/16_PRIVACY_SECURITY_AND_SAFETY.md with exact retention behavior.
