import { afterEach, describe, it, expect, vi } from 'vitest'
import { OpenFoodFactsSource } from './off-source'

describe('OpenFoodFactsSource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('has correct license info', () => {
    const source = new OpenFoodFactsSource()
    const license = source.getLicenseInfo()
    expect(license.license).toBe('odbl-1.0')
    expect(license.odblShareAlike).toBe(true)
  })

  it('resolves a barcode correctly', async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 1,
        product: {
          product_name: 'Test Product',
          brands: 'Test Brand',
          nutriments: {
            'energy-kcal_100g': 100,
            proteins_100g: 5,
            fat_100g: 2,
            carbohydrates_100g: 10,
            sodium_100g: 0.1
          },
          serving_quantity: '50',
          serving_size: '50g'
        }
      })
    })

    const source = new OpenFoodFactsSource()
    const res = await source.resolveByBarcode('123456789')
    expect(res).not.toBeNull()
    expect(res?.name).toBe('Test Product')
    expect(res?.brand).toBe('Test Brand')
    expect(res?.energyKcal).toBe(100)
    expect(res?.sodiumMg).toBe(100)
    expect(res?.servingSizeG).toBe(50)
  })

  it('handles not found barcodes gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 0
      })
    })

    const source = new OpenFoodFactsSource()
    const res = await source.resolveByBarcode('000')
    expect(res).toBeNull()
  })

  it('preserves a reported zero sodium value and rejects malformed barcode input', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 1, product: { product_name: 'Salt free', nutriments: { sodium_100g: 0 } } }),
    })
    const source = new OpenFoodFactsSource()
    expect((await source.resolveByBarcode('12345678'))?.sodiumMg).toBe(0)
    expect(await source.resolveByBarcode('not-a-barcode')).toBeNull()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('aborts a request that exceeds the bounded timeout', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch
    const source = new OpenFoodFactsSource()
    const pending = source.resolveByBarcode('12345678')
    await vi.advanceTimersByTimeAsync(8_001)
    await expect(pending).resolves.toBeNull()
  })
})
