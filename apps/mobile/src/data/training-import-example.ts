/**
 * The in-app example for the routines & programs JSON import — the exact
 * shape the importer accepts, exercised end-to-end by training-import.test.ts
 * so the sample can never drift from the real parser.
 */
export const TRAINING_IMPORT_EXAMPLE = `{
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
}`
