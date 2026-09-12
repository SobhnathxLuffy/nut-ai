# ADR-006: IFCT Data Integration

## Context
The Indian Food Composition Tables (IFCT) is a critical dataset for our application. We need to decide how to deliver this data to mobile users.

## Decision
We decided to bundle the IFCT data directly in the app.

## Options Considered

### Bundle in app (Selected)
- **Pros:** Works completely offline immediately upon installation, zero network dependency for core functionality.
- **Cons:** Increases the initial app download size (APK/IPA).

### Fetch on demand
- **Pros:** Smaller initial app download size.
- **Cons:** Breaks our core offline-first philosophy; users cannot use the app without an initial network connection.

### Companion download
- **Pros:** Keeps app small, allows selective downloading.
- **Cons:** Introduces significant user friction; users have to wait and manually manage data packs.

## Consequences
- Excellent out-of-the-box user experience.
- App binary size will be moderately larger.
