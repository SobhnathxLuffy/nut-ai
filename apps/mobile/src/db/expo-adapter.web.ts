import { DbAdapter, RunResult, SqlValue } from '@nutai/db-adapter'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

/**
 * Sub-path hosting support (GitHub Pages project sites serve the app under
 * /<repo>/). EXPO_PUBLIC_WEB_BASE is statically inlined by Metro at export
 * time (e.g. '/nut-ai' — set by scripts/build-ghpages.sh); unset means
 * root-anchored hosting (serve-3000.py), producing exactly the historical
 * '/'-prefixed behavior below.
 */
const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_BASE ?? '').replace(/\/+$/, '')

let sqliteWasmPromise: Promise<any> | null = null;
async function loadSqliteWasm() {
  if (!sqliteWasmPromise) {
    // wasm-boundary: the init module's emitted d.ts is looser than the
    // actual runtime options we pass (documented in WEB-005 round).
    // eslint-disable-next-line no-restricted-syntax -- wasm init boundary
    sqliteWasmPromise = (sqlite3InitModule as any)({
      locateFile: (file: any) => WEB_BASE + '/' + file,
      print: console.log,
      printErr: console.error,
    }).then((r: any) => {
      staticSqliteWasm = r;
      return r;
    }).then((r: any) => {
      // P2-7 (QA Wave 4): the old web adapter SILENTLY rewrote every
      // `CREATE VIRTUAL TABLE ... USING fts5` into a plain table if the
      // module lacked FTS5 — the corpus schema would change shape without a
      // word and every food_fts MATCH query would start throwing at runtime.
      // The rewrite is gone; if FTS5 is missing we fail fast, at boot, with
      // a diagnosis instead of a landmine.
      const probe = new r.oo1.DB();
      try {
        let has = false;
        probe.exec({
          sql: "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS v",
          rowMode: 'object',
          callback: (rowObj: any) => { has = Number(rowObj?.v) === 1; },
        });
        if (!has) {
          throw new Error(
            '[db] The bundled SQLite web module was built without FTS5. ' +
            'Nut AI requires FTS5 for food search (food_fts). Serve the @sqlite.org/sqlite-wasm ' +
            'build with ENABLE_FTS5 — refusing to open a corpus whose schema would silently change shape.',
          );
        }
      } finally {
        probe.close();
      }
      return r;
    });
  }
  return sqliteWasmPromise;
}

class SqliteWasmAdapter implements DbAdapter {
  constructor(
    private readonly db: any
  ) {}

  private executeSql(sql: string, params: readonly SqlValue[] = []): any[] {
    // P2-15: per-statement EXEC logging was pure console noise in production
    // (one line per SQL statement). It stays available as an explicit opt-in
    // debug flag instead.
    if (typeof globalThis !== 'undefined' && (globalThis as { __NUTAI_SQL_DEBUG__?: boolean }).__NUTAI_SQL_DEBUG__) {
      console.log('EXEC:', sql.substring(0, 100));
    }
    const results: any[] = [];
    const bindParams = params.map(p => typeof p === 'bigint' ? Number(p) : p);

    this.db.exec({
      sql,
      bind: bindParams,
      rowMode: 'object',
      callback: (row: any) => {
        results.push(row);
      }
    });
    return results;
  }

  async all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.executeSql(sql, params) as T[];
  }

  async get<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    const res = this.executeSql(sql, params);
    return (res.length > 0 ? res[0] : null) as T | null;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    this.executeSql(sql, params);
    const changesRes = this.executeSql('SELECT changes() as c');
    const lastRowRes = this.executeSql('SELECT last_insert_rowid() as c');
    return { changes: changesRes[0]?.c || 0, lastInsertRowId: lastRowRes[0]?.c || 0 };
  }

  async exec(sql: string): Promise<void> {
    this.executeSql(sql);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.executeSql('BEGIN');
    try {
      const res = await fn(this);
      this.executeSql('COMMIT');
      return res;
    } catch (e) {
      this.executeSql('ROLLBACK');
      throw e;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * WEB-005 fix.
 *
 * The user database used to live in a JsStorageDb, which backs SQLite onto
 * localStorage. localStorage is capped at ~5MB per origin, and the user DB is
 * the one database that grows forever (meals, workouts, corrections, undo
 * journal). Hitting the quota made every write throw QuotaExceededError and
 * silently lose data — the exact "severe persistence loss" class of failure.
 *
 * The user DB now prefers the OPFS VFS (Origin Private File System), whose
 * quota is orders of magnitude larger. serve-3000.py already ships the
 * COOP/COEP headers OPFS requires. Existing localStorage databases are
 * migrated once via sqlite3_js_db_export -> OpfsDb.importDb, and only cleared
 * after a successful import. If OPFS is unavailable (no COOP/COEP, old
 * browser) we fall back to the old JsStorageDb so the app still works, and the
 * migration re-runs on a later visit when OPFS becomes available.
 */

const OPFS_DB_PATH = '/nutai-user.db'
const OPFS_MIGRATED_KEY = 'nutai.userdb.opfs.migrated'
const LEGACY_KVS_NAME = 'local'

function opfsAvailable(sq3: any): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      // eslint-disable-next-line no-restricted-syntax -- OPFS feature detect; the API is not in this TS lib target yet
      typeof (window as any).FileSystemSyncAccessHandle !== 'undefined' &&
      typeof sq3?.oo1?.OpfsDb === 'function' &&
      typeof sq3?.oo1?.OpfsDb?.importDb === 'function' &&
      !!sq3?.capi?.sqlite3_vfs_find?.('opfs')
    );
  } catch {
    return false;
  }
}

function legacyKvsHasData(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(LEGACY_KVS_NAME);
  } catch {
    return false;
  }
}

function markOpfsMigrated(): void {
  try {
    localStorage.setItem(OPFS_MIGRATED_KEY, '1');
  } catch {}
}

/**
 * One-time migration: export the legacy localStorage-backed DB and import it
 * into OPFS. Every step is guarded — any failure leaves the legacy data
 * untouched so nothing is lost mid-migration.
 */
async function migrateLegacyKvsToOpfs(sq3: any): Promise<boolean> {
  let legacy: any = null;
  try {
    legacy = new sq3.oo1.JsStorageDb(LEGACY_KVS_NAME);
    const bytes = sq3.capi.sqlite3_js_db_export(legacy);
    if (!bytes || bytes.length === 0) {
      // Empty legacy DB: nothing to migrate, just record the upgrade.
      markOpfsMigrated();
      return true;
    }
    await sq3.oo1.OpfsDb.importDb(OPFS_DB_PATH, bytes);
  } catch (e) {
    console.warn('[db] localStorage -> OPFS migration failed; keeping legacy store', e);
    return false;
  } finally {
    try { legacy?.close?.(); } catch {}
  }
  // Import succeeded: purge the legacy copy so the 5MB quota can never bite again.
  try {
    legacy?.clearStorage?.();
  } catch {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === LEGACY_KVS_NAME || k?.startsWith(LEGACY_KVS_NAME + '/')) doomed.push(k);
      }
      doomed.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
  markOpfsMigrated();
  return true;
}

let userDbPromise: Promise<DbAdapter> | null = null;
export async function openUserDb(): Promise<DbAdapter> {
  if (!userDbPromise) {
    userDbPromise = (async () => {
      const sq3 = await loadSqliteWasm();
      let handle: any = null;
      if (opfsAvailable(sq3)) {
        try {
          const migrated = localStorage.getItem(OPFS_MIGRATED_KEY) === '1';
          if (!migrated && legacyKvsHasData()) {
            await migrateLegacyKvsToOpfs(sq3);
          }
          // 'c' = open existing or create. OPFS quota is effectively GBs.
          handle = new sq3.oo1.OpfsDb(OPFS_DB_PATH, 'c');
          markOpfsMigrated();
        } catch (e) {
          console.warn('[db] OPFS open failed; falling back to localStorage store', e);
          handle = null;
        }
      }
      if (!handle) {
        // Fallback for environments without OPFS (pre-migration behavior).
        handle = new sq3.oo1.JsStorageDb(LEGACY_KVS_NAME);
      }
      const adapter = new SqliteWasmAdapter(handle);
      // override close to invalidate cache
      const originalClose = adapter.close.bind(adapter);
      adapter.close = async () => {
        await originalClose();
        userDbPromise = null;
      };
      await adapter.exec('PRAGMA foreign_keys = ON;');
      return adapter;
    })();
  }
  return userDbPromise;
}

let staticSqliteWasm: any = null;
let nutritionOpenPromise: Promise<DbAdapter> | null = null;
let ifctOpenPromise: Promise<DbAdapter> | null = null;

async function loadStaticDb(assetId: any, dbName: string): Promise<DbAdapter> {
  await loadSqliteWasm();

  // On web we only need the asset's URL — the bytes are fetched straight into
  // memory and deserialized below. Deliberately NOT using Asset.loadAsync():
  // its download cache writes through OPFS, and two parallel loadAsync() calls
  // (nutrition.db + ifct.db both load on first launch) open exclusive
  // createSyncAccessHandle()s on the same cache file, which throws
  // NoModificationAllowedError and crashes first load. Asset.fromModule()
  // resolves the served URL synchronously without touching OPFS at all.
  let uri: string;

  // Expo's Asset resolution on Web
  if (typeof assetId === 'number' || (assetId && assetId.uri)) {
    const { Asset } = require('expo-asset');
    const asset = Asset.fromModule(assetId);
    uri = asset.uri || asset.localUri;
  } else {
    uri = String(assetId);
  }

  // Sub-path hosting safety net: asset resolution is root-absolute, so when
  // the bundle was built for a sub-path home, prefix it exactly once.
  if (WEB_BASE && uri.startsWith('/') && !uri.startsWith(WEB_BASE + '/')) {
    uri = WEB_BASE + uri;
  }

  console.log(`Fetching ${dbName} from ${uri}`);
  const resp = await fetch(uri);
  const buffer = await resp.arrayBuffer();
  
  const p = staticSqliteWasm.wasm.allocFromTypedArray(buffer);
  const db = new staticSqliteWasm.oo1.DB();
  
  const rc = staticSqliteWasm.capi.sqlite3_deserialize(
    db.pointer, 'main', p, buffer.byteLength, buffer.byteLength,
    staticSqliteWasm.capi.SQLITE_DESERIALIZE_FREEONCLOSE | staticSqliteWasm.capi.SQLITE_DESERIALIZE_READONLY
  );
  db.checkRc(rc);
  
  return new SqliteWasmAdapter(db);
}

export async function openNutritionDb(): Promise<DbAdapter> {
  console.log("--- OPENING NUTRITION DB ---");
  if (!nutritionOpenPromise) {
    nutritionOpenPromise = loadStaticDb(require('../../assets/nutrition.db'), 'nutrition.db');
  }
  return nutritionOpenPromise;
}

export async function openIfctDb(): Promise<DbAdapter> {
  if (!ifctOpenPromise) {
    ifctOpenPromise = loadStaticDb(require('../../assets/ifct.db'), 'ifct.db');
  }
  return ifctOpenPromise;
}

export function resetCorpusPromises(): void {
  nutritionOpenPromise = null;
  ifctOpenPromise = null;
}

/** P1-10: corpus-honesty metrics shipped INSIDE the artifact they describe. */
export interface DishKbHonesty {
  dishes: number
  fullyMapped: number | null
  yieldVerified: number | null
  builtAt: string | null
}

async function readDishKbHonesty(db: DbAdapter): Promise<DishKbHonesty | null> {
  try {
    const dishRows = await db.get<{ c: number }>('SELECT COUNT(*) c FROM dish_definitions');
    const dishes = dishRows?.c ?? 0;
    // Older bundles predate the dish_kb_* manifest keys — report what we know
    // (the count) and leave the honesty split null rather than guessing.
    const manifest = await db.all<{ key: string; value: string }>(
      "SELECT key, value FROM build_manifest WHERE key IN ('dish_kb_fully_mapped','dish_kb_yield_verified','dish_kb_built_at')",
    );
    const pick = (key: string) => manifest.find((row) => row.key === key)?.value ?? null;
    const fully = pick('dish_kb_fully_mapped');
    const verified = pick('dish_kb_yield_verified');
    return {
      dishes,
      fullyMapped: fully == null ? null : Number(fully),
      yieldVerified: verified == null ? null : Number(verified),
      builtAt: pick('dish_kb_built_at'),
    };
  } catch {
    return null;
  }
}

export async function nutritionCorpusInfo(db: DbAdapter): Promise<{ foods: number; portions: number; dishes: number; builtAt: string | null; dishKb: DishKbHonesty | null }> {
  const foods = await db.get<{ c: number }>('SELECT COUNT(*) c FROM foods');
  const portions = await db.get<{ c: number }>('SELECT COUNT(*) c FROM food_portions');
  const built = await db.get<{ value: string }>("SELECT value FROM build_manifest WHERE key = 'built_at'");
  // P2-14 + P1-10: dish KB size AND its honesty split, straight from the
  // shipped artifact's build_manifest.
  const dishKb = await readDishKbHonesty(db);
  return { foods: foods?.c ?? 0, portions: portions?.c ?? 0, dishes: dishKb?.dishes ?? 0, builtAt: built?.value ?? null, dishKb };
}

export async function ifctCorpusInfo(db: DbAdapter): Promise<{ foods: number; version: string | null }> {
  const foods = await db.get<{ c: number }>("SELECT COUNT(*) c FROM foods WHERE source = 'ifct'");
  const version = await db.get<{ value: string }>("SELECT value FROM build_manifest WHERE key = 'version'");
  return { foods: foods?.c ?? 0, version: version?.value ?? null };
}
