# Offline Sync & Web Architecture

## 1. Offline-First Architecture

Nut AI is designed with a strict offline-first philosophy. The fundamental rule is: **The network never blocks the user.**

### Principles
- **Local Writes First**: All user actions (logging food, starting a workout, updating settings) write immediately to the local SQLite database.
- **Immediate UI Updates**: The UI updates optimistically based on the local write. There are no loading spinners waiting for a server response when mutating data.
- **Background Sync**: Synchronization happens asynchronously in the background. If the device is offline, changes are queued and synced when connectivity is restored.
- **Resilience**: The app must provide 100% of its core functionality (logging, viewing history, creating templates) completely offline, utilizing locally stored datasets and user history.

## 2. Two-Database Design

To manage data effectively, the system uses two separate SQLite databases on the device:

### `nutrition.db` (Read-Only)
- **Purpose**: Stores static or infrequently updated reference data (e.g., IFCT database, USDA fallback, generic exercise templates).
- **Behavior**: Shipped with the app or downloaded entirely upon initialization/update. Never written to by the application during normal operation.
- **Updates**: Updated via a complete file replacement or specific patch mechanism handled by the app's update service, separate from user data sync.

### `user.db` (Writable)
- **Purpose**: Stores all user-generated content (logs, custom foods, custom exercises, settings, sync queue).
- **Behavior**: Highly dynamic. This is the database that syncs with the cloud backend.
- **Structure**: Includes the Outbox queue for pending sync operations.

## 3. Sync Architecture & Supabase Adapter

The sync system uses a provider-independent domain model. The core logic defines *what* needs to be synced, while adapters define *how* it syncs.

### Provider-Independent Domain
- Defines `SyncableEntity` interface (id, updated_at, deleted_at).
- Manages the Outbox queue locally.
- Emits sync events (SyncStarted, SyncCompleted, SyncFailed).

### Supabase Adapter (First Implementation)
- Implements the sync interface using Supabase REST/Realtime APIs.
- Maps local tables to remote Supabase tables.
- Handles authentication token injection for requests.

### Idempotent Operation & Outbox Queue
- **Outbox Queue**: Every local mutation inserts a record into an `outbox` table in `user.db`. The record contains the entity type, entity ID, operation (INSERT, UPDATE, DELETE), and a timestamp.
- **Idempotency**: All backend sync endpoints must be idempotent. Re-sending an outbox message (e.g., due to a dropped connection during the response) will not cause duplicate data or errors. We use UUIDs generated locally as the primary keys to ensure this.

## 4. Account Lifecycle & Data Migration

### Local Anonymous Use
- Users can download and use the app indefinitely without creating an account.
- All data is stored purely in `user.db` locally.

### Local-to-Account Claim/Migration Flow
1. User decides to create an account (Sign Up).
2. App authenticates with Supabase, receiving a User ID (UUID).
3. **Migration**: A background process flags all local data in `user.db` as belonging to the new User ID.
4. The entire local database state is queued into the Outbox as a massive initial sync.
5. The Outbox processor uploads the data to the backend, establishing the user's cloud state.

## 5. Object Storage (Photos)

- **Storage Location**: Photos (food plates, progress pictures) are *not* stored as BLOBs in the relational database.
- **Local**: Stored in the device's local file system (app document directory). The database only stores the relative path or local URI.
- **Cloud**: Uploaded to Object Storage (e.g., Supabase Storage). The database syncs the cloud URL.
- **Sync Flow**: When syncing an entity with a photo, the photo file is uploaded first. Upon success, the relational entity is updated with the cloud URL and synced.

## 6. Authorization, Ownership & RLS

- **Row-Level Security (RLS)**: Enforced strongly on the backend (Supabase).
- Every table in the user schema has a `user_id` column.
- RLS policies ensure that a user can only `SELECT`, `INSERT`, `UPDATE`, or `DELETE` rows where `user_id = auth.uid()`.
- **Cross-User Sync Isolation**: Sync queries always filter by the authenticated user's ID, preventing any accidental cross-user data spillage.

## 7. Conflict Resolution

When multiple devices modify the same data, conflicts can occur. Resolution strategies vary by entity type:

- **Last-Writer-Wins (LWW)**: Based on the `updated_at` timestamp. Used for most scalar data (e.g., user profile name, target calories).
- **Append-Only**: Used for time-series data like weight logs or workout sets. Conflicts are rare; if they happen, both entries are kept (e.g., if a user logs two different weights at the same minute, both are preserved).
- **User-Choice (Manual)**: For complex conflicts (e.g., editing a custom recipe concurrently), the system may flag the entity as conflicted and prompt the user in the UI to choose the winning version.

### Multi-Device Deletion & Tombstones
- Hard deletes are not performed locally if the entity has been synced.
- Instead, a `deleted_at` timestamp is set (Tombstone).
- The sync engine pushes the tombstone to the server.
- Other devices pulling changes will see the tombstone and hide/delete the record locally.
- **Clock-Skew Handling**: The server acts as the source of truth for time during conflict resolution, or vector clocks/logical clocks are utilized if strict ordering is required.

## 8. Sync Status UI & Local-Only Mode

### Sync Status UI
- A subtle indicator (e.g., in the 'You' tab or header) shows current sync status: "Synced", "Syncing...", "Offline - Pending Changes", "Sync Error".
- A detailed "Sync Health" screen allows users to view the outbox queue size, recent errors, and manually trigger a retry.

### Local-Only Mode
- An explicit setting to disable all cloud sync.
- Pauses the outbox processor.
- Useful for privacy-conscious users who temporarily want to ensure data doesn't leave the device.

## 9. Web Offline: IndexedDB/OPFS/SQLite-WASM

To provide parity on the web, the offline-first architecture is replicated:
- **Database**: We use `sqlite-wasm` to run SQLite directly in the browser.
- **Persistence**: Backed by the Origin Private File System (OPFS) for high-performance, persistent local storage, falling back to IndexedDB if OPFS is unavailable.
- **Sync**: The exact same provider-independent sync logic runs in a Web Worker, communicating with the local SQLite-WASM database and the remote Supabase API.

## 10. Web Framework Choice

- **Framework**: Vite + React.
- **Domain Sharing**: The core domain logic (database schemas, sync engine, nutrition calculation algorithms, state machines) is extracted into a shared monorepo package.
- Both the React Native (mobile) and Vite + React (web) applications consume this shared package, ensuring identical behavior and significantly reducing code duplication.
