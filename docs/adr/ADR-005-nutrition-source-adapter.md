# ADR-005: Nutrition Source Architecture

## Context
We integrate with multiple nutrition data sources (e.g., IFCT, USDA). We need a strategy to ingest, normalize, and query this data.

## Decision
We decided to use the adapter pattern for nutrition sources.

## Options Considered

### Adapter Pattern (Selected)
- **Pros:** Clean separation of concerns, allows per-source license tracking, supports independent update cycles for different sources.
- **Cons:** Requires writing and maintaining a separate adapter for each source.

### Monolithic Table
- **Pros:** Simplest schema, easy to query.
- **Cons:** Loses data provenance, making it difficult to respect source-specific licenses or track updates accurately.

### GraphQL Federation
- **Pros:** Highly flexible querying across disparate data models.
- **Cons:** Massive over-engineering for a local-first application, adds unnecessary latency and complexity.

## Consequences
- Each data source remains isolated, ensuring high data integrity.
- Adding a new source requires explicit adapter implementation.
