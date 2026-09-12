# Training Engine Specification

## Overview
The Training Engine tracks and plans workouts. It supports highly customizable routines, dynamic active workout tracking, and progressive overload analytics.

## 1. Exercise Tracking Types
1. **Weight & Reps**: e.g., Bench Press, Bicep Curls.
2. **Bodyweight & Reps**: e.g., Push-ups, Pull-ups (allows added weight).
3. **Distance & Time**: e.g., Running, Cycling, Rowing.
4. **Time Only**: e.g., Planks, Wall Sits.
5. **Reps Only**: e.g., Crunches (speed independent).
6. **Weight & Time**: e.g., Farmer's Walk.
7. **Distance Only**: e.g., Long jumps.
8. **Calisthenics/Assisted**: e.g., Band-assisted pull-ups.

## 2. Set Types
1. **Normal**: Standard working set.
2. **Warm-up**: Pre-working set (Excludes from primary progressive overload analytics and volume totals).
3. **Drop Set**: Immediate set with lower weight.
4. **Failure**: Pushed until technical failure.
5. **AMRAP**: As many reps as possible.
6. **Myo-Reps**: Rest-pause sets.
7. **Cluster**: Mini-sets with short intra-set rest.
8. **Cooldown**: Final stretching/light movement.

## 3. Planned vs. Actual Values
Workouts exist in two states: `Planned` (template/target) and `Actual` (executed).
- During execution, the UI displays `Planned` values faintly and pre-fills them into the `Actual` inputs for quick 1-tap confirmation.

## 4. Custom Exercises
Users can define custom exercises. The schema for custom exercises is identical to built-in exercises. They behave exactly the same in analytics, search, and substitution.

## 5. Active Workout UI Requirements
- **Inputs**: Large touch targets for weight and reps.
- **Previous Values**: Always displays the last session's performance inline.
- **Prefill**: Auto-populates inputs with target or previous values.
- **Rest Timer**: Floating, non-blocking timer that auto-starts upon checking off a set.
- **Notes**: Per-exercise and per-workout text fields.
- **Superset/Circuit**: Visual bracketing connecting multiple exercises, grouping sets logically (A1, B1, A2, B2).

## 6. Active Workout Persistence
- **Auto-save**: Every keystroke/checkbox is immediately persisted to SQLite (or local storage).
- **Recovery**: Immune to app crashes, backgrounding, OS process death, and device reboots. Upon reopening, the app immediately resumes the `Active Workout` state without data loss.

## 7. Mini-card outside Train tab
While a workout is active, navigating to the Nutrition or Profile tabs displays a persistent "Active Workout" mini-player (similar to a Spotify now-playing bar) to quickly jump back.

## 8. Routines vs. Programs vs. Quick Workouts
- **Routines**: Single predefined workout template (e.g., "Push Day").
- **Programs**: Multi-week schedules of Routines (e.g., "PPL 12-Week").
- **Quick Workouts**: Ad-hoc, empty workouts started instantly on the gym floor.

## 9. Simple vs. Advanced Mode
- **Progressive Disclosure**: By default, the UI hides RPE, Rest time per set, and Tempo. Users can toggle "Advanced Mode" to reveal these metrics globally or per-exercise.

## 10. Built-in Exercise Library
- **Source**: Initial seed of ~300 Creative Commons / OpenSource exercises.
- **Taxonomy**: Exercises mapped to Primary, Secondary, and Antagonist muscle groups.
- **Data Model**: `exercises(id, name, tracking_type, equipment_id, body_part, instructions)`.

## 11. Tempo Notation and Advanced Sets
- When "Advanced Mode" is on, sets can track **Tempo** (e.g., "3-1-1-0" = 3s eccentric, 1s pause, 1s concentric, 0s pause).
- Sets track RPE (Rate of Perceived Exertion) and RIR (Reps in Reserve).

## 12. Superset and Circuit Grouping
- Schema uses `superset_group_id` UUID and `sort_order` within the `workout_exercises` join table.
- **UI Logic**: A1, B1, A2, B2. The Active Workout view brackets these vertically. The rest timer only triggers after the *last* exercise in the circuit group is completed.
