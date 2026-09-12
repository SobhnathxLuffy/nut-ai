import { describe, expect, it } from 'vitest'
import { detectCapabilities, migrate, currentVersion, USER_SCHEMA_VERSION, NUTRITION_SCHEMA, NUTRITION_FTS_SCHEMA } from './index.js'
import { openMemoryDb } from './node.js'

const NOW = 1_753_900_000_000

describe('capabilities are detected, never assumed', () => {
  it('confirms FTS5 and the trigram tokenizer are available', async () => {
    const db = openMemoryDb()
    const caps = await detectCapabilities(db)
    // FTS5 is REQUIRED. If this ever fails, the M0.5 gate says switch to
    // op-sqlite here and nowhere later.
    expect(caps.fts5).toBe(true)
    expect(caps.fts5Trigram).toBe(true)
    expect(caps.sqliteVersion).toMatch(/^\d+\.\d+/)
    await db.close()
  })
})

describe('migrations', () => {
  it('brings an empty database to the current version', async () => {
    const db = openMemoryDb()
    const r = await migrate(db, NOW)
    expect(r.from).toBe(0)
    expect(r.to).toBe(USER_SCHEMA_VERSION)
    expect(r.applied).toContain(1)
    await db.close()
  })

  it('is idempotent — running twice applies nothing the second time', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    const second = await migrate(db, NOW)
    expect(second.applied).toEqual([])
    expect(second.to).toBe(USER_SCHEMA_VERSION)
    await db.close()
  })

  it('records the version it reached', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    expect(await currentVersion(db)).toBe(USER_SCHEMA_VERSION)
    await db.close()
  })

  it('creates every table the app depends on', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    )
    const names = new Set(rows.map((r) => r.name))
    for (const t of [
      'user_profile', 'goals', 'meals', 'log_items', 'weight_entries', 'water_entries',
      'exercise_entries', 'day_summaries', 'personal_gram_priors', 'food_attribute_memory',
      'user_containers', 'saved_meals', 'scan_cost_ledger', 'scan_cache', 'consents',
      'settings', 'accuracy_baselines', 'user_foods', 'day_status', 'operations',
    ]) {
      expect(names, `missing table ${t}`).toContain(t)
    }
    await db.close()
  })
})

describe('transactions', () => {
  it('rolls back completely when the body throws', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)

    await expect(
      db.transaction(async (tx) => {
        await tx.run(
          'INSERT INTO meals (logged_at, local_date, analysis_status, created_at) VALUES (?,?,?,?)',
          [NOW, '2026-07-31', 'complete', NOW],
        )
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // A half-written meal is worse than no meal: the diary invariant is that
    // totals are derivable from the rows, and a partial ingredient array
    // satisfies that invariant while being silently wrong.
    const meals = await db.all('SELECT * FROM meals')
    expect(meals).toHaveLength(0)
    await db.close()
  })

  it('commits when the body succeeds', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    await db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO meals (logged_at, local_date, analysis_status, created_at) VALUES (?,?,?,?)',
        [NOW, '2026-07-31', 'complete', NOW],
      )
    })
    expect(await db.all('SELECT * FROM meals')).toHaveLength(1)
    await db.close()
  })
})

describe('the nutrition corpus schema', () => {
  it('builds and enforces one barcode per food', async () => {
    const db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.run(
      "INSERT INTO foods (id,source,name,barcode,license,energy_kcal) VALUES (1,'fdc_branded','Bar','012345678905','CC0',400)",
    )
    await expect(
      db.run(
        "INSERT INTO foods (id,source,name,barcode,license,energy_kcal) VALUES (2,'off','Other Bar','012345678905','ODbL',410)",
      ),
    ).rejects.toThrow()
    await db.close()
  })

  it('allows many rows with no barcode, since generic foods have none', async () => {
    const db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.run("INSERT INTO foods (id,source,name,license) VALUES (1,'fdc_sr_legacy','Apple, raw','CC0')")
    await db.run("INSERT INTO foods (id,source,name,license) VALUES (2,'fdc_sr_legacy','Pear, raw','CC0')")
    expect(await db.all('SELECT id FROM foods')).toHaveLength(2)
    await db.close()
  })

  it('records the license per row, because the corpus mixes CC0 and ODbL', async () => {
    const db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.run("INSERT INTO foods (id,source,name,license) VALUES (1,'fdc_branded','A','CC0')")
    await db.run("INSERT INTO foods (id,source,name,license) VALUES (2,'off','B','ODbL')")
    const licenses = await db.all<{ license: string }>('SELECT DISTINCT license FROM foods ORDER BY license')
    expect(licenses.map((l) => l.license)).toEqual(['CC0', 'ODbL'])
    await db.close()
  })

  it('supports the FTS5 index the resolver depends on', async () => {
    const db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(NUTRITION_FTS_SCHEMA)
    await db.run("INSERT INTO food_fts (rowid,name,brand,synonyms) VALUES (1,?,?,?)", [
      'Chicken, broilers or fryers, breast, meat only, cooked, grilled', '', '',
    ])
    // Word order needs no handling: FTS5 ANDs bareword tokens regardless of order.
    const hits = await db.all("SELECT rowid FROM food_fts WHERE food_fts MATCH 'chicken breast grilled'")
    expect(hits).toHaveLength(1)
    await db.close()
  })

  it('stems plurals through the porter tokenizer rather than in app code', async () => {
    const db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(NUTRITION_FTS_SCHEMA)
    await db.run("INSERT INTO food_fts (rowid,name,brand,synonyms) VALUES (1,?,?,?)", [
      'Tomato, red, ripe, raw', '', '',
    ])
    const hits = await db.all("SELECT rowid FROM food_fts WHERE food_fts MATCH 'tomatoes'")
    expect(hits).toHaveLength(1)
    await db.close()
  })
})

describe('the snapshot invariant', () => {
  it('leaves a logged entry untouched when the corpus row changes', async () => {
    const db = openMemoryDb()
    await migrate(db, NOW)
    await db.exec(NUTRITION_SCHEMA)

    await db.run("INSERT INTO foods (id,source,name,license,energy_kcal) VALUES (1,'fdc','Almond butter','CC0',614)")
    await db.run(
      'INSERT INTO meals (id,logged_at,local_date,analysis_status,created_at) VALUES (1,?,?,?,?)',
      [NOW, '2026-07-31', 'complete', NOW],
    )
    await db.run(
      `INSERT INTO log_items
        (meal_id, matched_food_id, matched_food_source, display_name, grams,
         gram_pathway, portion_source, snap_energy_kcal, logged_at)
       VALUES (1,1,'foods','Almond butter',32,'model_guess','model_estimate',614,?)`,
      [NOW],
    )

    // A later release corrects a typo in the corpus row.
    await db.run('UPDATE foods SET energy_kcal = 598 WHERE id = 1')

    // Tuesday's breakfast must not move.
    const item = await db.get<{ snap_energy_kcal: number }>(
      'SELECT snap_energy_kcal FROM log_items WHERE meal_id = 1',
    )
    expect(item?.snap_energy_kcal).toBe(614)
    await db.close()
  })
})
