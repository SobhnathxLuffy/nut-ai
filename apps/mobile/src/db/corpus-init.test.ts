import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbInstance = {
  getAllAsync: vi.fn(),
  getFirstAsync: vi.fn(),
  runAsync: vi.fn(),
  execAsync: vi.fn(),
  withTransactionAsync: vi.fn(),
  closeAsync: vi.fn(),
}

const mockSQLite = vi.hoisted(() => ({
  importDatabaseFromAssetAsync: vi.fn(),
  openDatabaseAsync: vi.fn(),
}))

// Prevent Node from attempting to parse binary sqlite files as JavaScript
;(require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions['.db'] = (module: { exports: unknown }) => {
  module.exports = 1
}

vi.mock('expo-sqlite', () => mockSQLite)
// The adapter compares the on-disk corpus revision against this GENERATED
// constant; pin the mock so tests control both sides of the comparison.
vi.mock('../data/corpus-revision', () => ({ REQUIRED_CORPUS_REVISION: 'test-revision' }))

import {
  ifctCorpusInfo,
  nutritionCorpusInfo,
  openIfctDb,
  openNutritionDb,
  resetCorpusPromises,
} from './expo-adapter'

describe('corpus initialization & retry logic', () => {
  beforeEach(() => {
  vi.clearAllMocks()
  resetCorpusPromises()
  mockSQLite.openDatabaseAsync.mockResolvedValue(mockDbInstance)
  // Default: a fresh on-disk corpus whose revision matches the bundled one.
  mockDbInstance.getFirstAsync.mockImplementation(async (sql: string) => {
    if (sql.includes('corpus_revision')) return { value: 'test-revision' }
    return { c: 1 }
  })
})


  it('caches open promise on success and does not re-import', async () => {
    const first = await openNutritionDb()
    const second = await openNutritionDb()
    expect(first).toBe(second)
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(1)
    // No forced overwrite when the revision matches.
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledWith(
      'nutrition.db',
      expect.objectContaining({ forceOverwrite: false }),
    )
  })

  // Owner QA 2026-10: an install that ever imported an early/partial corpus
  // kept it forever — the dish browser showed a handful of rows under a "362
  // identities" headline. A stale (or missing) corpus_revision must force a
  // fresh import of the bundled asset.
  it('force-reimports when the on-disk corpus revision does not match the bundle', async () => {
    mockDbInstance.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('corpus_revision')) return { value: 'stale-old-corpus' }
      return { c: 1 }
    })

    const db = await openNutritionDb()
    expect(db).toBeDefined()
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(2)
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenLastCalledWith(
      'nutrition.db',
      expect.objectContaining({ forceOverwrite: true }),
    )
  })

  it('force-reimports when the on-disk copy has no corpus revision at all', async () => {
    mockDbInstance.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('corpus_revision')) throw new Error('no such table: build_manifest')
      return { c: 1 }
    })

    const db = await openNutritionDb()
    expect(db).toBeDefined()
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(2)
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenLastCalledWith(
      'nutrition.db',
      expect.objectContaining({ forceOverwrite: true }),
    )
  })

  it('clears nutrition promise on error so retry is not stuck in error/loading state', async () => {
    mockSQLite.importDatabaseFromAssetAsync.mockRejectedValueOnce(new Error('Asset missing or disk full'))

    await expect(openNutritionDb()).rejects.toThrow('Asset missing or disk full')

    // Second call should NOT return the old rejected promise, but attempt re-import
    mockSQLite.importDatabaseFromAssetAsync.mockResolvedValueOnce(undefined)
    const db = await openNutritionDb()
    expect(db).toBeDefined()
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(2)
  })

  it('clears ifct promise on error so retry is not stuck', async () => {
    mockSQLite.importDatabaseFromAssetAsync.mockRejectedValueOnce(new Error('Corrupted ifct sqlite header'))

    await expect(openIfctDb()).rejects.toThrow('Corrupted ifct sqlite header')

    // Second call should re-attempt import
    mockSQLite.importDatabaseFromAssetAsync.mockResolvedValueOnce(undefined)
    const db = await openIfctDb()
    expect(db).toBeDefined()
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(2)
  })

  it('explicitly clears promises when resetCorpusPromises is called', async () => {
    await openNutritionDb()
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(1)

    resetCorpusPromises()

    await openNutritionDb()
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(2)
  })

  it('reads nutrition corpus info row counts and metadata correctly', async () => {
    mockDbInstance.getFirstAsync.mockImplementation(async (sql) => {
      if (sql.includes('corpus_revision')) return { value: 'test-revision' }
      if (sql.includes("sqlite_master")) return { c: 1 }
      if (sql.includes("FROM foods")) return { c: 8520 }
      if (sql.includes("food_portions")) return { c: 14200 }
      if (sql.includes("dish_definitions")) return { c: 362 }
      if (sql.includes("build_manifest")) return { value: '2026-09-14T00:00:00Z' }
      return null;
    });
    // P1-10: the honesty split rides the build_manifest key list.
    mockDbInstance.getAllAsync.mockImplementation(async (sql) => {
      if (sql.includes('dish_kb_fully_mapped')) {
        return [
          { key: 'dish_kb_fully_mapped', value: '362' },
          { key: 'dish_kb_yield_verified', value: '362' },
          { key: 'dish_kb_built_at', value: '2026-09-30T00:00:00Z' },
        ]
      }
      return []
    });

    const fakeAdapter = await openNutritionDb()

    const info = await nutritionCorpusInfo(fakeAdapter)

    expect(info).toEqual({
      foods: 8520,
      portions: 14200,
      dishes: 362,
      builtAt: '2026-09-14T00:00:00Z',
      dishKb: {
        dishes: 362,
        fullyMapped: 362,
        yieldVerified: 362,
        builtAt: '2026-09-30T00:00:00Z',
      },
    })
  })

  it('P1-10: older bundles without dish_kb_* manifest keys report a null honesty split, never a guess', async () => {
    mockDbInstance.getFirstAsync.mockImplementation(async (sql) => {
      if (sql.includes('corpus_revision')) return { value: 'test-revision' }
      if (sql.includes("sqlite_master")) return { c: 1 }
      if (sql.includes("FROM foods")) return { c: 8520 }
      if (sql.includes("food_portions")) return { c: 14200 }
      if (sql.includes("dish_definitions")) return { c: 362 }
      if (sql.includes("build_manifest")) return { value: '2026-09-14T00:00:00Z' }
      return null;
    });
    mockDbInstance.getAllAsync.mockResolvedValue([])

    const fakeAdapter = await openNutritionDb()
    const info = await nutritionCorpusInfo(fakeAdapter)

    expect(info.dishes).toBe(362)
    expect(info.dishKb).toEqual({
      dishes: 362,
      fullyMapped: null,
      yieldVerified: null,
      builtAt: null,
    })
  })

  it('reads IFCT corpus info correctly', async () => {
    mockDbInstance.getFirstAsync.mockImplementation(async (sql) => {
      if (sql.includes("sqlite_master")) return { c: 1 }
      if (sql.includes("FROM foods")) return { c: 528 }
      if (sql.includes("build_manifest")) return { value: '2024.1' }
      return null;
    });

    const fakeAdapter = await openIfctDb()

    const info = await ifctCorpusInfo(fakeAdapter)

    expect(info).toEqual({
      foods: 528,
      version: '2024.1',
    })
  })

  it('detects unpopulated or empty corpus states with distinct errors', () => {
    function validateCorpusState(nutritionFoods: number, ifctFoods: number): string | null {
      if (nutritionFoods === 0 || ifctFoods === 0) {
        return nutritionFoods === 0 && ifctFoods === 0
          ? 'Offline food databases are unpopulated or missing.'
          : nutritionFoods === 0
          ? 'USDA food database is empty.'
          : 'IFCT food database is empty.'
      }
      return null
    }

    expect(validateCorpusState(0, 0)).toBe('Offline food databases are unpopulated or missing.')
    expect(validateCorpusState(0, 528)).toBe('USDA food database is empty.')
    expect(validateCorpusState(8000, 0)).toBe('IFCT food database is empty.')
    expect(validateCorpusState(8000, 528)).toBeNull()
  })
})
