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

/** "60 g", "60g", "60 grams", "60ml" -> 60. Anything else -> null. */
export function parseGramsFromServingSize(value: string): number | null {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:g|gram|grams|ml)\b/i)
  if (!m) return null
  const parsed = Number(m[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
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

      const proteinG = finiteNumber(nut['proteins_100g'])
      const carbG = finiteNumber(nut['carbohydrates_100g'])
      const fatG = finiteNumber(nut['fat_100g'])

      // A LOT of OFF products carry a complete macro profile but no
      // energy-kcal field — those rows used to fall through as "not found"
      // (the orchestrator requires energyKcal). When ALL three macros are
      // present, Atwater 4/4/9 gives an honest per-100 g figure; with a
      // partial profile the computation would only LOOK exact, so we stay
      // silent instead.
      let energyKcal = finiteNumber(nut['energy-kcal_100g'])
      if (energyKcal == null && proteinG != null && carbG != null && fatG != null) {
        energyKcal = Math.round((4 * carbG + 4 * proteinG + 9 * fatG) * 10) / 10
      }

      // serving_quantity is usually numeric but arrives as a string on some
      // rows; when it is absent, "serving_size: '60 g'" carries the weight.
      const servingQuantity =
        finiteNumber(product['serving_quantity']) ??
        (typeof product['serving_size'] === 'string'
          ? parseGramsFromServingSize(product['serving_size'])
          : null)

      return {
        foodId: `off:${barcode}`,
        sourceId: barcode,
        sourceVersion: null,
        attribution: 'Open Food Facts contributors, https://openfoodfacts.org',
        name: typeof product['product_name'] === 'string' ? product['product_name']
          : typeof product['product_name_en'] === 'string' ? product['product_name_en'] : 'Unknown Product',
        brand: typeof product['brands'] === 'string' ? product['brands'] : null,
        energyKcal,
        proteinG,
        fatG,
        carbG,
        fiberG: finiteNumber(nut['fiber_100g']),
        sugarG: finiteNumber(nut['sugars_100g']),
        sodiumMg: sodiumG == null ? null : sodiumG * 1000,
        servingSizeG: servingQuantity,
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
