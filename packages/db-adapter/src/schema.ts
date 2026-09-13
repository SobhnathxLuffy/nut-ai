import { type DbAdapter } from "./types.js"
import { deterministicUuidV7 } from './uuid.js'
import { TRAINING_SQL, OPERATIONS_V10_SQL } from './phase3-schema.js'
/**
 * Schema DDL.
 *
 * SPEC-accuracy-engine.md §5.3. Two databases with deliberately separate
 * lifecycles, and the separation is licensing as much as engineering:
 *
 *   nutrition.db  read-only bundled asset. ODbL/CC0 DATA, shipped as a build
 *                 artifact from its own repo on its own release cadence.
 *   user.db       writable, local, user-owned. Never mixed with the corpus.
 *
 * Keeping them apart means a nutrition-database update can never mutate a
 * historical log, and the data license never has to interact with the code
 * license.
 */

/**
 * The read-only bundled corpus.
 *
 * TWO SCHEMA DECISIONS WORTH DEFENDING:
 *
 * 1. EXACTLY ONE COMPUTATIONAL BASIS, EVER. Every row is per-100 g.
 *    `serving_size_g` and `serving_desc` are display and portion-selection
 *    metadata only. Storing per-100 g AND per-serving as parallel "the" values is
 *    precisely what invites the two to drift and visibly disagree. There is one
 *    ground-truth number per nutrient per food; every serving figure a user sees
 *    is computed on the fly and never independently stored or rounded.
 *
 * 2. Micronutrients live in a sparse EAV table rather than hundreds of mostly-NULL
 *    columns, because under 20% of Open Food Facts entries carry any micronutrient
 *    data at all.
 */
export const NUTRITION_SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  id             INTEGER PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases_json   TEXT
);

CREATE TABLE IF NOT EXISTS foods (
  id                 INTEGER PRIMARY KEY,
  source             TEXT NOT NULL,
  source_id          TEXT,
  name               TEXT NOT NULL,
  brand_id           INTEGER REFERENCES brands(id),
  category           TEXT,
  prep_facet         TEXT,
  basis              TEXT NOT NULL DEFAULT 'per_100g',
  basis_confidence   TEXT NOT NULL DEFAULT 'high',
  serving_size_g     REAL,
  serving_desc       TEXT,
  barcode            TEXT,
  is_alcoholic       INTEGER NOT NULL DEFAULT 0,
  energy_kcal        REAL,
  protein_g          REAL,
  fat_g              REAL,
  sat_fat_g          REAL,
  carb_g             REAL,
  fiber_g            REAL,
  sugar_g            REAL,
  sodium_mg          REAL,
  density_g_per_ml   REAL,
  yield_factor       REAL,
  completeness_score REAL,
  popularity_rank    INTEGER,
  license            TEXT NOT NULL,
  updated_at         INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_barcode
  ON foods(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_foods_barcode_cover
  ON foods(barcode, name, brand_id, energy_kcal, protein_g, fat_g, carb_g);
CREATE INDEX IF NOT EXISTS idx_foods_popularity ON foods(popularity_rank);

CREATE TABLE IF NOT EXISTS food_micros (
  food_id       INTEGER REFERENCES foods(id),
  nutrient_code TEXT,
  amount        REAL,
  PRIMARY KEY (food_id, nutrient_code)
);

CREATE TABLE IF NOT EXISTS food_portions (
  id               INTEGER PRIMARY KEY,
  food_id          INTEGER REFERENCES foods(id),
  measure_unit     TEXT,
  modifier         TEXT,
  amount           REAL,
  gram_weight      REAL NOT NULL,
  is_fndds_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_portions_food ON food_portions(food_id, measure_unit);

CREATE TABLE IF NOT EXISTS food_synonyms (
  food_id      INTEGER REFERENCES foods(id),
  synonym      TEXT NOT NULL,
  synonym_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_synonyms_food ON food_synonyms(food_id);

CREATE TABLE IF NOT EXISTS build_manifest (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/**
 * FTS5 indexes, created separately so a build can fail loudly and specifically
 * when FTS5 is unavailable rather than failing somewhere deep in a resolver call.
 *
 * The porter tokenizer wraps unicode61 and applies English stemming
 * (eggs->egg, tomatoes->tomato, leaves->leaf), applied identically to indexed
 * content and to the query — so over-stemming (sauce->sauc) is irrelevant. It only
 * has to be internally consistent, which it is by construction.
 *
 * Word order needs no handling at all: FTS5 ANDs bareword tokens regardless of
 * order, so `chicken breast grilled` matches "Chicken, broilers or fryers, breast,
 * meat only, cooked, grilled". This is the concrete reason the system prompt
 * insists on generic-noun-first USDA-style keys — query and corpus share an idiom,
 * and BM25 rewards that.
 */
export const NUTRITION_FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS food_fts USING fts5(
  name, brand, synonyms,
  content='',
  tokenize = "porter unicode61 remove_diacritics 2"
);

CREATE VIRTUAL TABLE IF NOT EXISTS food_fts_trigram USING fts5(
  name,
  content='',
  tokenize = "trigram"
);
`

/**
 * The writable user database.
 *
 * THE INVARIANT THAT PAYS FOR EVERYTHING: log_items carries a per-100 g snapshot
 * COPIED at log time. The diary never joins live to `foods`.
 *
 * If the bundled corpus is updated in a later release — corrected USDA data, a
 * merged OFF update — historical entries must not silently change. A user's
 * Tuesday breakfast total must not shift because Thursday's app update fixed a
 * typo in the almond-butter row. That is a real, easy-to-miss correctness bug
 * class in food-logging apps, and snapshotting avoids it entirely.
 *
 * `raw_model_label` is retained so a future release CAN offer an explicit,
 * user-initiated "re-resolve old entries against the improved database" — opt-in,
 * never automatic.
 */
export const USER_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profile (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  sex                 TEXT,
  birth_year          INTEGER,
  height_cm           REAL,
  activity_level      TEXT,
  units               TEXT NOT NULL DEFAULT 'metric',
  weight_visible      INTEGER NOT NULL DEFAULT 1,
  gamification        INTEGER NOT NULL DEFAULT 1,
  inference_path      TEXT NOT NULL DEFAULT 'none',
  created_at          INTEGER NOT NULL
);

-- Append-only. A goal change is a new row, never an UPDATE, so a historical day
-- can always be read against the target that was actually in force that day.
CREATE TABLE IF NOT EXISTS goals (
  id                INTEGER PRIMARY KEY,
  effective_from    INTEGER NOT NULL,
  goal_type         TEXT NOT NULL,
  rate_lb_per_week  REAL,
  target_kcal       REAL NOT NULL,
  target_raw_kcal   REAL NOT NULL,
  floor_applied     INTEGER NOT NULL DEFAULT 0,
  protein_g         REAL NOT NULL,
  fat_g             REAL NOT NULL,
  carbs_g           REAL NOT NULL,
  bmr               REAL NOT NULL,
  tdee              REAL NOT NULL,
  adaptive          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_foods (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  brand               TEXT,
  barcode             TEXT,
  basis               TEXT NOT NULL DEFAULT 'per_100g',
  serving_size_g      REAL,
  energy_kcal         REAL,
  protein_g           REAL,
  fat_g               REAL,
  carb_g              REAL,
  fiber_g             REAL,
  sugar_g             REAL,
  sodium_mg           REAL,
  source_photo_uri    TEXT,
  pending_resolution  INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER,
  synced_to_community INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meals (
  id                     INTEGER PRIMARY KEY,
  -- Local capture time is preserved so an 11pm meal does not migrate days when
  -- the user flies across a timezone.
  logged_at              INTEGER NOT NULL,
  local_date             TEXT NOT NULL,
  meal_slot              TEXT,
  photo_uri              TEXT,
  portion_eaten_fraction REAL NOT NULL DEFAULT 1.0,
  -- IS the queue. Not a separate table: nothing to lose on app kill.
  analysis_status        TEXT NOT NULL DEFAULT 'captured',
  retry_count            INTEGER NOT NULL DEFAULT 0,
  next_retry_at          INTEGER,
  engine_id              TEXT,
  prompt_version         TEXT,
  schema_version         TEXT,
  clamp_flags_json       TEXT,
  created_at             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(local_date);
CREATE INDEX IF NOT EXISTS idx_meals_status ON meals(analysis_status);

CREATE TABLE IF NOT EXISTS log_items (
  id                  INTEGER PRIMARY KEY,
  meal_id             INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  matched_food_id     INTEGER,
  matched_food_source TEXT NOT NULL,
  raw_model_label     TEXT,
  display_name        TEXT NOT NULL,
  grams               REAL NOT NULL,
  gram_pathway        TEXT NOT NULL,
  portion_source      TEXT NOT NULL,
  snap_energy_kcal    REAL,
  snap_protein_g      REAL,
  snap_fat_g          REAL,
  snap_carb_g         REAL,
  snap_fiber_g        REAL,
  snap_sugar_g        REAL,
  snap_sodium_mg      REAL,
  is_estimate         INTEGER NOT NULL DEFAULT 0,
  macros_user_edited  INTEGER NOT NULL DEFAULT 0,
  band_half_pct       REAL,
  assumptions_json    TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  logged_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_items_meal ON log_items(meal_id);

CREATE TABLE IF NOT EXISTS weight_entries (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  weight_kg  REAL NOT NULL,
  logged_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS water_entries (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL,
  ml         REAL NOT NULL,
  logged_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_entries (
  id           INTEGER PRIMARY KEY,
  local_date   TEXT NOT NULL,
  name         TEXT NOT NULL,
  kcal         REAL NOT NULL,
  -- Provenance, so a workout read from Health and the same workout entered by
  -- hand are never both counted.
  provenance   TEXT NOT NULL,
  external_id  TEXT,
  logged_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_external
  ON exercise_entries(external_id) WHERE external_id IS NOT NULL;

-- Fully derivable from meals + log_items. Droppable and rebuildable with
-- identical results — that is a property test, not a hope.
CREATE TABLE IF NOT EXISTS day_summaries (
  local_date     TEXT PRIMARY KEY,
  kcal           REAL NOT NULL DEFAULT 0,
  protein_g      REAL NOT NULL DEFAULT 0,
  fat_g          REAL NOT NULL DEFAULT 0,
  carbs_g        REAL NOT NULL DEFAULT 0,
  fiber_g        REAL NOT NULL DEFAULT 0,
  sodium_mg      REAL NOT NULL DEFAULT 0,
  pending_count  INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_gram_priors (
  food_concept_key  TEXT PRIMARY KEY,
  ewma_ratio        REAL NOT NULL,
  ratio_variance    REAL NOT NULL,
  sample_count      INTEGER NOT NULL,
  median_grams      REAL,
  last_corrected_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS food_attribute_memory (
  food_concept_key TEXT NOT NULL,
  attribute        TEXT NOT NULL,
  value            TEXT NOT NULL,
  answer_count     INTEGER NOT NULL DEFAULT 1,
  last_answered_at INTEGER NOT NULL,
  PRIMARY KEY (food_concept_key, attribute)
);

CREATE TABLE IF NOT EXISTS user_containers (
  id          INTEGER PRIMARY KEY,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  usable_ml   REAL,
  diameter_mm REAL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_meals (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  -- Stores the CORRECTED ingredient array, so relogging issues zero network
  -- requests and surfaces zero chips.
  items_json     TEXT NOT NULL,
  use_count      INTEGER NOT NULL DEFAULT 0,
  last_used_at   INTEGER,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_cost_ledger (
  id             INTEGER PRIMARY KEY,
  meal_id        INTEGER,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  cost_usd       REAL NOT NULL,
  local_month    TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_month ON scan_cost_ledger(local_month);

-- Content-hash keyed, so the same photo submitted twice costs nothing the second
-- time.
CREATE TABLE IF NOT EXISTS scan_cache (
  content_hash   TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  key        TEXT PRIMARY KEY,
  granted    INTEGER NOT NULL,
  granted_at INTEGER NOT NULL,
  detail     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Regenerated by the eval harness. Every displayed range traces to a row here;
-- no band width is ever hardcoded in the UI.
CREATE TABLE IF NOT EXISTS accuracy_baselines (
  stratum        TEXT NOT NULL,
  pathway        TEXT NOT NULL,
  half_pct       REAL NOT NULL,
  -- 'seeded' until the golden set replaces it with 'measured'. The accuracy page
  -- shows which is which, because shipping a fabricated "measured" range would be
  -- a worse dishonesty than saying nothing.
  provenance     TEXT NOT NULL,
  sample_count   INTEGER,
  measured_at    INTEGER,
  PRIMARY KEY (stratum, pathway)
);
`

/** Current user-schema version. Bump with every migration added below. */
export const USER_SCHEMA_VERSION = 10

export interface Migration {
  up?: (db: DbAdapter, now: number) => Promise<void>
  version: number
  sql: string
}

/**
 * Forward-only migrations.
 *
 * Version 1 is the whole baseline schema. Every later version is additive.
 * Migration tests run forward from EVERY shipped version, because a user who
 * skipped three releases must land in the same place as one who took all of them.
 */

export const USER_SCHEMA_V2_SQL = `
ALTER TABLE meals ADD COLUMN uuid TEXT;
ALTER TABLE meals ADD COLUMN updated_at INTEGER;
ALTER TABLE meals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meals ADD COLUMN deleted_at INTEGER;
ALTER TABLE meals ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_meals_uuid ON meals(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE log_items ADD COLUMN uuid TEXT;
ALTER TABLE log_items ADD COLUMN created_at INTEGER;
ALTER TABLE log_items ADD COLUMN updated_at INTEGER;
ALTER TABLE log_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE log_items ADD COLUMN deleted_at INTEGER;
ALTER TABLE log_items ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_log_items_uuid ON log_items(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE weight_entries ADD COLUMN uuid TEXT;
ALTER TABLE weight_entries ADD COLUMN created_at INTEGER;
ALTER TABLE weight_entries ADD COLUMN updated_at INTEGER;
ALTER TABLE weight_entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE weight_entries ADD COLUMN deleted_at INTEGER;
ALTER TABLE weight_entries ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_entries_uuid ON weight_entries(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE water_entries ADD COLUMN uuid TEXT;
ALTER TABLE water_entries ADD COLUMN created_at INTEGER;
ALTER TABLE water_entries ADD COLUMN updated_at INTEGER;
ALTER TABLE water_entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE water_entries ADD COLUMN deleted_at INTEGER;
ALTER TABLE water_entries ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_entries_uuid ON water_entries(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE exercise_entries ADD COLUMN uuid TEXT;
ALTER TABLE exercise_entries ADD COLUMN created_at INTEGER;
ALTER TABLE exercise_entries ADD COLUMN updated_at INTEGER;
ALTER TABLE exercise_entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE exercise_entries ADD COLUMN deleted_at INTEGER;
ALTER TABLE exercise_entries ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_entries_uuid ON exercise_entries(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE user_foods ADD COLUMN uuid TEXT;
ALTER TABLE user_foods ADD COLUMN updated_at INTEGER;
ALTER TABLE user_foods ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_foods ADD COLUMN deleted_at INTEGER;
ALTER TABLE user_foods ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_foods_uuid ON user_foods(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE saved_meals ADD COLUMN uuid TEXT;
ALTER TABLE saved_meals ADD COLUMN updated_at INTEGER;
ALTER TABLE saved_meals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE saved_meals ADD COLUMN deleted_at INTEGER;
ALTER TABLE saved_meals ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_meals_uuid ON saved_meals(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE user_containers ADD COLUMN uuid TEXT;
ALTER TABLE user_containers ADD COLUMN updated_at INTEGER;
ALTER TABLE user_containers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_containers ADD COLUMN deleted_at INTEGER;
ALTER TABLE user_containers ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_containers_uuid ON user_containers(uuid) WHERE uuid IS NOT NULL;

ALTER TABLE goals ADD COLUMN uuid TEXT;
ALTER TABLE goals ADD COLUMN created_at INTEGER;
ALTER TABLE goals ADD COLUMN updated_at INTEGER;
ALTER TABLE goals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE goals ADD COLUMN deleted_at INTEGER;
ALTER TABLE goals ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_uuid ON goals(uuid) WHERE uuid IS NOT NULL;
`

export async function backfillV2(db: DbAdapter, now: number): Promise<void> {
  const meals = await db.all<{ id: number; created_at: number | null }>('SELECT id, created_at FROM meals WHERE uuid IS NULL')
  for (const m of meals) {
    const ts = m.created_at ?? now
    await db.run('UPDATE meals SET uuid = ?, updated_at = coalesce(updated_at, ?) WHERE id = ?', [deterministicUuidV7(ts, `meals:${m.id}`), ts, m.id])
  }

  const items = await db.all<{ id: number; logged_at: number | null }>('SELECT id, logged_at FROM log_items WHERE uuid IS NULL')
  for (const i of items) {
    const ts = i.logged_at ?? now
    await db.run(
      'UPDATE log_items SET uuid = ?, created_at = coalesce(created_at, ?), updated_at = coalesce(updated_at, ?) WHERE id = ?',
      [deterministicUuidV7(ts, `log_items:${i.id}`), ts, ts, i.id],
    )
  }

  const weights = await db.all<{ id: number; logged_at: number | null }>('SELECT id, logged_at FROM weight_entries WHERE uuid IS NULL')
  for (const w of weights) {
    const ts = w.logged_at ?? now
    await db.run(
      'UPDATE weight_entries SET uuid = ?, created_at = coalesce(created_at, ?), updated_at = coalesce(updated_at, ?) WHERE id = ?',
      [deterministicUuidV7(ts, `weight_entries:${w.id}`), ts, ts, w.id],
    )
  }

  const exercises = await db.all<{ id: number; logged_at: number | null }>('SELECT id, logged_at FROM exercise_entries WHERE uuid IS NULL')
  for (const e of exercises) {
    const ts = e.logged_at ?? now
    await db.run(
      'UPDATE exercise_entries SET uuid = ?, created_at = coalesce(created_at, ?), updated_at = coalesce(updated_at, ?) WHERE id = ?',
      [deterministicUuidV7(ts, `exercise_entries:${e.id}`), ts, ts, e.id],
    )
  }

  const foods = await db.all<{ id: number; created_at: number | null }>('SELECT id, created_at FROM user_foods WHERE uuid IS NULL')
  for (const f of foods) {
    const ts = f.created_at ?? now
    await db.run('UPDATE user_foods SET uuid = ?, updated_at = coalesce(updated_at, ?) WHERE id = ?', [deterministicUuidV7(ts, `user_foods:${f.id}`), ts, f.id])
  }

  const saved = await db.all<{ id: number; created_at: number | null }>('SELECT id, created_at FROM saved_meals WHERE uuid IS NULL')
  for (const s of saved) {
    const ts = s.created_at ?? now
    await db.run('UPDATE saved_meals SET uuid = ?, updated_at = coalesce(updated_at, ?) WHERE id = ?', [deterministicUuidV7(ts, `saved_meals:${s.id}`), ts, s.id])
  }

  const containers = await db.all<{ id: number; created_at: number | null }>('SELECT id, created_at FROM user_containers WHERE uuid IS NULL')
  for (const c of containers) {
    const ts = c.created_at ?? now
    await db.run('UPDATE user_containers SET uuid = ?, updated_at = coalesce(updated_at, ?) WHERE id = ?', [deterministicUuidV7(ts, `user_containers:${c.id}`), ts, c.id])
  }

  const goals = await db.all<{ id: number; effective_from: number | null }>('SELECT id, effective_from FROM goals WHERE uuid IS NULL')
  for (const g of goals) {
    const ts = g.effective_from ?? now
    await db.run(
      'UPDATE goals SET uuid = ?, created_at = coalesce(created_at, ?), updated_at = coalesce(updated_at, ?) WHERE id = ?',
      [deterministicUuidV7(ts, `goals:${g.id}`), ts, ts, g.id],
    )
  }
}

export const USER_SCHEMA_V3_SQL = `
CREATE TABLE IF NOT EXISTS day_status (
  local_date   TEXT PRIMARY KEY,
  completion   TEXT NOT NULL DEFAULT 'unknown' CHECK (completion IN ('complete', 'partial', 'unknown', 'fasting')),
  confirmed_at INTEGER,
  updated_at   INTEGER NOT NULL,
  actor        TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'system', 'auto')),
  provenance   TEXT
);
`

export const USER_SCHEMA_V4_SQL = `
CREATE TABLE IF NOT EXISTS operations (
  id              INTEGER PRIMARY KEY,
  uuid            TEXT NOT NULL UNIQUE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('meals', 'weight_entries', 'exercise_entries', 'goals', 'user_foods', 'saved_meals', 'user_containers')),
  entity_id       INTEGER NOT NULL,
  op_type         TEXT NOT NULL CHECK (op_type IN ('insert', 'update', 'delete')),
  prev_json       TEXT,
  new_json        TEXT,
  actor           TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'system', 'sync', 'auto')),
  idempotency_key TEXT,
  created_at      INTEGER NOT NULL,
  undone_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_operations_entity ON operations(entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_idempotency ON operations(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at);
`

/** Repair databases that reached v4 while the Phase 1 implementation was under review. */
export const USER_SCHEMA_V5_SQL = `
CREATE TRIGGER IF NOT EXISTS validate_day_status_insert
BEFORE INSERT ON day_status
WHEN NEW.completion NOT IN ('complete', 'partial', 'unknown', 'fasting')
  OR NEW.actor NOT IN ('user', 'system', 'auto')
BEGIN
  SELECT RAISE(ABORT, 'invalid day_status value');
END;

CREATE TRIGGER IF NOT EXISTS validate_day_status_update
BEFORE UPDATE ON day_status
WHEN NEW.completion NOT IN ('complete', 'partial', 'unknown', 'fasting')
  OR NEW.actor NOT IN ('user', 'system', 'auto')
BEGIN
  SELECT RAISE(ABORT, 'invalid day_status value');
END;

CREATE TRIGGER IF NOT EXISTS validate_operations_insert
BEFORE INSERT ON operations
WHEN NEW.entity_type NOT IN ('meals', 'weight_entries', 'exercise_entries', 'goals', 'user_foods', 'saved_meals', 'user_containers')
  OR NEW.op_type NOT IN ('insert', 'update', 'delete')
  OR NEW.actor NOT IN ('user', 'system', 'sync', 'auto')
BEGIN
  SELECT RAISE(ABORT, 'invalid operation value');
END;

`

/** Keep the already-device-tested v5 migration immutable. */
export const USER_SCHEMA_V6_SQL = `
CREATE TRIGGER IF NOT EXISTS validate_operations_update
BEFORE UPDATE ON operations
WHEN NEW.entity_type NOT IN ('meals', 'weight_entries', 'exercise_entries', 'goals', 'user_foods', 'saved_meals', 'user_containers')
  OR NEW.op_type NOT IN ('insert', 'update', 'delete')
  OR NEW.actor NOT IN ('user', 'system', 'sync', 'auto')
BEGIN
  SELECT RAISE(ABORT, 'invalid operation value');
END;
`

/**
 * Forward-only migrations.
 *
 * Version 1 is the whole baseline schema. Every later version is additive.
 * Migration tests run forward from EVERY shipped version, because a user who
 * skipped three releases must land in the same place as one who took all of them.
 */
export const USER_SCHEMA_V7_SQL = `
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS recipe_versions (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  version_number INTEGER NOT NULL,
  preparation TEXT NOT NULL CHECK(preparation IN ('boiled', 'fried', 'roasted', 'raw')),
  added_oil_g REAL NOT NULL DEFAULT 0,
  added_water_g REAL NOT NULL DEFAULT 0,
  final_cooked_weight_g REAL NOT NULL,
  servings REAL NOT NULL,
  created_at INTEGER NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'local',
  UNIQUE(recipe_id, version_number)
);

CREATE TABLE IF NOT EXISTS recipe_components (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  recipe_version_id INTEGER NOT NULL REFERENCES recipe_versions(id),
  food_id TEXT NOT NULL,
  gram_weight REAL NOT NULL,
  created_at INTEGER NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'local'
);
`

/**
 * Forward-only repair for the initial recipe migration. Recipe components hold
 * immutable nutrient snapshots so later source-data updates cannot rewrite a
 * recipe version's nutrition.
 */
export const USER_SCHEMA_V8_SQL = `
ALTER TABLE recipes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE recipe_versions ADD COLUMN updated_at INTEGER;
ALTER TABLE recipe_versions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recipe_versions ADD COLUMN deleted_at INTEGER;

ALTER TABLE recipe_components ADD COLUMN snap_energy_kcal REAL;
ALTER TABLE recipe_components ADD COLUMN snap_protein_g REAL;
ALTER TABLE recipe_components ADD COLUMN snap_fat_g REAL;
ALTER TABLE recipe_components ADD COLUMN snap_carb_g REAL;
ALTER TABLE recipe_components ADD COLUMN snap_fiber_g REAL;
ALTER TABLE recipe_components ADD COLUMN snap_sugar_g REAL;
ALTER TABLE recipe_components ADD COLUMN snap_sodium_mg REAL;
ALTER TABLE recipe_components ADD COLUMN updated_at INTEGER;
ALTER TABLE recipe_components ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recipe_components ADD COLUMN deleted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_recipe_versions_recipe ON recipe_versions(recipe_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_components_version ON recipe_components(recipe_version_id);
`

/** Add recipe display snapshots and make aggregate recipe changes undoable. */
export const USER_SCHEMA_V9_SQL = `
ALTER TABLE recipe_components ADD COLUMN display_name TEXT;

DROP TRIGGER IF EXISTS validate_operations_insert;
DROP TRIGGER IF EXISTS validate_operations_update;
DROP INDEX IF EXISTS idx_operations_entity;
DROP INDEX IF EXISTS idx_operations_idempotency;
DROP INDEX IF EXISTS idx_operations_created_at;
ALTER TABLE operations RENAME TO operations_v8;

CREATE TABLE operations (
  id              INTEGER PRIMARY KEY,
  uuid            TEXT NOT NULL UNIQUE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('meals', 'weight_entries', 'exercise_entries', 'goals', 'user_foods', 'saved_meals', 'user_containers', 'recipes')),
  entity_id       INTEGER NOT NULL,
  op_type         TEXT NOT NULL CHECK (op_type IN ('insert', 'update', 'delete')),
  prev_json       TEXT,
  new_json        TEXT,
  actor           TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'system', 'sync', 'auto')),
  idempotency_key TEXT,
  created_at      INTEGER NOT NULL,
  undone_at       INTEGER
);

INSERT INTO operations
  (id, uuid, entity_type, entity_id, op_type, prev_json, new_json, actor, idempotency_key, created_at, undone_at)
SELECT id, uuid, entity_type, entity_id, op_type, prev_json, new_json, actor, idempotency_key, created_at, undone_at
FROM operations_v8;
DROP TABLE operations_v8;

CREATE INDEX idx_operations_entity ON operations(entity_type, entity_id);
CREATE UNIQUE INDEX idx_operations_idempotency ON operations(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_operations_created_at ON operations(created_at);

CREATE TRIGGER validate_operations_insert
BEFORE INSERT ON operations
WHEN NEW.entity_type NOT IN ('meals', 'weight_entries', 'exercise_entries', 'goals', 'user_foods', 'saved_meals', 'user_containers', 'recipes')
  OR NEW.op_type NOT IN ('insert', 'update', 'delete')
  OR NEW.actor NOT IN ('user', 'system', 'sync', 'auto')
BEGIN
  SELECT RAISE(ABORT, 'invalid operation value');
END;

CREATE TRIGGER validate_operations_update
BEFORE UPDATE ON operations
WHEN NEW.entity_type NOT IN ('meals', 'weight_entries', 'exercise_entries', 'goals', 'user_foods', 'saved_meals', 'user_containers', 'recipes')
  OR NEW.op_type NOT IN ('insert', 'update', 'delete')
  OR NEW.actor NOT IN ('user', 'system', 'sync', 'auto')
BEGIN
  SELECT RAISE(ABORT, 'invalid operation value');
END;
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: USER_SCHEMA },
  { version: 2, sql: USER_SCHEMA_V2_SQL, up: backfillV2 },
  { version: 3, sql: USER_SCHEMA_V3_SQL },
  { version: 4, sql: USER_SCHEMA_V4_SQL },
  { version: 5, sql: USER_SCHEMA_V5_SQL, up: backfillV2 },
  { version: 6, sql: USER_SCHEMA_V6_SQL },
  { version: 7, sql: USER_SCHEMA_V7_SQL },
  { version: 8, sql: USER_SCHEMA_V8_SQL },
  { version: 9, sql: USER_SCHEMA_V9_SQL },
  { version: 10, sql: TRAINING_SQL + OPERATIONS_V10_SQL },
]

export const DISH_KB_SCHEMA = `
CREATE TABLE IF NOT EXISTS dish_definitions (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  category TEXT NOT NULL,
  family TEXT NOT NULL,
  parent_dish_id TEXT,
  cooking_methods_json TEXT,
  yield_model_json TEXT,
  recipe_template_json TEXT NOT NULL,
  portion_model_json TEXT NOT NULL,
  uncertainty_model_json TEXT,
  resolver_config_json TEXT,
  record_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dish_aliases (
  dish_id TEXT REFERENCES dish_definitions(id),
  alias TEXT NOT NULL,
  is_search_term INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dish_aliases ON dish_aliases(dish_id);
`;

export const DISH_KB_FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS dish_fts USING fts5(
  canonical_name, aliases, search_terms,
  content='',
  tokenize = "porter unicode61 remove_diacritics 2"
);

CREATE VIRTUAL TABLE IF NOT EXISTS dish_fts_trigram USING fts5(
  canonical_name, aliases,
  content='',
  tokenize = "trigram"
);
`;
