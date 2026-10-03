import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { ScanResult } from '@nutai/pipeline'
import { getLoggedMeal } from './logged-meals'
import {
  loggedRowBandFor,
  mealHonestyFromScan,
  parseMealHonesty,
  serializeMealHonesty,
  visibilityLabelFor,
} from './meal-honesty'

/**
 * Task 5-5 (Wave 5B, honesty persistence — O6): the deferred follow-up from
 * the honesty-contract round ("per-row quality columns and meal-level honesty
 * persistence deferred"). These tests lock the full production path:
 * repo.ts logMeal → meals.honesty_json + log_items quality columns →
 * logged-meals.ts getLoggedMeal → the meal-honesty render helpers → the
 * meal-detail.tsx wiring (source sweep; the app/ screens sit behind expo
 * imports node cannot load — the wave3-food.test.ts pattern).
 *
 * The degradation half is as load-bearing as the persistence half: NULL is
 * "no claim" for pre-v12 rows, manual rows, and corrupt snapshots, and every
 * layer must render nothing rather than invent a default.
 */

const testState = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('../db/expo-adapter', () => ({
  openUserDb: async () => testState.database as DbAdapter,
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))
vi.mock('../inference/credentials', () => ({ clearCredential: vi.fn() }))
vi.mock('./food-mutations', () => ({
  emitFoodMutation: vi.fn(),
  getLastDeletedMealUndoUuid: vi.fn(() => null),
  setLastDeletedMealUndoUuid: vi.fn(),
}))

import { logMeal } from './repo'

const NOW = 1_755_000_000_000
const TODAY = new Date(NOW).toISOString().slice(0, 10)

let database: DbAdapter

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
  testState.database = database
})

/** A ScanResult carrying every contract-v1.3 honesty block the pipeline sets. */
function scanResultWithHonesty(): ScanResult {
  const ingredient: IngredientRow = {
    id: 'ingredient-roti',
    displayName: 'Roti',
    sourceFoodId: '42',
    grams: 60,
    nutrientSnapshot: { kcal: 300, protein_g: 9, fat_g: 3, carbs_g: 55 },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.375,
    isEstimate: false,
    assumptions: [],
    visibility: 'likely',
    portionRange: { minG: 45, maxG: 75 },
    qualitativeAmount: 'moderate',
    preparation: { method: 'tawa', intrinsicFat: 'low', addedCookingFat: 'none', confidence: 0.6 },
  }
  const meal: LoggedMeal = {
    id: 'meal-roti',
    loggedAt: new Date(NOW).toISOString(),
    ingredients: [ingredient],
    portionEatenFraction: 1,
    engineId: 'test',
    promptVersion: 'v1.3.0',
    schemaVersion: '1.3.0',
    clampFlags: [],
  }
  return {
    isFood: true,
    refusalReason: null,
    meal,
    items: [
      {
        row: ingredient,
        band: { halfPct: 0.375, tier: 'wide', reasons: ['Standard portion assumed'] },
        resolution: 'auto_accept',
        gramPathway: ingredient.gramPathway,
      },
    ],
    totals: { kcal: 180, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
    mealBand: { halfPct: 0.375, tier: 'wide', reasons: ['Standard portion assumed'] },
    questions: [],
    clampFlags: [],
    zeroHitCount: 0,
    portionContext: {
      wholeMealVisible: true,
      scaleReferenceAvailable: false,
      scaleReferenceDescription: '',
      absolutePortionConfidence: 'low',
    },
    knownSummary: 'Two rotis identified',
    unknownSummary: 'Ghee quantity',
    uncertaintyFactors: [{ factor: 'ghee quantity', impactOnTotalCalories: 'high' }],
    highImpactQuestion: { question: 'How many rotis?', options: ['2', '3'] },
  }
}

describe('meal-honesty snapshot serialization', () => {
  it('derives the snapshot with the v1.3 blocks normalized to their neutrals', () => {
    const snapshot = mealHonestyFromScan({
      mealBand: { halfPct: 0.2, tier: 'moderate', reasons: [] },
    })
    expect(snapshot).toEqual({
      mealBand: { halfPct: 0.2, tier: 'moderate', reasons: [] },
      portionContext: null,
      uncertaintyFactors: [],
      highImpactQuestion: null,
      knownSummary: null,
      unknownSummary: null,
    })
  })

  it('serializes fixed-shape: same key order, no undefined, round-trips exactly', () => {
    const json = serializeMealHonesty(scanResultWithHonesty())
    expect(json).toBe(
      '{"mealBand":{"halfPct":0.375,"tier":"wide","reasons":["Standard portion assumed"]},' +
        '"portionContext":{"wholeMealVisible":true,"scaleReferenceAvailable":false,' +
        '"scaleReferenceDescription":"","absolutePortionConfidence":"low"},' +
        '"uncertaintyFactors":[{"factor":"ghee quantity","impactOnTotalCalories":"high"}],' +
        '"highImpactQuestion":{"question":"How many rotis?","options":["2","3"]},' +
        '"knownSummary":"Two rotis identified","unknownSummary":"Ghee quantity"}',
    )
    expect(parseMealHonesty(json)).toEqual(parseMealHonesty(json))
    const parsed = parseMealHonesty(json)
    expect(parsed!.mealBand).toEqual({ halfPct: 0.375, tier: 'wide', reasons: ['Standard portion assumed'] })
    expect(parsed!.portionContext!.absolutePortionConfidence).toBe('low')
    expect(parsed!.uncertaintyFactors).toEqual([{ factor: 'ghee quantity', impactOnTotalCalories: 'high' }])
    expect(parsed!.highImpactQuestion).toEqual({ question: 'How many rotis?', options: ['2', '3'] })
    expect(parsed!.knownSummary).toBe('Two rotis identified')
    expect(parsed!.unknownSummary).toBe('Ghee quantity')
  })

  it('parses to null for the honest no-claim cases, never throws', () => {
    expect(parseMealHonesty(null)).toBeNull()
    expect(parseMealHonesty(undefined)).toBeNull()
    expect(parseMealHonesty('')).toBeNull()
    expect(parseMealHonesty('not json')).toBeNull()
    expect(parseMealHonesty('[]')).toBeNull()
    expect(parseMealHonesty('"a string"')).toBeNull()
    // No mealBand → no snapshot. A half-invented snapshot is worse than none.
    expect(parseMealHonesty('{"knownSummary":"x"}')).toBeNull()
    expect(parseMealHonesty('{"mealBand":{"tier":"moderate"}}')).toBeNull()
    expect(parseMealHonesty('{"mealBand":{"halfPct":0.2,"tier":"sideways","reasons":[]}}')).toBeNull()
  })

  it('degrades member-by-member when a block is malformed', () => {
    const parsed = parseMealHonesty(
      '{"mealBand":{"halfPct":0.2,"tier":"moderate","reasons":["ok",5]},' +
        '"portionContext":{"scaleReferenceDescription":"plate"},' +
        '"uncertaintyFactors":[{"factor":"ghee"},{"impactOnTotalCalories":"high"}],"highImpactQuestion":42,' +
        '"knownSummary":17}',
    )
    expect(parsed!.mealBand).toEqual({ halfPct: 0.2, tier: 'moderate', reasons: ['ok'] })
    // Dropped non-enum confidence → 'unknown' is the contract's own neutral.
    expect(parsed!.portionContext).toEqual({
      wholeMealVisible: false,
      scaleReferenceAvailable: false,
      scaleReferenceDescription: 'plate',
      absolutePortionConfidence: 'unknown',
    })
    expect(parsed!.uncertaintyFactors).toEqual([{ factor: 'ghee', impactOnTotalCalories: 'low' }])
    expect(parsed!.highImpactQuestion).toBeNull()
    expect(parsed!.knownSummary).toBeNull()
  })
})

describe('the log path persists what the scan said (logMeal → getLoggedMeal)', () => {
  it('writes the per-row quality columns and the meal-level honesty snapshot', async () => {
    const mealId = await logMeal(scanResultWithHonesty(), null, null, NOW)

    const item = await database.get<{
      display_name: string
      visibility: string | null
      qualitative_amount: string | null
      portion_min_g: number | null
      portion_max_g: number | null
      preparation_json: string | null
    }>('SELECT display_name, visibility, qualitative_amount, portion_min_g, portion_max_g, preparation_json FROM log_items WHERE meal_id = ?', [mealId])
    expect(item).toEqual({
      display_name: 'Roti',
      visibility: 'likely',
      qualitative_amount: 'moderate',
      portion_min_g: 45,
      portion_max_g: 75,
      preparation_json: '{"method":"tawa","intrinsicFat":"low","addedCookingFat":"none","confidence":0.6}',
    })

    const mealRow = await database.get<{ honesty_json: string | null }>(
      'SELECT honesty_json FROM meals WHERE id = ?', [mealId],
    )
    expect(mealRow!.honesty_json).toBe(serializeMealHonesty(scanResultWithHonesty()))

    // The undo ledger aggregate carries the new columns too — undo/redo of the
    // meal insert keeps the honesty (recordOperation validates against the
    // operations.ts whitelist, which v12 extends).
    const read = await getLoggedMeal(database, mealId)
    expect(read!.honesty!.mealBand.tier).toBe('wide')
    expect(read!.items[0]).toEqual({
      id: read!.items[0]!.id,
      name: 'Roti',
      grams: 60,
      kcalPer100g: 300,
      visibility: 'likely',
      bandHalfPct: 0.375,
    })
  })

  it('logs NULL quality columns for a result without v1.3 blocks — no claim is not a claim of visible', async () => {
    const ingredient: IngredientRow = {
      id: 'ingredient-barcode',
      displayName: 'Milk carton',
      sourceFoodId: '9',
      grams: 250,
      nutrientSnapshot: { kcal: 42, protein_g: 3, fat_g: 1, carbs_g: 5 },
      origin: 'barcode',
      gramPathway: 'packaged_exact',
      bandHalfPct: 0.02,
      isEstimate: false,
      assumptions: [],
    }
    const meal: LoggedMeal = {
      id: 'meal-barcode',
      loggedAt: new Date(NOW).toISOString(),
      ingredients: [ingredient],
      portionEatenFraction: 1,
      engineId: 'test',
      promptVersion: null,
      schemaVersion: null,
      clampFlags: [],
    }
    const result: ScanResult = {
      isFood: true,
      refusalReason: null,
      meal,
      items: [{ row: ingredient, band: { halfPct: 0.02, tier: 'none', reasons: [] }, resolution: 'barcode', gramPathway: 'packaged_exact' }],
      totals: { kcal: 105, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
      mealBand: { halfPct: 0.02, tier: 'none', reasons: [] },
      questions: [],
      clampFlags: [],
      zeroHitCount: 0,
    }

    const mealId = await logMeal(result, null, null, NOW + 5000)
    const item = await database.get<{
      visibility: string | null
      qualitative_amount: string | null
      portion_min_g: number | null
      portion_max_g: number | null
      preparation_json: string | null
    }>('SELECT visibility, qualitative_amount, portion_min_g, portion_max_g, preparation_json FROM log_items WHERE meal_id = ?', [mealId])
    expect(item).toEqual({
      visibility: null,
      qualitative_amount: null,
      portion_min_g: null,
      portion_max_g: null,
      preparation_json: null,
    })
    // The meal-level band IS always computed, so the snapshot always exists…
    const read = await getLoggedMeal(database, mealId)
    expect(read!.honesty!.mealBand).toEqual({ halfPct: 0.02, tier: 'none', reasons: [] })
    // …and every v1.3 block reads back as its neutral.
    expect(read!.honesty!.portionContext).toBeNull()
    expect(read!.honesty!.uncertaintyFactors).toEqual([])
    expect(read!.honesty!.highImpactQuestion).toBeNull()
    expect(read!.honesty!.knownSummary).toBeNull()
    expect(read!.honesty!.unknownSummary).toBeNull()
  })

  it('a pre-v12 meal (no honesty_json, no quality columns) reads back as pure no-claim', async () => {
    // Shaped exactly like the pre-v12 writers: no honesty columns touched.
    await database.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction,
                          analysis_status, created_at, uuid)
       VALUES (900, ?, ?, 'lunch', 1.0, 'complete', ?, '01992820-0000-7000-8000-000000000900')`,
      [NOW, TODAY, NOW],
    )
    await database.run(
      `INSERT INTO log_items (id, meal_id, matched_food_source, display_name, grams, gram_pathway,
                              portion_source, snap_energy_kcal, is_estimate, sort_order, logged_at, uuid)
       VALUES (901, 900, 'corpus', 'Legacy dal', 180, 'fndds_standard_portion', 'vision_model', 120, 0, 0, ?,
               '01992820-0000-7000-8000-000000000901')`,
      [NOW],
    )
    const read = await getLoggedMeal(database, 900)
    expect(read!.honesty).toBeNull()
    expect(read!.items[0]).toEqual({
      id: 901,
      name: 'Legacy dal',
      grams: 180,
      kcalPer100g: 120,
      visibility: null,
      bandHalfPct: null,
    })
  })

  it('a corrupt honesty_json degrades to null instead of failing the meal read', async () => {
    await database.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction,
                          analysis_status, created_at, uuid, honesty_json)
       VALUES (901, ?, ?, 'lunch', 1.0, 'complete', ?, '01992820-0000-7000-8000-000000000901', '{oops')`,
      [NOW, TODAY, NOW],
    )
    const read = await getLoggedMeal(database, 901)
    expect(read).not.toBeNull()
    expect(read!.honesty).toBeNull()
    await database.run('DELETE FROM meals WHERE id = 901')
  })
})

describe('meal-detail render derivations (the decisions; the JSX only renders)', () => {
  it('maps the visibility closed set to its basis captions, NULL/unknown to nothing', () => {
    expect(visibilityLabelFor('visible')).toBe('Seen in photo')
    expect(visibilityLabelFor('likely')).toBe('Likely present')
    expect(visibilityLabelFor('inferred')).toBe('Not directly visible')
    expect(visibilityLabelFor(null)).toBeNull()
    expect(visibilityLabelFor(undefined)).toBeNull()
    // A string outside the closed set (corrupt row) renders nothing — the DB
    // CHECK already refuses it at write time; this is the read-side guard.
    expect(visibilityLabelFor('hallucinated')).toBeNull()
  })

  it('derives the row band from the persisted half-width via the confidence package', () => {
    const band = loggedRowBandFor(0.375, 180)
    expect(band).toEqual({ tier: 'wide', low: 180 * (1 - 0.375), high: 180 * (1 + 0.375) })
    // Tight bands are false modesty — ConfidenceChip's own ruling.
    expect(loggedRowBandFor(0.02, 180)).toBeNull()
    // No persisted band (manual/legacy row) → no badge.
    expect(loggedRowBandFor(null, 180)).toBeNull()
    expect(loggedRowBandFor(undefined, 180)).toBeNull()
    expect(loggedRowBandFor(Number.NaN, 180)).toBeNull()
    expect(loggedRowBandFor(-1, 180)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// meal-detail.tsx wiring — source sweep (wave3-food.test.ts pattern: the app/
// screens sit behind expo imports vitest's node environment cannot load).
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const mealDetail = readFileSync(join(here, '..', '..', 'app', 'meal-detail.tsx'), 'utf8')

describe('meal-detail.tsx renders the persisted honesty (Task 5-5)', () => {
  it('derives the captions through the meal-honesty helpers, not inline', () => {
    expect(mealDetail).toContain("from '../src/data/meal-honesty'")
    expect(mealDetail).toContain('visibilityLabelFor(item.visibility)')
    expect(mealDetail).toContain('loggedRowBandFor(item.bandHalfPct')
  })

  it('renders the basis caption with the violet reserved for inferred rows', () => {
    expect(mealDetail).toContain('{visibilityCaption ? (')
    expect(mealDetail).toContain("item.visibility === 'inferred' ? theme.uncertainText : theme.textMuted")
  })

  it('renders the band on the ONE Badge (variant uncertain, size sm) with the tier glyph', () => {
    expect(mealDetail).toContain('variant="uncertain"')
    expect(mealDetail).toContain('size="sm"')
    expect(mealDetail).toContain('TIER_GLYPH[rowBand.tier]')
    // The badge speaks its range — an a11y label, not just violet text.
    expect(mealDetail).toMatch(/accessibilityLabel=\{`Estimated \$\{Math\.round\(rowKcal\)\} kcal, likely between/)
  })

  it('keeps the honesty fields through the edit round trip (apply + undo restore)', () => {
    expect((mealDetail.match(/visibility: item\.visibility \?\? null/g) ?? []).length).toBe(2)
    expect((mealDetail.match(/bandHalfPct: item\.bandHalfPct \?\? null/g) ?? []).length).toBe(2)
  })
})
