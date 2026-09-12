# NUT-002: Open Food Facts Adapter

Status: complete
Phase: 2
Depends on: NUT-001

## Outcome
Open Food Facts integration behind the NutritionSource interface.

## Tasks
- Integrate OFF API for barcode scans.
- Ensure ODbL license compliance (attribute source explicitly).

## Current evidence and remaining work
- Implemented: Open Food Facts adapter behind the shared source interface,
  barcode fallback after local USDA miss, ODbL attribution metadata, bounded
  request timeout, source-qualified IDs, and success/not-found/timeout coverage.
- Verified: scanner orchestration uses the source router for barcode lookups, and
  Food Database/result surfaces include Open Food Facts attribution.
- Remaining: none for Phase 2. Any derivative OFF database export must continue
  to honor ODbL share-alike in release work.
