# ADR-011: Timeline Aggregation Strategy

## Context
The user's daily timeline displays foods eaten, exercises performed, and body measurements.

## Decision
We decided to use a UNION view.

## Options Considered

### UNION view (Selected)
- **Pros:** No data duplication, the timeline is always strictly consistent with the underlying tables.
- **Cons:** Complex view definition, can be slightly slower than a dedicated table for very large day queries.

### Dedicated timeline table
- **Pros:** Very fast reads.
- **Cons:** Duplicates data across domains, high risk of sync complexity and data anomalies (e.g., an entry deleted in the food table but orphaned in the timeline table).

### Event-sourced
- **Pros:** Natural fit for a timeline.
- **Cons:** Too complex to retro-fit and complicates simple CRUD operations.

## Consequences
- The timeline is guaranteed to reflect the truth of the domain tables.
