# NUT-003: Source Router & Multi-Source Resolution

Status: complete
Phase: 2
Depends on: NUT-001, NUT-002, IND-001

## Outcome
Pipeline queries route to UserFood > HouseholdRecipe > IFCT > USDA > OFF.

## Tasks
- Build router layer mapping query intent to correct adapter.
- Support cascading lookups (fallback to USDA if IFCT misses).
## Current evidence and remaining work
- Implemented: cascade router priority `UserFood > HouseholdRecipe > IFCT >
  USDA > OFF`, separate USDA/IFCT/user database injection, source-qualified IDs,
  literal plus Indian-alias query rungs, and regression tests for colliding local
  row IDs.
- Verified: on-device Food Database search for `ragi` returns `ifct:A010`; USDA
  fallback tests pass when higher-priority sources miss; OFF barcode path is
  wired through the same router.
- Remaining: none for Phase 2. The richer universal search surface starts in
  Phase 4.
