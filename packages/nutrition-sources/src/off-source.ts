import { parseSourceFoodId, type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'

// P3-D16: named timeouts live in packages/prompt/src/timeouts.ts. This
// package deliberately does not depend on @nutai/prompt, so the off-device
// read keeps its own tiny constant — value mirrors OFFSOURCE_REQUEST_TIMEOUT_MS.
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

/**
 * Honest barcode-lookup outcome: separates "Open Food Facts answered and does
 * not know this barcode" from "we never got an OFF verdict at all".
 *
 * WHY this exists: `resolveByBarcode` collapses every failure to null, which
 * made an airplane-mode scan indistinguishable from a genuine miss at the
 * callers — the scan UI then told an offline user "this barcode is not in the
 * bundled database", a claim the app could not actually know. The fetch API
 * DOES distinguish the two (a rejection/abort is a transport failure; an
 * HTTP 200 with OFF's status:0 is a definitive miss), so the distinction is
 * made here, at the layer that owns the fetch:
 *
 *   - 'miss'        — the barcode is not even a plausible GTIN, or OFF answered
 *                     HTTP 200 with status !== 1 / no product (its definitive
 *                     "unknown product" answer);
 *   - 'unreachable' — the request never produced an OFF verdict: connection /
 *                     DNS failure ('network'), the 8s abort ('timeout'), a
 *                     non-OK HTTP status ('http-status', with the status
 *                     carried alongside), or an unparseable body
 *                     ('bad-payload').
 *
 * `resolveByBarcode` and `resolveById` KEEP the legacy null-on-failure
 * contract on purpose: their callers (the RouterSource fan-out and loadFood's
 * re-resolution of saved off: rows) are graceful by design and gain nothing
 * from a thrown error. Consumers that CAN act on the distinction (the barcode
 * scan flow's offline-vs-not-found messaging) read the outcome instead.
 */
export type OffBarcodeOutcome =
  | { kind: 'found'; food: SourceResolvedFood }
  | { kind: 'miss' }
  | { kind: 'unreachable'; reason: 'network' | 'timeout' | 'http-status' | 'bad-payload'; status?: number }

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
    const outcome = await this.resolveByBarcodeOutcome(barcode)
    return outcome.kind === 'found' ? outcome.food : null
  }

  /**
   * The honest variant: never throws, but reports WHY no row came back
   * (see OffBarcodeOutcome). Behavior of `resolveByBarcode` is unchanged —
   * every 'miss' and 'unreachable' outcome maps to null exactly where the
   * old catch-all returned null.
   */
  async resolveByBarcodeOutcome(barcode: string): Promise<OffBarcodeOutcome> {
    if (!/^\d{8,14}$/.test(barcode)) return { kind: 'miss' }
    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    const timeout = controller == null ? null : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, {
        headers: {
          'User-Agent': 'NutAI/1.0 (https://github.com/nutai/nut-ai)'
        },
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (!res.ok) return { kind: 'unreachable', reason: 'http-status', status: res.status }

      let data: { status?: number; product?: Record<string, unknown> }
      try {
        data = (await res.json()) as { status?: number; product?: Record<string, unknown> }
      } catch {
        // A 200 whose body is not JSON (proxy error page, truncation) is no
        // OFF verdict either.
        return { kind: 'unreachable', reason: 'bad-payload' }
      }
      if (data?.status !== 1 || !data?.product) return { kind: 'miss' }

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
        kind: 'found',
        food: {
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
      }
    } catch (err) {
      // Transport failure — the request produced no OFF verdict. The abort
      // the timeout fired above is the 'timeout' shape; every other
      // rejection (TypeError on Hermes/web) is the offline shape.
      if ((err as Error)?.name === 'AbortError') return { kind: 'unreachable', reason: 'timeout' }
      return { kind: 'unreachable', reason: 'network' }
    } finally {
      if (timeout != null) clearTimeout(timeout)
    }
  }
}
