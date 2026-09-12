# ADR-002: Mobile Database Architecture

## Context
Our application relies on a large dataset of food and exercise information (the corpus) and user-generated data. We need to decide how to structure the local SQLite database for the mobile app.

## Decision
We decided to use a two-database architecture.

## Options Considered

### Two-db (Selected)
- **Pros:** The read-only corpus is never corrupted by user writes and can be shipped as a pre-bundled asset.
- **Cons:** Requires cross-database querying (ATTACH DATABASE) or application-level joins, adding some query complexity.

### Single-db
- **Pros:** Simpler queries, no need to attach databases.
- **Cons:** Risk of corrupting the entire database including the corpus if a migration or user write fails.

## Consequences
- We can ship updates to the corpus DB independently of the user DB.
- User data backup/restore is simpler since the DB size is smaller.
