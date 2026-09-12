import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncMetadata, migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { orderTimeline, timeline, type TimelineEvent } from './index.js'

const NOW = 1_760_000_000_000
const TODAY = '2025-10-09'
const TOMORROW = '2025-10-10'

describe('Timeline Event Contract (TLN-001)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)
  })

  it('orders timeline events deterministically by timestamp, type priority, and id', () => {
    const events: TimelineEvent[] = [
      {
        id: 'workout:b',
        type: 'workout',
        entity_id: 2,
        at: 1000,
        local_date: TODAY,
        label: 'Evening Workout',
        detail: 'completed',
        deleted: false,
      },
      {
        id: 'meal:a',
        type: 'meal',
        entity_id: 1,
        at: 1000,
        local_date: TODAY,
        label: 'Breakfast',
        detail: 'Eggs',
        deleted: false,
      },
      {
        id: 'weight:c',
        type: 'weight',
        entity_id: 3,
        at: 1000,
        local_date: TODAY,
        label: 'Bodyweight',
        detail: '75 kg',
        deleted: false,
      },
      {
        id: 'meal:z',
        type: 'meal',
        entity_id: 4,
        at: 500,
        local_date: TODAY,
        label: 'Early Snack',
        detail: 'Apple',
        deleted: false,
      },
    ]

    const sorted = orderTimeline(events)
    // Earliest timestamp first (at = 500)
    expect(sorted[0]?.id).toBe('meal:z')

    // At = 1000: priority is meal (0) < weight (1) < workout (3)
    expect(sorted[1]?.id).toBe('meal:a')
    expect(sorted[2]?.id).toBe('weight:c')
    expect(sorted[3]?.id).toBe('workout:b')
  })

  it('validates date boundaries and throws on invalid or inverted ranges', async () => {
    await expect(timeline(db, 'invalid-date')).rejects.toThrow()
    await expect(timeline(db, TOMORROW, TODAY)).rejects.toThrow('Invalid date range')
  })

  it('aggregates multi-entity timeline events across meals, weights, exercises, workouts, and day status', async () => {
    const sync1 = createSyncMetadata(NOW + 1000)
    // 1. Seed meal
    await db.run(
      `INSERT INTO meals (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, engine_id)
       VALUES (1, ?, ?, ?, 1, NULL, 'local', ?, ?, 'breakfast', 1.0, 'complete', 'v1')`,
      [sync1.uuid, sync1.created_at, sync1.updated_at, NOW + 1000, TODAY],
    )
    await db.run(
      `INSERT INTO log_items (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        meal_id, matched_food_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
        snap_energy_kcal, sort_order, logged_at)
       VALUES (10, ?, ?, ?, 1, NULL, 'local', 1, 101, 'ifct', 'Poha', 150, 'scale', 'user', 220, 0, ?)`,
      [sync1.uuid, sync1.created_at, sync1.updated_at, NOW + 1000],
    )

    // 2. Seed weight entry
    const sync2 = createSyncMetadata(NOW + 500)
    await db.run(
      `INSERT INTO weight_entries (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        local_date, weight_kg, logged_at)
       VALUES (1, ?, ?, ?, 1, NULL, 'local', ?, 74.5, ?)`,
      [sync2.uuid, sync2.created_at, sync2.updated_at, TODAY, NOW + 500],
    )

    // 3. Seed exercise entry (cardio/activity)
    const sync3 = createSyncMetadata(NOW + 2000)
    await db.run(
      `INSERT INTO exercise_entries (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        local_date, name, kcal, provenance, logged_at)
       VALUES (1, ?, ?, ?, 1, NULL, 'local', ?, 'Cycling', 300, 'manual', ?)`,
      [sync3.uuid, sync3.created_at, sync3.updated_at, TODAY, NOW + 2000],
    )

    // 4. Seed workout
    const sync4 = createSyncMetadata(NOW + 3000)
    await db.run(
      `INSERT INTO workouts (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        name, local_date, started_at, finished_at, status)
       VALUES (1, ?, ?, ?, 1, NULL, 'local', 'Leg Day', ?, ?, ?, 'completed')`,
      [sync4.uuid, sync4.created_at, sync4.updated_at, TODAY, NOW + 3000, NOW + 6000],
    )

    // 5. Seed day status
    await db.run(
      `INSERT INTO day_status (local_date, completion, confirmed_at, updated_at, actor, provenance)
       VALUES (?, 'complete', ?, ?, 'user', 'timeline')`,
      [TODAY, NOW + 7000, NOW + 7000],
    )

    const events = await timeline(db, TODAY, TODAY)
    expect(events.length).toBe(5)

    const types = events.map((e) => e.type)
    expect(types).toContain('weight')
    expect(types).toContain('meal')
    expect(types).toContain('exercise')
    expect(types).toContain('workout')
    expect(types).toContain('day_status')

    // Confirm detail formatting
    const mealEvent = events.find((e) => e.type === 'meal')
    expect(mealEvent?.detail).toContain('Poha')

    const weightEvent = events.find((e) => e.type === 'weight')
    expect(weightEvent?.detail).toBe('74.5 kg')

    const exEvent = events.find((e) => e.type === 'exercise')
    expect(exEvent?.detail).toContain('kcal activity')
  })

  it('filters deleted events unless includeUndo is true', async () => {
    const sync = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO meals (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, engine_id)
       VALUES (1, ?, ?, ?, 1, ?, 'local', ?, ?, 'lunch', 1.0, 'complete', 'v1')`,
      [sync.uuid, sync.created_at, sync.updated_at, NOW + 500, NOW, TODAY],
    )

    // Normal timeline ignores deleted meal
    const normalEvents = await timeline(db, TODAY, TODAY, false)
    expect(normalEvents.length).toBe(0)

    // includeUndo=true exposes deleted meal with deleted=true flag
    const undoEvents = await timeline(db, TODAY, TODAY, true)
    expect(undoEvents.length).toBe(1)
    expect(undoEvents[0]?.deleted).toBe(true)
  })

  it('includes weekly check-in accepted events from goals operations', async () => {
    const sync = createSyncMetadata(NOW)
    const adaptiveEvidence = JSON.stringify({ local_date: TODAY, tdee: 2200 })
    const newJson = JSON.stringify({ target_kcal: 2050, adaptive_evidence_json: adaptiveEvidence })

    await db.run(
      `INSERT INTO operations (id, uuid, entity_type, entity_id, op_type, new_json, actor, created_at, undone_at)
       VALUES (1, ?, 'goals', 1, 'insert', ?, 'user', ?, NULL)`,
      [sync.uuid, newJson, NOW],
    )

    const events = await timeline(db, TODAY, TODAY)
    const checkin = events.find((e) => e.type === 'checkin')
    expect(checkin).toBeDefined()
    expect(checkin?.label).toBe('Weekly check-in accepted')
  })

  it('imports cleanly under bare Node without React Native dependencies', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.timeline).toBe('function')
    expect(typeof mod.orderTimeline).toBe('function')
  })
})
