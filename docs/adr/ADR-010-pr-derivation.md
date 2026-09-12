# ADR-010: Personal Record (PR) Derivation

## Context
Users want to know their all-time best lifts (Personal Records). We need a performant way to calculate and display this.

## Decision
We decided to use persisted records for PRs.

## Options Considered

### Persisted records (Selected)
- **Pros:** Extremely fast reads, recalculation only happens asynchronously upon data correction or new entries.
- **Cons:** Requires cache invalidation and background computation logic.

### Pure derived (compute on demand)
- **Pros:** Always accurate, zero cache invalidation logic needed.
- **Cons:** Slow for full history scans, especially as the user's data grows over years.

### Materialized view
- **Pros:** The database handles the complexity of caching and updating.
- **Cons:** SQLite does not natively support true materialized views with automatic refreshing.

## Consequences
- The UI can display PRs instantly.
- We must maintain robust background tasks to update the PR tables when historical data changes.
