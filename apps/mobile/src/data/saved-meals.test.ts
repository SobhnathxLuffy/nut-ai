import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncMetadata, migrate, undoOperation, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { IngredientRow } from '@nutai/core-schema'
import { insertSavedMeal } from './saved-meals'

/**
 * P1-3 (QA report Cycle 2) — the saved_meals writer.
 *
 * The Saved Foods screen reads this table, but until this module NOTHING in
 * the app wrote it (only the backup import did): "saving" a meal from the
 * timeline filled logging_shortcuts and left the screen permanently empty.
 * These tests pin the acceptance path: save action → row exists → the screen's
 * own read returns it, parseable through the screen's own contract.
 */

const NOW = 1_760_000_000_000

describe('insertSavedMeal (P1-3)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON')
    await migrate(db, NOW)
  })

  /**
   * Seeds one meal with log_items shaped EXACTLY like logMeal's writes — every
   * column the mapping reads is exercised, including the columns the manual
   * writer leaves null (raw_model_label, band_half_pct, assumptions_json).
   */
  async function seedMeal(mealId: number, itemNames: string[]): Promise<void> {
    const sync = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO meals (
        id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction, analysis_status, engine_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mealId, sync.uuid, sync.created_at, sync.updated_at, sync.revision, null, sync.sync_state,
        NOW, '2025-10-09', 'lunch', 'file:///photo.jpg', 1.0, 'complete', 'vision-v1',
      ],
    )
    for (const [i, name] of itemNames.entries()) {
      const itemSync = createSyncMetadata(NOW)
      await db.run(
        `INSERT INTO log_items (
          id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
          meal_id, matched_food_id, matched_food_source, raw_model_label, display_name, grams,
          gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
          snap_fiber_g, snap_sugar_g, snap_sodium_mg, is_estimate, macros_user_edited,
          band_half_pct, assumptions_json, sort_order, logged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mealId * 100 + i, itemSync.uuid, itemSync.created_at, itemSync.updated_at, itemSync.revision,
          null, itemSync.sync_state,
          mealId, 101 + i, 'corpus', i === 0 ? 'https://example.com/label' : null, name, 150 + i * 10,
          'fndds_standard_portion', 'vision_model', 200 + i, 10, 5, 25,
          3, 1, 300, i === 1 ? 1 : 0, i === 1 ? 1 : 0,
          0.2, JSON.stringify([{ type: 'oil_added', gramsEquiv: 8, userConfirmed: true }]), i, NOW,
        ],
      )
    }
  }

  /** The exact read app/saved-foods.tsx performs. */
  const savedFoodsRead = () =>
    db.all<{ id: number; name: string; use_count: number; items_json: string }>(
      'SELECT id, name, use_count, items_json FROM saved_meals ORDER BY use_count DESC, last_used_at DESC',
    )

  it('save action → row exists → the saved-foods read returns it, parseable through the screen contract', async () => {
    await seedMeal(1, ['Toor dal', 'Chapati'])
    const id = await insertSavedMeal(db, 1, 'Toor dal, Chapati', NOW + 1000)

    const rows = await savedFoodsRead()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(id)
    expect(rows[0]!.name).toBe('Toor dal, Chapati')
    expect(rows[0]!.use_count).toBe(0)

    // The screen's parse guard: an array of rows with displayName + grams.
    const parsed: unknown = JSON.parse(rows[0]!.items_json)
    expect(Array.isArray(parsed)).toBe(true)
    const savedRows = parsed as IngredientRow[]
    expect(savedRows).toHaveLength(2)
    expect(typeof savedRows[0]!.displayName).toBe('string')
    expect(typeof savedRows[0]!.grams).toBe('number')

    // The corrected-row mapping survives with its provenance: the web-lookup
    // URL (stored in raw_model_label) rides sourceUrl, the food id comes back
    // as the string form logMeal wrote FROM, the per-100 g snapshot is intact
    // and null micros stay null (never zero).
    const dal = savedRows[0]!
    expect(dal.sourceFoodId).toBe('101')
    expect(dal.sourceUrl).toBe('https://example.com/label')
    expect(dal.grams).toBe(150)
    expect(dal.nutrientSnapshot).toMatchObject({ kcal: 200, protein_g: 10, fat_g: 5, carbs_g: 25, fiber_g: 3 })
    // The estimate row keeps its flags and assumption tags.
    const chapati = savedRows[1]!
    expect(chapati.isEstimate).toBe(true)
    expect(chapati.macrosUserEdited).toBe(true)
    expect(chapati.assumptions).toEqual([{ type: 'oil_added', gramsEquiv: 8, userConfirmed: true }])
  })

  it('the row carries the backup-import INSERT shape, so export/restore round-trips', async () => {
    await seedMeal(2, ['Rice'])
    await insertSavedMeal(db, 2, 'Rice', NOW + 2000)
    const row = await db.get<Record<string, unknown>>('SELECT * FROM saved_meals WHERE name = ?', ['Rice'])
    // Schema-v1 columns plus the v2 sync columns the backup import backfills.
    for (const column of ['name', 'items_json', 'use_count', 'last_used_at', 'created_at',
      'uuid', 'updated_at', 'revision', 'deleted_at', 'sync_state']) {
      expect(row, `column ${column}`).toHaveProperty(column)
    }
    expect(row!['uuid']).toMatch(/^[0-9a-f-]{36}$/)
    expect(row!['deleted_at']).toBeNull()
  })

  it('re-saving the same name refreshes the stored rows instead of duplicating them', async () => {
    await seedMeal(3, ['Poha'])
    await insertSavedMeal(db, 3, 'Poha', NOW + 3000)
    await insertSavedMeal(db, 3, 'Poha', NOW + 4000)
    const rows = await db.all<{ id: number; updated_at: number }>(
      'SELECT id, updated_at FROM saved_meals WHERE name = ?',
      ['Poha'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.updated_at).toBe(NOW + 4000)
  })

  it('different names stack as separate saved meals', async () => {
    await seedMeal(4, ['Idli'])
    await seedMeal(5, ['Upma'])
    await insertSavedMeal(db, 4, 'Idli', NOW + 5000)
    await insertSavedMeal(db, 5, 'Upma', NOW + 6000)
    expect(await savedFoodsRead()).toHaveLength(2)
  })

  it('a row without its per-100 g core numbers refuses the save honestly — never zeroes', async () => {
    const sync = createSyncMetadata(NOW)
    await db.run(
      `INSERT INTO meals (id, uuid, created_at, updated_at, revision, deleted_at, sync_state,
        logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status)
       VALUES (6, ?, ?, ?, ?, ?, ?, ?, '2025-10-09', 'lunch', 1.0, 'complete')`,
      [sync.uuid, sync.created_at, sync.updated_at, sync.revision, sync.deleted_at, sync.sync_state, NOW],
    )
    await db.run(
      `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway,
        portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, sort_order, logged_at)
       VALUES (6, 'estimate', 'Mystery', 100, 'model_guess', 'vision_model', NULL, NULL, NULL, NULL, 0, ?)`,
      [NOW],
    )
    await expect(insertSavedMeal(db, 6, 'Mystery', NOW + 7000)).rejects.toThrow(
      /no stored nutrition snapshot/,
    )
    expect(await savedFoodsRead()).toHaveLength(0)
  })

  it('the write is ledgered: undo removes the saved meal row', async () => {
    await seedMeal(7, ['Dosa'])
    await insertSavedMeal(db, 7, 'Dosa', NOW + 8000)
    expect(await savedFoodsRead()).toHaveLength(1)

    const op = await db.get<{ id: number; entity_type: string; op_type: string }>(
      'SELECT id, entity_type, op_type FROM operations WHERE entity_type = ? ORDER BY id DESC LIMIT 1',
      ['saved_meals'],
    )
    expect(op).not.toBeNull()
    expect(op!.op_type).toBe('insert')

    const result = await undoOperation(db, op!.id, NOW + 9000)
    expect(result.success).toBe(true)
    expect(await savedFoodsRead()).toHaveLength(0)
  })

  it('a meal with no live items cannot be saved (nothing to relog)', async () => {
    await seedMeal(8, ['Vada'])
    await db.run('UPDATE log_items SET deleted_at = ? WHERE meal_id = 8', [NOW + 100])
    await expect(insertSavedMeal(db, 8, 'Vada', NOW + 10_000)).rejects.toThrow(/no longer exists/)
  })
})
