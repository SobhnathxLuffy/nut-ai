# ADR-013: Synchronization Architecture

## Context
While offline-first, users eventually want their data backed up or synced across devices.

## Decision
We decided to use Supabase.

## Options Considered

### Supabase (Selected)
- **Pros:** Provides Postgres, Row Level Security (RLS), real-time subscriptions, and storage out of the box; open-source and standard SQL.
- **Cons:** Requires maintaining a Postgres instance and mapping SQLite schema to Postgres.

### Firebase
- **Pros:** Excellent SDKs, massive scale.
- **Cons:** Vendor lock-in, Firestore is not SQL, mismatch with our local SQLite architecture.

### Custom server
- **Pros:** Total control.
- **Cons:** Huge engineering effort to build robust sync, auth, and real-time features from scratch.

### CRDTs
- **Pros:** True masterless sync, mathematically sound.
- **Cons:** Massive overkill for personal health data; most user data has a single writer (the user).

## Consequences
- We leverage standard relational database technologies on both the client and server.
