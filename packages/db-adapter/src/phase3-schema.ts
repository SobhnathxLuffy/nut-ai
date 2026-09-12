/** Forward-only training and repeat logging storage. Metric values throughout. */
const identity = `uuid TEXT NOT NULL UNIQUE CHECK(length(uuid)=36), created_at INTEGER NOT NULL,
 updated_at INTEGER, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), deleted_at INTEGER,
 sync_state TEXT NOT NULL DEFAULT 'local' CHECK(sync_state IN ('local','pending','synced','conflict'))`
export const TRAINING_TABLES = ['exercises', 'equipment_inventory', 'routines', 'programs', 'workouts', 'workout_exercises', 'workout_sets', 'logging_shortcuts'] as const
export const TRAINING_SQL = `
ALTER TABLE goals ADD COLUMN adaptive_evidence_json TEXT;
CREATE TABLE exercises (id INTEGER PRIMARY KEY, ${identity}, name TEXT NOT NULL CHECK(length(trim(name))>0),
 tracking_type TEXT NOT NULL CHECK(tracking_type IN ('weight_reps','bodyweight_reps','distance_time','time','reps','weight_time','distance','assisted')),
 aliases_json TEXT NOT NULL CHECK(json_valid(aliases_json)), primary_muscles_json TEXT NOT NULL CHECK(json_valid(primary_muscles_json)),
 secondary_muscles_json TEXT NOT NULL DEFAULT '[]', antagonist_muscles_json TEXT NOT NULL DEFAULT '[]', equipment_json TEXT NOT NULL DEFAULT '[]',
 notes TEXT NOT NULL DEFAULT '', media_uri TEXT, is_custom INTEGER NOT NULL DEFAULT 1 CHECK(is_custom IN (0,1)), source TEXT NOT NULL DEFAULT 'user');
CREATE TABLE equipment_inventory (id INTEGER PRIMARY KEY, ${identity}, name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('barbell','dumbbell','ez_bar','trap_bar','plate','machine','band','kettlebell','cable','bench')),
 weight_kg REAL NOT NULL CHECK(weight_kg>=0 AND weight_kg<=1000), count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 100 AND count=CAST(count AS INTEGER)));
CREATE TABLE routines (id INTEGER PRIMARY KEY, ${identity}, name TEXT NOT NULL, definition_json TEXT NOT NULL CHECK(json_valid(definition_json)));
CREATE TABLE programs (id INTEGER PRIMARY KEY, ${identity}, name TEXT NOT NULL, definition_json TEXT NOT NULL CHECK(json_valid(definition_json)));
CREATE TABLE workouts (id INTEGER PRIMARY KEY, ${identity}, name TEXT NOT NULL, local_date TEXT NOT NULL,
 started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','discarded')),
 notes TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', routine_id INTEGER REFERENCES routines(id), rest_until INTEGER,
 CHECK((status='completed' AND finished_at IS NOT NULL) OR (status!='completed' AND finished_at IS NULL)));
CREATE UNIQUE INDEX one_active_workout ON workouts(status) WHERE status='active' AND deleted_at IS NULL;
CREATE INDEX workouts_date ON workouts(local_date, status);
CREATE TABLE workout_exercises (id INTEGER PRIMARY KEY, ${identity}, workout_id INTEGER NOT NULL REFERENCES workouts(id),
 exercise_id INTEGER NOT NULL REFERENCES exercises(id), sort_order INTEGER NOT NULL, superset_group_id TEXT, notes TEXT NOT NULL DEFAULT '',
 tracking_type TEXT NOT NULL CHECK(tracking_type IN ('weight_reps','bodyweight_reps','distance_time','time','reps','weight_time','distance','assisted')));
CREATE INDEX workout_exercises_parent ON workout_exercises(workout_id,sort_order);
CREATE TABLE workout_sets (id INTEGER PRIMARY KEY, ${identity}, workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id),
 sort_order INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'normal' CHECK(kind IN ('normal','warmup','drop','failure','amrap','myo','cluster','cooldown')),
 load_kg REAL CHECK(load_kg BETWEEN 0 AND 1500), reps INTEGER CHECK(reps BETWEEN 0 AND 10000 AND reps=CAST(reps AS INTEGER)),
 duration_s REAL CHECK(duration_s BETWEEN 0 AND 604800), distance_m REAL CHECK(distance_m BETWEEN 0 AND 1000000),
 assistance_kg REAL CHECK(assistance_kg BETWEEN 0 AND 500), rir REAL CHECK(rir BETWEEN 0 AND 10), rpe REAL CHECK(rpe BETWEEN 1 AND 10), tempo TEXT,
 planned_json TEXT CHECK(planned_json IS NULL OR json_valid(planned_json)), completed_at INTEGER);
CREATE INDEX workout_sets_parent ON workout_sets(workout_exercise_id,sort_order);
CREATE TABLE logging_shortcuts (id INTEGER PRIMARY KEY, ${identity}, meal_id INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('favorite','usual','saved')), name TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)));
CREATE UNIQUE INDEX shortcut_unique ON logging_shortcuts(meal_id,kind) WHERE deleted_at IS NULL;
CREATE VIRTUAL TABLE exercise_search USING fts5(name, aliases, muscles, equipment, content='');
CREATE TRIGGER exercise_search_insert AFTER INSERT ON exercises BEGIN
 INSERT INTO exercise_search(rowid,name,aliases,muscles,equipment) VALUES(NEW.id,NEW.name,NEW.aliases_json,NEW.primary_muscles_json,NEW.equipment_json); END;
CREATE TRIGGER exercise_search_delete AFTER DELETE ON exercises BEGIN
 INSERT INTO exercise_search(exercise_search,rowid,name,aliases,muscles,equipment) VALUES('delete',OLD.id,OLD.name,OLD.aliases_json,OLD.primary_muscles_json,OLD.equipment_json); END;
CREATE TRIGGER exercise_search_update AFTER UPDATE ON exercises BEGIN
 INSERT INTO exercise_search(exercise_search,rowid,name,aliases,muscles,equipment) VALUES('delete',OLD.id,OLD.name,OLD.aliases_json,OLD.primary_muscles_json,OLD.equipment_json);
 INSERT INTO exercise_search(rowid,name,aliases,muscles,equipment) VALUES(NEW.id,NEW.name,NEW.aliases_json,NEW.primary_muscles_json,NEW.equipment_json); END;
${['INSERT','UPDATE'].map(action => `
CREATE TRIGGER validate_workout_set_${action.toLowerCase()} BEFORE ${action} ON workout_sets BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workout_exercises e WHERE e.id=NEW.workout_exercise_id AND (
 (NEW.load_kg IS NOT NULL AND e.tracking_type NOT IN ('weight_reps','bodyweight_reps','weight_time')) OR
 (NEW.reps IS NOT NULL AND e.tracking_type NOT IN ('weight_reps','bodyweight_reps','reps','assisted')) OR
 (NEW.duration_s IS NOT NULL AND e.tracking_type NOT IN ('distance_time','time','weight_time')) OR
 (NEW.distance_m IS NOT NULL AND e.tracking_type NOT IN ('distance_time','distance')) OR
 (NEW.assistance_kg IS NOT NULL AND e.tracking_type!='assisted') OR
 (NEW.completed_at IS NOT NULL AND (
 (e.tracking_type IN ('weight_reps','bodyweight_reps','weight_time') AND NEW.load_kg IS NULL) OR
 (e.tracking_type IN ('weight_reps','bodyweight_reps','reps','assisted') AND COALESCE(NEW.reps,0)<=0) OR
 (e.tracking_type IN ('distance_time','time','weight_time') AND COALESCE(NEW.duration_s,0)<=0) OR
 (e.tracking_type IN ('distance_time','distance') AND COALESCE(NEW.distance_m,0)<=0) OR
 (e.tracking_type='assisted' AND NEW.assistance_kg IS NULL)))))
 THEN RAISE(ABORT,'Invalid fields for exercise tracking type') END;
END;`).join('\n')}
CREATE TRIGGER immutable_tracking_type BEFORE UPDATE OF tracking_type ON workout_exercises
 WHEN NEW.tracking_type!=OLD.tracking_type BEGIN SELECT RAISE(ABORT,'Replace exercise instead of changing historical tracking type'); END;
`

export const NEW_OPERATION_ENTITIES = [...TRAINING_TABLES, 'day_status', 'batch']
export const OPERATIONS_V10_SQL = `
DROP TRIGGER validate_operations_insert;
DROP TRIGGER validate_operations_update;
DROP INDEX idx_operations_entity;
DROP INDEX idx_operations_idempotency;
DROP INDEX idx_operations_created_at;
ALTER TABLE operations RENAME TO operations_v9;
CREATE TABLE operations (
 id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('meals','weight_entries','exercise_entries','goals','user_foods','saved_meals','user_containers','recipes',${NEW_OPERATION_ENTITIES.map(n => `'${n}'`).join(',')})),
 entity_id INTEGER NOT NULL, op_type TEXT NOT NULL CHECK(op_type IN ('insert','update','delete')), prev_json TEXT, new_json TEXT,
 actor TEXT NOT NULL DEFAULT 'user' CHECK(actor IN ('user','system','sync','auto')), idempotency_key TEXT, created_at INTEGER NOT NULL, undone_at INTEGER);
INSERT INTO operations SELECT * FROM operations_v9;
DROP TABLE operations_v9;
CREATE INDEX idx_operations_entity ON operations(entity_type,entity_id);
CREATE UNIQUE INDEX idx_operations_idempotency ON operations(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_operations_created_at ON operations(created_at);
`
