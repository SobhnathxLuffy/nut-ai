# ADR-004: Identity and Primary Key Strategy

## Context
We need a robust primary key strategy for our distributed, offline-first data model that supports syncing without conflicts.

## Decision
We decided to use UUIDv7 while keeping integer PKs alongside them.

## Options Considered

### UUIDv7 (Selected)
- **Pros:** Time-ordered (excellent for database index locality), standard RFC, 128-bit uniqueness.
- **Cons:** Slightly larger storage footprint than integers.

### UUIDv4
- **Pros:** Standard, completely random.
- **Cons:** Terrible for database index performance due to random distribution.

### ULID / CUID2
- **Pros:** Time-ordered, compact string representations.
- **Cons:** Non-standard (or less standard than UUIDv7).

### Replace integer PKs entirely
- **Pros:** Single primary key format.
- **Cons:** Destructive migration, significant performance hit (SQLite integer PKs are 2x faster for JOINs).

## Consequences
- We get the best of both worlds: integer IDs for fast local JOINs and UUIDv7s for global uniqueness and syncing.
