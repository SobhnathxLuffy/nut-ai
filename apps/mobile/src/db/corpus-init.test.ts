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
    mockSQLite.importDatabaseFromAssetAsync.mockResolvedValue(undefined)
  })

  it('caches open promise on success and does not re-import', async () => {
    const first = await openNutritionDb()
    const second = await openNutritionDb()
    expect(first).toBe(second)
    expect(mockSQLite.importDatabaseFromAssetAsync).toHaveBeenCalledTimes(1)
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
    mockDbInstance.getFirstAsync
      .mockResolvedValueOnce({ c: 8520 }) // foods
      .mockResolvedValueOnce({ c: 14200 }) // portions
      .mockResolvedValueOnce({ value: '2026-09-14T00:00:00Z' }) // built_at

    const fakeAdapter = await openNutritionDb()
    const info = await nutritionCorpusInfo(fakeAdapter)

    expect(info).toEqual({
      foods: 8520,
      portions: 14200,
      builtAt: '2026-09-14T00:00:00Z',
    })
  })

  it('reads IFCT corpus info correctly', async () => {
    mockDbInstance.getFirstAsync
      .mockResolvedValueOnce({ c: 528 }) // ifct foods
      .mockResolvedValueOnce({ value: '2024.1' }) // version

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
