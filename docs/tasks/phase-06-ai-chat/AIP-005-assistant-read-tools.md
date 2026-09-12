# AIP-005: Unified Assistant Read Tools

Status: unstarted
Phase: 6 - AI providers, photo analysis, and chat
Depends on: TLN-001, TRN-004, AIP-001
Parallel-safe with: AIP-002
Conflicts likely in: assistant tool registry, analytics read models
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 14; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 24, 30
ADR links: docs/adr/ADR-014-ai-providers.md, docs/adr/ADR-011-timeline-strategy.md

## Outcome
The assistant can answer read-only questions about meals, workouts, PRs, weight trend, and reports using structured local tools.

## Why now
Read tools are safer than write tools and establish the assistant context model before mutation proposals are allowed.

## In scope
- Define read-only assistant tool schemas.
- Add deterministic local tool execution before provider calls.
- Render tool results as UI cards.

## Out of scope
- Mutating assistant actions.
- Long-term memory beyond structured records.
- Cloud sync.

## Files expected to change
- Existing: assistant/chat route, timeline and training read models.
- Proposed: assistant tool registry and fixtures.

## Data/migration impact
- No schema migration expected.
- Chat transcripts are not persisted unless a later task explicitly adds storage.
- Rollback hides assistant read entry points.

## Implementation contract
- Read queries execute locally when possible.
- Tool calls must never expose provider keys or raw private media.
- Missing data returns unavailable/evidence states rather than invented answers.

## Acceptance criteria
- Given "what was my last bench press?", then the assistant returns a structured workout card.
- Given "how much protein last week?", then excluded days are shown.
- Given no relevant records, then the assistant says unavailable and offers direct navigation.

## Tests required
- Tool schema tests.
- Integration fixtures for nutrition, training, PR, and day-status queries.
- UI tests for read cards and empty states.

## Commands
- `npm run test -- --run assistant-read`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Ask meal, workout, PR, and missing-data questions on Android with network disabled.

## Risks and rollback
- Risk: assistant answer wording overclaims. Prefer deterministic cards over prose.
- Rollback by disabling assistant read tools while preserving core app routes.

## Completion update
- Mark AIP-005 complete here and in TASK_INDEX.md.
- Update docs/planning/13_AI_CHAT_AND_PROVIDER_ARCHITECTURE.md tool list.
