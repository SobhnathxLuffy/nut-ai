# Backup, Undo, and Recovery Specification

This document details the strategies and implementations for backup mechanisms, undo features, and crash recovery systems. These specifications guarantee data integrity, reliable restoration, and user confidence across application versions.

## 1. Backup System Architecture

The backup system uses a JSON-based export model relying on a strict allowlist of tables. The entire backup and restore process is atomic, ensuring no partial state is ever committed to the primary database.

### 1.1 `EXPORT_TABLES` Allowlist
The backup strictly includes only the following 15 tables. This explicit list prevents accidental leakage of temporary data or caches.

**FK-Safe Export/Import Order:**
To respect foreign key constraints, data MUST be exported and imported in the following exact sequence:
1. `schema_migrations`
2. `user_profile`
3. `goals`
4. `settings`
5. `consents`
6. `user_foods`
7. `user_containers`
8. `saved_meals`
9. `personal_gram_priors`
10. `food_attribute_memory`
11. `weight_entries`
12. `water_entries`
13. `exercise_entries`
14. `meals`
15. `log_items`
16. `scan_cost_ledger`

### 1.2 Secret Exclusion
The following data sets and tables MUST NOT be included in backups:
- **API Keys:** Handled via `expo-secure-store`, not stored in the SQLite database.
- **Temporary / Cache Tables:** `scan_cache`, `day_summaries`, `accuracy_baselines` are strictly omitted to save space and avoid stale state.

### 1.3 Backup Format Versioning
All backups include a version tag in the root JSON object (e.g., `"version": 4`).
- **Parsing Older Formats:** The system supports importing older formats by running them through schema migrations post-import.
- **Rejecting Newer Formats:** If a backup file has a version higher than the app's supported version, it MUST be rejected to prevent schema corruption.

### 1.4 Compatibility
- v1 backups are importable on a v4 schema (migrations are applied automatically).
- v4 backups are explicitly rejected on a v1 app.

### 1.5 Round-trip Testing
The CI pipeline mandates round-trip testing for every shipped schema version:
`Export Data` → `Drop Schema` → `Recreate Schema` → `Import Data` → `Verify Data Integrity`

---

## 2. Undo Mechanics & Operations Ledger

To support robust undo functionality, the app maintains an operations ledger recording the history of mutations.

### 2.1 Operations Table Design
The `operations` table tracks reversible actions:
```sql
CREATE TABLE operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,
  entity_type TEXT NOT NULL, -- e.g., 'meal', 'log_item'
  entity_id TEXT NOT NULL,
  op_type TEXT NOT NULL CHECK(op_type IN ('INSERT', 'UPDATE', 'DELETE')),
  prev_json TEXT, -- State before the operation
  new_json TEXT,  -- State after the operation
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  undone_at INTEGER -- NULL if active, timestamp if undone
);
```

### 2.2 Undo Mechanics
When `undoOperation` is called:
1. It reads the latest operation with `undone_at IS NULL`.
2. Evaluates the `prev_json`.
3. Applies the inverse operation (e.g., if it was a `DELETE`, it `INSERT`s the `prev_json`).
4. Updates the operation, setting `undone_at = unixepoch()`.
5. Creates a new inverse operation in the ledger to allow redo capabilities.

### 2.3 Retention & Compaction
To prevent infinite ledger growth:
- Retention Policy: **30 days** OR **1000 operations**, whichever is smaller.
- Compaction runs synchronously on **app cold start** to prune operations outside these bounds.

---

## 3. Recipe Version History

Recipes are fundamentally immutable once logged to prevent historical drift. 
- **Updates:** Editing a recipe creates a completely new `recipe_version` row.
- **Preservation:** Old versions are preserved so past logged meals referencing them do not change macros.

---

## 4. Soft Deletion & Tombstones

All syncable user entities support soft deletion.
- **Design:** Entities feature a `deleted_at` (timestamp) column.
- **Sync:** Deleted rows act as tombstones during sync, instructing the remote server to drop the record.
- **Querying:** App queries must consistently append `WHERE deleted_at IS NULL` to exclude these rows.

---

## 5. Crash Recovery

### 5.1 Workout State Persistence
To survive process death or OS-level background kills (frequent on Android):
- Active workout states are persisted to SQLite **immediately after every set completion**.
- On reboot or app resume, if an unfinished workout is detected, the app restores the UI to that exact state without data loss.
