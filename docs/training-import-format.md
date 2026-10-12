# Routines & Programs JSON Import — Format Guide

The bulk importer lives at **Profile → Your data → Import routines & programs** (also on the **Train** tab). One JSON file can carry any number of routines and programs. Exercises resolve **by name** against the exercise library — IDs are install-dependent and should be avoided. Nothing is written until you tap **Import**; anything that fails validation is listed item-by-item and skipped, never aborting the batch.

## Minimal envelope

```json
{
  "format": "nutai.training-import",
  "version": 1,
  "routines": [],
  "programs": []
}
```

Both `format` and `version` are required — they keep a full-backup file from being imported here by mistake. `routines` and/or `programs` must contain at least one entry.

## Routine

| Field | Required | Notes |
|---|---|---|
| `name` | yes | 1–120 chars; duplicates inside the file (or within it) are rejected |
| `exercises` | yes | 1–100 entries |

Each **exercise entry**:

| Field | Required | Notes |
|---|---|---|
| `exercise` | yes* | Exact library name or alias, e.g. `"Barbell Bench Press"`, `"bench"`. *Or* `exercise_id` (numeric, install-dependent — prefer names). |
| `sets` | yes | 1–100 set objects (see below) |
| `group` | no | Superset/circuit label (`"A"`, `"B"`, …) or `null` |
| `rule` | no | Progression rule; defaults to double progression `{"kind":"double"}` |
| `rest_seconds` | no | 0–600; omit for the app's global default |

### Sets — what each tracking type requires

Sets are validated by the same engine the editors use. Per set, provide the fields your exercise's tracking type needs (unknown fields are rejected):

| Tracking type (library names) | Required per set |
|---|---|
| `weight_reps` (barbell/dumbbell/machine/cable lifts) | `load_kg` + `reps` (reps > 0; `load_kg: 0` = empty bar) |
| `bodyweight_reps` (Bodyweight Push-up, Pull-up…) | `reps` > 0; `load_kg` (added weight) optional, defaults to `0` |
| `reps` (Crunch, Burpee…) | `reps` > 0 |
| `time` (Plank, Dead Hang…) | `duration_s` > 0 |
| `distance_time` (Running, Cycling…) | `distance_m` + `duration_s`, both > 0 |
| `distance` (Broad Jump…) | `distance_m` > 0 |
| `weight_time` (Farmer Carry…) | `load_kg` + `duration_s` |
| `assisted` (Assisted Pull-up…) | `reps` > 0; `assistance_kg` optional, defaults to `0` |

### Progression rules

`rule` is optional. Kinds: `double` (default; add `increment`, `min_reps`, `max_reps`, `target_rir` to override the defaults 2.5 kg / 8–12 reps / RIR 2), `fixed`, `percentage`, `rir`, `manual`, `program`.

## Program

| Field | Required | Notes |
|---|---|---|
| `name` | yes | 1–120 chars |
| `start_date` | yes | `YYYY-MM-DD` — the day Week 1 Day 0 falls on |
| `weeks` | yes | 1–104 |
| `schedule` | yes | 1–7 entries, one per cycle day; two entries on the same day are rejected |

Each **schedule entry**:

| Field | Notes |
|---|---|
| `day` | A weekday name `"Mon"`…`"Sun"` (converted against `start_date` exactly like the editor), or a number `0`–`6` meaning the *cycle* day (`0` = the start date itself) |
| `routine` | A routine name from this file, a name of one of your existing routines, or a numeric `routine_id` |

## Full example

The same example ships inside the app ("Show example → Load this example") and is locked by tests:

```json
{
  "format": "nutai.training-import",
  "version": 1,
  "routines": [
    {
      "name": "Push Day A",
      "exercises": [
        {
          "exercise": "Barbell Bench Press",
          "sets": [
            { "load_kg": 60, "reps": 8 },
            { "load_kg": 60, "reps": 8 },
            { "load_kg": 60, "reps": 10 }
          ],
          "rule": { "kind": "double", "increment": 2.5, "min_reps": 8, "max_reps": 12 },
          "rest_seconds": 120
        },
        {
          "exercise": "Cable Triceps Pushdown",
          "group": "A",
          "sets": [
            { "load_kg": 25, "reps": 12 },
            { "load_kg": 25, "reps": 12 }
          ],
          "rest_seconds": 60
        },
        {
          "exercise": "Bodyweight Push-up",
          "group": "A",
          "sets": [
            { "load_kg": 0, "reps": 15 },
            { "load_kg": 0, "reps": 12 }
          ],
          "rest_seconds": 60
        }
      ]
    },
    {
      "name": "Pull Day A",
      "exercises": [
        {
          "exercise": "Barbell Bent Over Row",
          "sets": [
            { "load_kg": 50, "reps": 8 },
            { "load_kg": 50, "reps": 8 },
            { "load_kg": 52.5, "reps": 6 }
          ]
        },
        {
          "exercise": "Machine Lat Pulldown",
          "sets": [
            { "load_kg": 45, "reps": 10 },
            { "load_kg": 45, "reps": 10 }
          ]
        },
        {
          "exercise": "Plank",
          "sets": [
            { "duration_s": 45 },
            { "duration_s": 60 }
          ]
        }
      ]
    }
  ],
  "programs": [
    {
      "name": "Autumn Block",
      "start_date": "2026-10-12",
      "weeks": 6,
      "schedule": [
        { "day": "Mon", "routine": "Push Day A" },
        { "day": "Thu", "routine": "Pull Day A" }
      ]
    }
  ]
}
```

## Guarantees

- Writes go through `saveRoutine`/`saveProgram` — zod-validated, transactional, individually undoable (Profile → any screen's undo, or the operations ledger).
- Import **adds** rows; it never replaces or deletes existing data. Use the backup import (replaces everything) only for full restores.
- A routine that fails to write drops only the programs that referenced it, with the reason listed on screen.
- Caps per file: 100 routines, 100 programs, 100 exercises per routine, 100 sets per exercise.
