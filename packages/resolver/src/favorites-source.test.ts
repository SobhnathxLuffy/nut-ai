import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { FavoritesSource } from './favorites-source.js'
import { loadFood, resolveByText } from './index.js'

/**
 * Task 11-b — the FavoritesSource tests.
 *
 * A favorite is a logging_shortcuts row (kind='favorite') whose snapshot_json
 * holds the whole logged meal (items with per-100g snap_* macros and grams).
 * These tests pin the three contracts that make it safe as a search source:
 * matching (shortcut name + item names, case-insensitive), the resolveById
 * math (per-100g totals, never silently-zeroed missing nutrients), and the
 * fail-closed edge cases (corrupt/empty snapshots skip, never throw).
 */

const NOW = 1_754_200_000_000

// Two-item favorite: rice 200 g @ 300 kcal/100 g (+10 P / 5 F / 40 C / 2 fiber
// / 1 sugar / 100 mg sodium), sabzi 150 g @ 50 kcal/100 g (+2.5 P / 2 F / 6 C).
// Meal totals: 675 kcal over 350 g; fiber/sugar/sodium come from rice only.
const RICE_SABZI_SNAPSHOT = JSON.stringify({
  meal: { id: 7, logged_at: NOW, local_date: '2026-09-13', meal_slot: 'lunch' },
  items: [
    { display_name: 'Steamed rice', grams: 200, snap_energy_kcal: 300, snap_protein_g: 10, snap_fat_g: 5, snap_carb_g: 40, snap_fiber_g: 2, snap_sugar_g: 1, snap_sodium_mg: 100 },
    { display_name: 'Cauliflower sabzi', grams: 150, snap_energy_kcal: 50, snap_protein_g: 2.5, snap_fat_g: 2, snap_carb_g: 6 },
  ],
  ledger: [],
})

// The task's own worked example: one item, 200 g @ 300 kcal/100 g.
const RICE_ONLY_SNAPSHOT = JSON.stringify({
  meal: { id: 8, logged_at: NOW, local_date: '2026-09-14', meal_slot: 'dinner' },
  items: [{ display_name: 'Steamed rice', grams: 200, snap_energy_kcal: 300 }],
  ledger: [],
})

async function insertFavorite(
  db: DbAdapter,
  options: { id: number; name: string; snapshot: string; kind?: string; deletedAt?: number | null },
): Promise<void> {
  await db.run(
    `INSERT INTO logging_shortcuts (id, uuid, created_at, updated_at, revision, deleted_at, sync_state, meal_id, kind, name, snapshot_json)
     VALUES (?, ?, ?, ?, 1, ?, 'local', ?, ?, ?, ?)`,
    [
      options.id,
      `018f7fc7-7c00-7000-8000-${String(options.id).padStart(12, '0')}`,
      NOW,
      NOW,
      options.deletedAt ?? null,
      // Distinct dummy meal_id per row — shortcut_unique(meal_id, kind).
      options.id * 10,
      options.kind ?? 'favorite',
      options.name,
      options.snapshot,
    ],
  )
}

/** A DbAdapter stub standing in for the user DB, returning fixed shortcut rows — lets a test feed a snapshot the schema CHECK would reject. */
function fakeUserDbWith(rows: Array<Record<string, unknown>>): DbAdapter {
  return {
    all: async () => rows,
    get: async () => rows[0] ?? null,
  } as unknown as DbAdapter
}

describe('FavoritesSource', () => {
  let db: DbAdapter
  let source: FavoritesSource

  beforeEach(async () => {
    db = openMemoryDb()
    await migrate(db, NOW)
    source = new FavoritesSource(db)
    await insertFavorite(db, { id: 1, name: 'Rice plate', snapshot: RICE_SABZI_SNAPSHOT })
    await insertFavorite(db, { id: 2, name: 'Rice, plain', snapshot: RICE_ONLY_SNAPSHOT })
  })

  it('matches a query against the shortcut name, case-insensitively', async () => {
    const rows = await source.search('"rice plate"')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ foodId: 'favorite:1', source: 'favorite', name: 'Rice plate' })
    expect(source.priority).toBe(95)
    expect(source.id).toBe('favorite')
  })

  it('matches a query against an ITEM display name, not just the meal name', async () => {
    // 'Cauliflower sabzi' is inside favorite 1's items; no shortcut is named it.
    const rows = await source.search('"cauliflower"')
    expect(rows.map((row) => row.foodId)).toEqual(['favorite:1'])

    // AND across terms, OR across haystacks: 'steamed' + 'sabzi' span two items.
    const both = await source.search('"steamed" "sabzi"')
    expect(both.map((row) => row.foodId)).toEqual(['favorite:1'])
  })

  it('returns nothing when nothing matches, and skips soft-deleted rows', async () => {
    expect(await source.search('"paneer"')).toEqual([])
    await insertFavorite(db, { id: 9, name: 'Old favorite', snapshot: RICE_ONLY_SNAPSHOT, deletedAt: NOW + 1 })
    expect((await source.search('"old favorite"')).map((row) => row.foodId)).not.toContain('favorite:9')
  })

  it('resolves the whole favorite meal as ONE per-100g food (roundtrip math)', async () => {
    const food = await source.resolveById('favorite:1')
    expect(food).not.toBeNull()
    expect(food?.source).toBe('favorite')
    expect(food?.sourceId).toBe('1')
    expect(food?.name).toBe('Rice plate')
    // grams = sum of item grams; macros = meal totals × 100 / total grams.
    expect(food?.servingSizeG).toBe(350)
    // (200 g @ 300 + 150 g @ 50) = 675 kcal → 675 × 100 / 350 per 100 g…
    expect(food?.energyKcal).toBeCloseTo(192.857, 3)
    // …which logs back as 675 kcal at the meal's own 350 g.
    expect((food!.energyKcal! * food!.servingSizeG!) / 100).toBeCloseTo(675, 6)
    // protein: 20 g + 3.75 g = 23.75 → per-100g
    expect(food?.proteinG).toBeCloseTo(23.75 * (100 / 350), 6)
    expect(food?.fatG).toBeCloseTo((5 * 2 + 2 * 1.5) * (100 / 350), 6)
    expect(food?.carbG).toBeCloseTo((40 * 2 + 6 * 1.5) * (100 / 350), 6)
    // fiber/sugar/sodium exist (rice only) and still normalize correctly.
    expect(food?.fiberG).toBeCloseTo(4 * (100 / 350), 6)
    expect(food?.sugarG).toBeCloseTo(2 * (100 / 350), 6)
    expect(food?.sodiumMg).toBeCloseTo(200 * (100 / 350), 6)
    expect(food?.license).toBe('User Content')
  })

  it('preserves the per-100g basis for the single-item case (200 g @ 300 → 600 kcal)', async () => {
    const food = await source.resolveById('favorite:2')
    expect(food?.servingSizeG).toBe(200)
    expect(food?.energyKcal).toBe(300) // per-100g preserved
    expect(((food?.energyKcal ?? 0) * (food?.servingSizeG ?? 0)) / 100).toBe(600) // logged total
  })

  it('leaves nutrients no item reported as null (never a silent zero)', async () => {
    const food = await source.resolveById('favorite:2')
    expect(food?.energyKcal).toBe(300)
    expect(food?.proteinG).toBeNull()
    expect(food?.fatG).toBeNull()
    expect(food?.carbG).toBeNull()
    expect(food?.fiberG).toBeNull()
    expect(food?.sugarG).toBeNull()
    expect(food?.sodiumMg).toBeNull()
  })

  it('skips a structurally corrupt snapshot in search and resolves to null — never throws', async () => {
    // The live schema CHECK(json_valid(snapshot_json)) blocks invalid JSON at
    // the write boundary, but a synced/imported row can still carry the wrong
    // SHAPE — items not an array. The source must fail closed.
    await insertFavorite(db, { id: 3, name: 'Corrupt favorite', snapshot: '{"items": 42}' })
    await insertFavorite(db, { id: 31, name: 'Corrupt favorite too', snapshot: '{"meal": {}}' })
    // The corrupt rows are invisible to search; the healthy rows still surface.
    const rows = await source.search('"rice"')
    expect(rows.map((row) => row.foodId).sort()).toEqual(['favorite:1', 'favorite:2'])
    await expect(source.resolveById('favorite:3')).resolves.toBeNull()
    await expect(source.resolveById('favorite:31')).resolves.toBeNull()
  })

  it('never throws on a snapshot_json that is not even valid JSON', async () => {
    // The parseSnapshot try/catch defends the depth the schema CHECK cannot
    // reach (a corrupt row that bypassed the write boundary, e.g. via sync).
    const broken = new FavoritesSource(fakeUserDbWith([{ id: 77, name: 'Broken', snapshot_json: '{oops' }]))
    await expect(broken.search('"broken"')).resolves.toEqual([])
    await expect(broken.resolveById('favorite:77')).resolves.toBeNull()
  })

  it('fails closed on empty items, zero grams, and malformed ids', async () => {
    await insertFavorite(db, { id: 4, name: 'Empty favorite', snapshot: JSON.stringify({ meal: {}, items: [], ledger: [] }) })
    await insertFavorite(db, {
      id: 5,
      name: 'Zero-gram favorite',
      snapshot: JSON.stringify({ meal: {}, items: [{ display_name: 'Air', grams: 0, snap_energy_kcal: 100 }], ledger: [] }),
    })

    await expect(source.resolveById('favorite:4')).resolves.toBeNull()
    await expect(source.resolveById('favorite:5')).resolves.toBeNull()
    await expect(source.resolveById('userfood:not-a-favorite')).resolves.toBeNull()
    await expect(source.resolveById('favorite:not-a-row-id')).resolves.toBeNull()
  })

  it('is searchable through the router and resolves through loadFood', async () => {
    const result = await resolveByText(db, {
      canonicalFoodKey: 'rice plate',
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    }, { userDb: db })
    const favorite = result.topCandidates.find((candidate) => candidate.foodId === 'favorite:1')
    expect(favorite).toBeDefined()
    expect(favorite?.sourcePriority).toBe(95)

    const resolved = await loadFood(db, 'favorite:1', { userDb: db })
    expect(resolved?.name).toBe('Rice plate')
    expect(resolved?.energyKcal).toBeCloseTo(192.857, 3)
  })
})

describe('favorites in the sourceRouter (Task 11-b: searchable, never hijacking auto-accept)', () => {
  let nutritionDb: DbAdapter
  let userDb: DbAdapter

  beforeEach(async () => {
    nutritionDb = openMemoryDb()
    await nutritionDb.exec(NUTRITION_SCHEMA)
    await nutritionDb.exec(NUTRITION_FTS_SCHEMA)
    await nutritionDb.run(
      `INSERT INTO foods (id, source, source_id, name, energy_kcal, license, basis_confidence, completeness_score)
       VALUES (1, 'fdc_sr_legacy', '168878', 'Rice, raw', 130, 'test', 'high', 1)`,
    )
    await nutritionDb.run("INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (1, 'Rice, raw', '', '')")

    userDb = openMemoryDb()
    await migrate(userDb, NOW)
    await insertFavorite(userDb, { id: 1, name: 'Rice plate', snapshot: RICE_SABZI_SNAPSHOT })
  })

  it('a favorite surfaces beside the bundled corpora in the merged result list', async () => {
    // 'rice' matches the favorite AND the USDA row at the same ladder rung.
    const result = await resolveByText(nutritionDb, {
      canonicalFoodKey: 'rice',
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    }, { userDb })
    const ids = result.topCandidates.map((candidate) => candidate.foodId)
    expect(ids).toContain('favorite:1')
    // Search shows every corpus — favorites included.
    expect(ids).toContain('usda:168878')
  })

  it('a matching user food (priority 100) still outranks and out-decides the favorite (95)', async () => {
    await userDb.run(
      `INSERT INTO user_foods
       (uuid, name, basis, energy_kcal, created_at, updated_at, revision, sync_state)
       VALUES ('018f7fc7-7c00-7000-8000-000000000099', 'Rice plate', 'per_100g', 999, ?, ?, 1, 'local')`,
      [NOW, NOW],
    )
    const result = await resolveByText(nutritionDb, {
      canonicalFoodKey: 'rice plate',
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    }, { userDb })
    const ids = result.topCandidates.map((candidate) => candidate.foodId)
    // Both appear in the merged list the searcher sees…
    expect(ids).toContain('userfood:018f7fc7-7c00-7000-8000-000000000099')
    expect(ids).toContain('favorite:1')
    expect(ids[0]).toBe('favorite:1') // the favorite's known 350 g serving scores higher (portion plausibility)
    // …but the auto-accept decision runs on the 100 tier only — the favorite
    // (95) never sneaks into the decision set when a user food matches.
    expect(result.outcome.kind).toBe('disambiguate')
    const decided = result.outcome.kind === 'disambiguate' ? result.outcome.candidates.map((candidate) => candidate.foodId) : []
    expect(decided).toEqual(['userfood:018f7fc7-7c00-7000-8000-000000000099'])
  })

  it('a favorite CAN win the decision when it is the highest-priority match', async () => {
    // Only the favorite matches 'plate' — the USDA corpus holds no such row.
    const result = await resolveByText(nutritionDb, {
      canonicalFoodKey: 'plate',
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    }, { userDb })
    expect(result.topCandidates.map((candidate) => candidate.foodId)).toContain('favorite:1')
    const top = result.topCandidates[0]
    expect(top?.foodId).toBe('favorite:1')
    // The favorite forms its own top tier and may auto-accept on its own merit.
    if (result.outcome.kind === 'auto_accept') {
      expect(result.outcome.match.foodId).toBe('favorite:1')
    }
  })
})
