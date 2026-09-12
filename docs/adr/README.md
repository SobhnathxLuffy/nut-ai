# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the project. An ADR is a short document capturing an important architectural decision made along with its context and consequences.

## Index

- [ADR-001: Monorepo Tooling](ADR-001-monorepo-tooling.md)
- [ADR-002: Mobile Database Architecture](ADR-002-mobile-database.md)
- [ADR-003: Web Stack Selection](ADR-003-web-stack.md)
- [ADR-004: Identity and Primary Key Strategy](ADR-004-identity-strategy.md)
- [ADR-005: Nutrition Source Architecture](ADR-005-nutrition-source-adapter.md)
- [ADR-006: IFCT Data Integration](ADR-006-ifct-integration.md)
- [ADR-007: Recipe Versioning](ADR-007-recipe-versioning.md)
- [ADR-008: Universal Search Engine](ADR-008-universal-search.md)
- [ADR-009: Training Domain Schema](ADR-009-training-domain.md)
- [ADR-010: Personal Record (PR) Derivation](ADR-010-pr-derivation.md)
- [ADR-011: Timeline Aggregation Strategy](ADR-011-timeline-strategy.md)
- [ADR-012: Undo Operations Architecture](ADR-012-undo-operations.md)
- [ADR-013: Synchronization Architecture](ADR-013-sync-architecture.md)
- [ADR-014: AI Provider Integration](ADR-014-ai-providers.md)
- [ADR-015: Photo Storage Strategy](ADR-015-photo-storage.md)
- [ADR-016: Health Platform Integration](ADR-016-health-adapters.md)
- [ADR-017: Canonical Units and Dates](ADR-017-units-and-dates.md)
- [ADR-018: Health Score Deprecation](ADR-018-health-score-removal.md)
- [ADR-019: Observability and Telemetry](ADR-019-observability.md)
- [ADR-020: Testing Framework](ADR-020-testing-stack.md)

## How to Create a New ADR

1. Create a new markdown file in this directory.
2. Use the numbering convention: `ADR-XXX-short-title.md` where `XXX` is the next available sequential number (e.g., `ADR-021-new-feature.md`).
3. Follow the standard template structure:
   - **Context**: What is the problem?
   - **Decision**: What did we decide?
   - **Options Considered**: Specific alternatives with real pros/cons.
   - **Consequences**: What happens next?
4. Update the Index in this `README.md` to include your new ADR.

## Status Lifecycle

ADRs progress through the following statuses:
- **Proposed**: Under review, pending approval.
- **Accepted**: Approved and ready for implementation, or already implemented.
- **Deprecated**: No longer relevant or supported, but kept for historical context.
- **Superseded**: Replaced by a newer ADR (reference the new ADR).
