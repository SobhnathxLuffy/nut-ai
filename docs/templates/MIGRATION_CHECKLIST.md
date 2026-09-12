# Migration Checklist

Use this checklist for every database migration task.

## Before Writing the Migration

- [ ] Read `packages/db-adapter/src/schema.ts` to understand current schema
- [ ] Confirm the migration version number is `USER_SCHEMA_VERSION + 1`
- [ ] Verify no conflict with other in-progress migration tasks
- [ ] Check that the migration never edits an existing migration entry

## Writing the Migration

- [ ] Add the migration as a new entry in `MIGRATIONS` array
- [ ] Use `CREATE TABLE IF NOT EXISTS` for new tables
- [ ] Use `ALTER TABLE ... ADD COLUMN` for extending existing tables
- [ ] Include appropriate indexes
- [ ] Set sensible defaults for new columns on existing rows
- [ ] Generate UUIDs for existing rows if adding uuid column
- [ ] All timestamps as INTEGER (Unix epoch)
- [ ] `local_date` as TEXT 'YYYY-MM-DD'
- [ ] NULL means unknown, not zero (for nutrient values)
- [ ] Bump `USER_SCHEMA_VERSION`

## After Writing the Migration

- [ ] Add new tables to `EXPORT_TABLES` in `apps/mobile/src/data/backup-core.ts`
- [ ] Verify FK-safe export order
- [ ] Write migration test: v(N-1) → v(N) with seeded data
- [ ] Write migration test: v1 → v(N) (fresh install path)
- [ ] Write backup round-trip test including new tables
- [ ] Run `npm run test` — all tests pass
- [ ] Run `npm run check` — full gate passes
- [ ] Update schema documentation in `docs/planning/07_DATABASE_SCHEMA_AND_MIGRATIONS.md`

## Rollback Plan

- [ ] Document what happens if migration fails mid-way
- [ ] Each migration runs in its own transaction
- [ ] Failed migration leaves DB at last good version
