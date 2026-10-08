import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './node.js'
import { MIGRATIONS, USER_SCHEMA_VERSION } from './schema.js'
import { currentVersion, migrate } from './migrate.js'

/**
 * Schema v12 — honesty persistence (honesty-contract round follow-up, O6).
 *
 * log_items gains the per-row quality disclosures the scan computes (contract
 * v1.3.0: visibility, portionRange, qualitativeAmount, preparation); meals
 * gains the meal-level honesty snapshot (honesty_json). Everything is
 * nullable and additive, so the acceptance bar is exactly the AGENTS §10
 * forward-only discipline: a populated v11 database upgrades with its data
 * intact, a fresh database lands at v12, and the runner cannot go back.
 */
const NOW = 1_754_300_000_000

const LOG_ITEM_COLUMNS = [
  'visibility',
  'qualitative_amount',
  'portion_min_g',
  'portion_max_g',
  'preparation_json',
] as const

async function tableColumns(db: ReturnType<typeof openMemoryDb>, table: string): Promise<string[]> {
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(${table})`)
  return cols.map((c) => c.name)
}

describe('schema v12 honesty persistence', () => {
  it('migrates a populated v11 database without changing logged data', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW, 11)
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction,
                          analysis_status, created_at, uuid)
       VALUES (7, ?, '2026-08-01', 'lunch', 1.0, 'complete', ?,
               '01992820-0000-7000-8000-000000000007')`,
      [NOW, NOW],
    )
    await db.run(
      `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams,
                              gram_pathway, portion_source, snap_energy_kcal, is_estimate,
                              band_half_pct, sort_order, logged_at, uuid)
       VALUES (70, 7, 'corpus', 'Dal', 180, 'fndds_standard_portion', 'vision_model',
               120, 0, 0.375, 0, ?, '01992820-0000-7000-8000-000000000070')`,
      [NOW],
    )

    const result = await migrate(db, NOW + 1)
    expect(result.applied).toEqual([12, 13, 14])
    expect(await currentVersion(db)).toBe(USER_SCHEMA_VERSION)

    // Pre-v12 rows keep every number they had…
    const item = await db.get<{
      display_name: string
      grams: number
      snap_energy_kcal: number
      band_half_pct: number
    }>('SELECT display_name, grams, snap_energy_kcal, band_half_pct FROM log_items WHERE id = 70')
    expect(item).toEqual({
      display_name: 'Dal',
      grams: 180,
      snap_energy_kcal: 120,
      band_half_pct: 0.375,
    })
    // …and every new column exists, reading NULL — "no claim", not a default.
    const columns = await tableColumns(db, 'log_items')
    for (const col of LOG_ITEM_COLUMNS) expect(columns).toContain(col)
    const legacy = await db.get<{
      visibility: string | null
      qualitative_amount: string | null
      portion_min_g: number | null
      portion_max_g: number | null
      preparation_json: string | null
    }>('SELECT visibility, qualitative_amount, portion_min_g, portion_max_g, preparation_json FROM log_items WHERE id = 70')
    expect(legacy).toEqual({
      visibility: null,
      qualitative_amount: null,
      portion_min_g: null,
      portion_max_g: null,
      preparation_json: null,
    })
    const mealColumns = await tableColumns(db, 'meals')
    expect(mealColumns).toContain('honesty_json')
    const meal = await db.get<{ honesty_json: string | null }>('SELECT honesty_json FROM meals WHERE id = 7')
    expect(meal!.honesty_json).toBeNull()
  })

  it('a fresh database lands at the current version with the new columns accepting their closed sets', async () => {
    const db = openMemoryDb()
    const result = await migrate(db, NOW)
    expect(result.to).toBe(USER_SCHEMA_VERSION)
    expect(result.applied.at(-1)).toBe(14)

    await db.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, analysis_status, honesty_json, created_at)
       VALUES (?, '2026-08-01', 'lunch', 'complete', ?, ?)`,
      [NOW, JSON.stringify({ mealBand: { halfPct: 0.3, tier: 'moderate', reasons: [] } }), NOW],
    )
    await db.run(
      `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway,
                              portion_source, snap_energy_kcal, is_estimate, sort_order, logged_at,
                              visibility, qualitative_amount, portion_min_g, portion_max_g, preparation_json)
       VALUES (1, 'corpus', 'Roti', 60, 'fndds_standard_portion', 'vision_model', 300, 0, 0, ?,
               'likely', 'moderate', 45, 75, ?)`,
      [NOW, JSON.stringify({ method: 'tawa', intrinsicFat: 'low', addedCookingFat: 'none', confidence: 0.6 })],
    )
    const row = await db.get<{
      visibility: string
      qualitative_amount: string
      portion_min_g: number
      portion_max_g: number
    }>('SELECT visibility, qualitative_amount, portion_min_g, portion_max_g FROM log_items')
    expect(row).toEqual({ visibility: 'likely', qualitative_amount: 'moderate', portion_min_g: 45, portion_max_g: 75 })
  })

  it('rejects values outside the closed sets instead of laundering them', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    await db.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, analysis_status, created_at)
       VALUES (?, '2026-08-01', 'lunch', 'complete', ?)`,
      [NOW, NOW],
    )
    await expect(
      db.run(
        `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway,
                                portion_source, is_estimate, sort_order, logged_at, visibility)
         VALUES (1, 'corpus', 'X', 10, 'model_guess', 'vision_model', 0, 0, ?, 'hallucinated')`,
        [NOW],
      ),
    ).rejects.toThrow()
    // NULL is not a value outside the set — legacy writers keep compiling and
    // writing no-claim rows.
    await db.run(
      `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway,
                              portion_source, is_estimate, sort_order, logged_at)
       VALUES (1, 'corpus', 'Y', 10, 'model_guess', 'vision_model', 0, 1, ?)`,
      [NOW],
    )
    const rows = await db.all<{ visibility: string | null }>('SELECT visibility FROM log_items ORDER BY id')
    expect(rows).toEqual([{ visibility: null }])
  })

  it('keeps the chain forward-only: v1 immutable, v14 last, no downgrade path', () => {
    expect(MIGRATIONS[0]?.version).toBe(1)
    expect(MIGRATIONS.at(-1)?.version).toBe(14)
    // No migration in the chain carries a `down` — the runner only knows up.
    expect(MIGRATIONS.some((m) => 'down' in m)).toBe(false)
  })

  it('cannot downgrade a v14 database by asking for an older target', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    // A lower explicit target must not un-apply v14 or mutate the schema.
    const result = await migrate(db, NOW + 1, 11)
    expect(result.applied).toEqual([])
    expect(await currentVersion(db)).toBe(14)
    const columns = await tableColumns(db, 'log_items')
    expect(columns).toContain('visibility')
  })

  it('is idempotent: re-running migrate on a fully-migrated database applies nothing', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    const again = await migrate(db, NOW + 1000)
    expect(again.applied).toEqual([])
    expect(await currentVersion(db)).toBe(14)
  })
})
