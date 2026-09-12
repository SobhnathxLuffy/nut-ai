# IND-002: Indian Food Alias Normalization

Status: complete
Phase: 2 - Nutrition
Depends on: FND-001, NUT-001
Parallel-safe with: IND-003, SRH-001
Conflicts likely in: indian ontology fixtures, resolver ranking
Requirement links: docs/planning/10_INDIAN_FOOD_DATA_AND_RECIPES.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 7
ADR links: docs/adr/ADR-008-universal-search.md

## Outcome
At least 100 high-frequency English/Hinglish/Hindi transliteration aliases resolve to canonical foods or dish families.

## Why now
IFCT rows are present; aliases make them usable for real Indian logging.

## In scope
- Define alias schema; add fixtures; integrate resolver normalization; add collision handling.

## Out of scope
- Full recipe engine; cloud AI prompts; voice input.

## Files expected to change
- Existing: resolver, nutrition source tests. Proposed: indian ontology fixture files.

## Data/migration impact
- May add alias tables or generated fixture artifacts. Backup includes user custom aliases only.

## Implementation contract
- Aliases map to canonical concepts with locale/script evidence and confidence. Collisions are explicit.

## Acceptance criteria
- Given arhar/toor/tuvar variants, then all resolve to the same canonical concept.

## Tests required
- 100+ alias fixture tests, collision tests, golden query tests.

## Commands
- `npm run test -- --run indian-aliases`
- `npm run data:verify`
- `npm run check`

## Manual verification
- Search common aliases and inspect canonical results.

## Risks and rollback
- Risk: over-normalization. Keep ambiguity options visible.

## Current evidence and remaining work
- Implemented: 100+ English/Hinglish/Hindi-script aliases, longest-match
  collision behavior, resolver integration, and alias-normalized search rungs.
- Verified: full alias fixture coverage exercises every alias entry; targeted
  aliases such as arhar/toor/tuvar route to red gram dal; on-device Food Database
  search resolves common Indian terms through the IFCT corpus.
- Remaining: none for Phase 2. Larger regional ontology expansion continues as
  product learning/evaluation work.
