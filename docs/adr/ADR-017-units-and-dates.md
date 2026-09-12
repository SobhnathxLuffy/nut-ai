# ADR-017: Canonical Units and Dates

## Context
Users expect to see data in their local units (lbs vs kg, oz vs ml) and timezones.

## Decision
We decided to use metric as canonical storage, with dual presentation.

## Options Considered

### Metric canonical (Selected)
- **Pros:** Matches primary scientific data sources (IFCT, USDA), India-first alignment, prevents precision loss during arithmetic.
- **Cons:** Requires strict conversion layers at the UI boundary for imperial users.

### Imperial canonical
- **Pros:** Matches US user expectations.
- **Cons:** Would require constant conversion for Indian users and misaligns with scientific databases.

### Dual storage
- **Pros:** Fast reads for both user bases.
- **Cons:** Redundant storage, high risk of drift and inconsistency.

## Consequences
- All database columns and backend services strictly speak metric and UTC.
- UI components are strictly responsible for localization.
