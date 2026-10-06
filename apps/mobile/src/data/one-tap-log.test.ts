import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncMetadata, listOperations, migrate, undoOperation, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { localDate, slotFor } from './date-utils'
import { mealSnapshot, saveShortcut, type MealSnapshot } from './shortcuts'
import {
  oneTapCardFromRecentFood,
  oneTapCardFromShortcut,
  oneTapLog,
  presetGramsFromSnapshot,
  recentFoodsWithGrams,
  snapshotForCurrentSlot,
} from './one-tap-log'

/**
 * One-tap logging (UI/UX report Ch. 8.3 / §7.1, Wave 3 Food write surface).
 *
 * The derivations are pure (slot from time of day, preset grams from the
 * immutable snapshot); the write itself is pinned to the repo's ONE repeat
 * path (immutable snapshot copy + recordOperation provenance + Undo revert) —
 * never an ad-hoc INSERT.
 */

const NOW = 1_760_000_000_000

/** Local-time helper so slot boundaries are explicit regardless of TZ. */
function at(hour: number, minute = 0): number {
  return new Date(2025, 9, 9, hour, minute, 0, 0).getTime()
}

function snapshot(grams: number[], slot: string): MealSnapshot {
  return {
    meal: { meal_slot: slot, logged_at: NOW, local_date: '2025-10-09', portion_eaten_fraction: 1 },
    items: grams.map((g, i) => ({ uuid: `u${i}`, display_name: `Item ${i}`, grams: g, snap_energy_kcal: 100 })),
  } as unknown as MealSnapshot
}

describe('one-tap derivations (pure)', () => {
  it('derives the current slot from time of day with the exact logMeal boundaries', () => {
    // slotFor's boundaries (date-utils): <11 breakfast, <16 lunch, <21 dinner, else snack.
    expect(snapshotForCurrentSlot(snapshot([100], 'breakfast'), at(10, 59)).meal['meal_slot']).toBe('breakfast')
    expect(snapshotForCurrentSlot(snapshot([100], 'breakfast'), at(11, 0)).meal['meal_slot']).toBe('lunch')
    expect(snapshotForCurrentSlot(snapshot([100], 'dinner'), at(15, 59)).meal['meal_slot']).toBe('lunch')
    expect(snapshotForCurrentSlot(snapshot([100], 'breakfast'), at(16, 0)).meal['meal_slot']).toBe('dinner')
    expect(snapshotForCurrentSlot(snapshot([100], 'lunch'), at(20, 59)).meal['meal_slot']).toBe('dinner')
    expect(snapshotForCurrentSlot(snapshot([100], 'lunch'), at(21, 0)).meal['meal_slot']).toBe('snack')
  })

  it('keeps the rest of the copied meal byte-identical when re-slotting', () => {
    const snap = snapshot([150, 273.5], 'breakfast')
    const reSlotted = snapshotForCurrentSlot(snap, at(12))
    expect(reSlotted).not.toBe(snap)
    expect(reSlotted.meal['logged_at']).toBe(NOW)
    expect(reSlotted.meal['portion_eaten_fraction']).toBe(1)
    expect(reSlotted.items).toBe(snap.items)
    expect(snap.meal['meal_slot']).toBe('breakfast') // input not mutated
  })

  it('derives the gram preset as the snapshot mass the repeat will write', () => {
    expect(presetGramsFromSnapshot(snapshot([150, 273.5], 'lunch'))).toBeCloseTo(423.5)
    expect(presetGramsFromSnapshot(snapshot([], 'lunch'))).toBe(0)
    const nullGrams = snapshot([], 'lunch')
    nullGrams.items = [{ grams: null }, { grams: 50 }] as unknown as MealSnapshot['items']
    // A null gram counts as 0, not NaN — the card must never show "NaN g".
    expect(presetGramsFromSnapshot(nullGrams)).toBe(50)
  })

  it('parses shortcut rows into cards; corrupt JSON degrades to null', async () => {
    const db = await seededDb()
    await seedMeal(db, 1, 'breakfast', 'Oats bowl', 150, NOW - 86_400_000)
    const shortcutId = await saveShortcut(db, 1, 'favorite', 'Morning oats', NOW)
    // Re-read: Shortcut rows come from the DB in the screen's shape.
    const row = await db.get<{ id: number; meal_id: number; name: string; kind: 'favorite'; snapshot_json: string }>(
      'SELECT * FROM logging_shortcuts WHERE id = ?',
      [shortcutId],
    )
    const card = oneTapCardFromShortcut(row!)
    expect(card).not.toBeNull()
    expect(card!.name).toBe('Morning oats')
    expect(card!.source).toBe('favorite')
    expect(card!.presetGrams).toBe(150)
    expect(card!.snapshot).not.toBeNull()

    expect(oneTapCardFromShortcut({ ...row!, snapshot_json: '{not json' })).toBeNull()
    expect(oneTapCardFromShortcut({ ...row!, snapshot_json: '{"meal":{}}' })).toBeNull()
  })

  it('derives recent-food cards that snapshot their latest meal at write time', () => {
    const card = oneTapCardFromRecentFood(
      { id: 7, name: 'Dal tadka', last_used_at: NOW, frequency: 3, grams: 273 },
      'recent',
    )
    expect(card.key).toBe('recent-7')
    expect(card.name).toBe('Dal tadka')
    expect(card.presetGrams).toBe(273)
    expect(card.snapshot).toBeNull()
    expect(card.mealId).toBe(7)
    expect(card.source).toBe('recent')
  })
})

describe('one-tap logging (the write)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = await seededDb()
  })

  it('logs the meal for the CURRENT slot with the preset grams, via the repeat path', async () => {
    await seedMeal(db, 1, 'breakfast', 'Oats bowl', 150, NOW - 86_400_000)
    const recent = await recentFoodsWithGrams(db, NOW)
    expect(recent.length).toBe(1)
    expect(recent[0]!.grams).toBe(150)

    const noon = new Date(NOW)
    noon.setHours(12, 30, 0, 0)
    const card = oneTapCardFromRecentFood(recent[0]!, 'recent')
    const mealId = await oneTapLog(db, card, noon.getTime())

    const meal = await db.get<{ meal_slot: string; local_date: string; analysis_status: string }>(
      'SELECT meal_slot, local_date, analysis_status FROM meals WHERE id = ?',
      [mealId],
    )
    // The slot is re-derived from the tap time (12:30 → lunch), NOT the
    // original breakfast slot, and the grams are the preset 150.
    expect(meal!.meal_slot).toBe(slotFor(noon.getTime()))
    expect(meal!.meal_slot).toBe('lunch')
    expect(meal!.local_date).toBe(localDate(noon.getTime()))
    expect(meal!.analysis_status).toBe('complete')
    const grams = await db.get<{ total: number }>('SELECT SUM(grams) total FROM log_items WHERE meal_id = ?', [mealId])
    expect(grams!.total).toBe(150)
  })

  it('snapshot cards (shortcuts) repeat their stored provenance byte-identically', async () => {
    await seedMeal(db, 1, 'dinner', 'Dal tadka', 273, NOW - 86_400_000)
    const shortcutId = await saveShortcut(db, 1, 'favorite', 'Evening dal', NOW)
    const row = await db.get<{ id: number; meal_id: number; name: string; kind: 'favorite'; snapshot_json: string }>(
      'SELECT * FROM logging_shortcuts WHERE id = ?',
      [shortcutId],
    )
    const card = oneTapCardFromShortcut(row!)!
    const mealId = await oneTapLog(db, card, NOW)
    const original = await mealSnapshot(db, 1)
    const copy = await mealSnapshot(db, mealId)
    // Same items, same grams, same per-100g snapshots — only ids/slots differ.
    expect(copy.items.length).toBe(original.items.length)
    expect(copy.items[0]!.display_name).toBe(original.items[0]!.display_name)
    expect(copy.items[0]!.grams).toBe(original.items[0]!.grams)
    expect(copy.items[0]!.snap_energy_kcal).toBe(original.items[0]!.snap_energy_kcal)
  })

  it('is fully reversible: undo removes the one-tap meal and its items', async () => {
    await seedMeal(db, 1, 'breakfast', 'Oats bowl', 150, NOW - 86_400_000)
    const recent = await recentFoodsWithGrams(db, NOW)
    const mealId = await oneTapLog(db, oneTapCardFromRecentFood(recent[0]!, 'recent'), NOW)

    const before = await db.get<{ n: number }>('SELECT COUNT(*) n FROM meals WHERE deleted_at IS NULL')
    expect(before!.n).toBe(2)

    const ops = await listOperations(db, { limit: 1 })
    const op = ops[0]!
    expect(op.entity_type).toBe('batch')

    await undoOperation(db, op.uuid)

    const after = await db.get<{ n: number }>('SELECT COUNT(*) n FROM meals WHERE deleted_at IS NULL')
    expect(after!.n).toBe(1)
    const items = await db.get<{ n: number }>('SELECT COUNT(*) n FROM log_items WHERE meal_id = ? AND deleted_at IS NULL', [mealId])
    expect(items!.n).toBe(0)
  })

  it('refuses honestly when the card points at a deleted meal', async () => {
    await seedMeal(db, 1, 'breakfast', 'Oats bowl', 150, NOW - 86_400_000)
    await db.run('UPDATE meals SET deleted_at = ? WHERE id = 1', [NOW])
    const card = oneTapCardFromRecentFood({ id: 1, name: 'Oats bowl', last_used_at: NOW, frequency: 1, grams: 150 }, 'recent')
    await expect(oneTapLog(db, card, NOW)).rejects.toThrow('Meal no longer exists')
  })

  it('recentFoodsWithGrams keeps recentFoods ranking and attaches each latest meal mass', async () => {
    await seedMeal(db, 1, 'dinner', 'Dal tadka', 273, NOW - 2 * 86_400_000)
    await seedMeal(db, 2, 'dinner', 'Dal tadka', 300, NOW - 86_400_000)
    await seedMeal(db, 3, 'lunch', 'Roti + sabzi', 240, NOW - 86_400_000)
    const recents = await recentFoodsWithGrams(db, NOW)
    expect(recents.length).toBe(2)
    const dal = recents.find((r) => r.name === 'Dal tadka')!
    // MAX(m.id) picks meal 2 — the preset is its 300 g, not the older 273.
    expect(dal.id).toBe(2)
    expect(dal.grams).toBe(300)
    expect(dal.frequency).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function seededDb(): Promise<DbAdapter> {
  const db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON')
  await migrate(db, NOW)
  return db
}

async function seedMeal(
  db: DbAdapter,
  id: number,
  slot: string,
  foodName: string,
  grams: number,
  loggedAt: number,
): Promise<void> {
  const sync = createSyncMetadata(loggedAt)
  await db.run(
    `INSERT INTO meals (
      id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
      logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction, analysis_status, engine_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sync.uuid,
      sync.created_at,
      sync.updated_at,
      sync.revision,
      null,
      sync.sync_state,
      loggedAt,
      localDate(loggedAt),
      slot,
      null,
      1.0,
      'complete',
      'vision-v1',
    ],
  )
  await db.run(
    `INSERT INTO log_items (
      id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
      meal_id, matched_food_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
      snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
      is_estimate, sort_order, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id * 10,
      sync.uuid,
      sync.created_at,
      sync.updated_at,
      sync.revision,
      null,
      sync.sync_state,
      id,
      101,
      'ifct',
      foodName,
      grams,
      'scale',
      'user',
      250,
      15,
      6,
      30,
      4,
      2,
      400,
      0,
      0,
      loggedAt,
    ],
  )
}
