import { parseSourceFoodId, type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'

const REQUEST_TIMEOUT_MS = 8_000

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export class OpenFoodFactsSource implements NutritionSource {
  readonly id = 'off'
  readonly priority = 60

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Open Food Facts',
      version: null,
      attribution: 'Data from Open Food Facts, licensed under ODbL 1.0',
      license: 'odbl-1.0',
      redistributionPermitted: true,
      odblShareAlike: true
    }
  }

  async search(_query: string): Promise<SourceCandidate[]> {
    // OFF search API could be implemented here, but typically we use OFF for barcode scans
    // and rely on USDA/IFCT for text search.
    return []
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    const barcode = parseSourceFoodId(foodId, this.id)
    if (barcode == null) return null
    return this.resolveByBarcode(barcode)
  }

  async resolveByBarcode(barcode: string): Promise<SourceResolvedFood | null> {
    if (!/^\d{8,14}$/.test(barcode)) return null
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    const timeout = controller == null ? null : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, {
        headers: {
          'User-Agent': 'NutAI/1.0 (https://github.com/nutai/nut-ai)'
        },
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (!res.ok) return null

      const data = (await res.json()) as { status?: number; product?: Record<string, unknown> }
      if (data?.status !== 1 || !data?.product) return null

      const product = data.product
      const nut = (product['nutriments'] && typeof product['nutriments'] === 'object'
        ? product['nutriments'] : {}) as Record<string, unknown>
      const sodiumG = finiteNumber(nut['sodium_100g'])

      return {
        foodId: `off:${barcode}`,
        sourceId: barcode,
        sourceVersion: null,
        attribution: 'Open Food Facts contributors, https://openfoodfacts.org',
        name: typeof product['product_name'] === 'string' ? product['product_name']
          : typeof product['product_name_en'] === 'string' ? product['product_name_en'] : 'Unknown Product',
        brand: typeof product['brands'] === 'string' ? product['brands'] : null,
        energyKcal: finiteNumber(nut['energy-kcal_100g']),
        proteinG: finiteNumber(nut['proteins_100g']),
        fatG: finiteNumber(nut['fat_100g']),
        carbG: finiteNumber(nut['carbohydrates_100g']),
        fiberG: finiteNumber(nut['fiber_100g']),
        sugarG: finiteNumber(nut['sugars_100g']),
        sodiumMg: sodiumG == null ? null : sodiumG * 1000,
        servingSizeG: finiteNumber(product['serving_quantity']),
        servingDesc: typeof product['serving_size'] === 'string' ? product['serving_size'] : null,
        license: 'odbl-1.0',
        source: 'off'
      }
    } catch {
      return null
    } finally {
      if (timeout != null) clearTimeout(timeout)
    }
  }
}
