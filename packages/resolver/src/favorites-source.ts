import type { DbAdapter } from '@nutai/db-adapter'
import { searchTerms, type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from '@nutai/nutrition-sources'

/**
 * Saved favorite meals ("Log it again" shortcuts) as a search source.
 *
 * Task 11-b — before this source existed, a favorite was only reachable by
 * re-tapping the shortcut on the Home timeline; typing its name in the food
 * search never surfaced it. A favorite row in user.db's logging_shortcuts
 * (kind='favorite') carries snapshot_json — the whole logged meal (items with
 * per-100g snap_* macros and grams) captured at save time — so replaying it is
 * deterministic arithmetic over the user's own confirmed numbers, not a guess.
 *
 * The source resolves a favorite as ONE food: name = the shortcut name, grams =
 * the sum of the item grams, macros = the meal totals × 100 / total grams (the
 * resolver's single per-100g computational basis). Logging the resolved food
 * therefore produces one log item whose math equals the original meal.
 *
 * Honesty rules (AGENTS §19): corrupt/missing snapshots SKIP the row (search)
 * or return null (resolveById) — never throw, never fabricate; a nutrient no
 * item reported stays null, never silently zero.
 */

/** The shape favorites-source reads out of snapshot_json.items[] (per-100g snaps, as logged). */
interface FavoriteItemSnapshot {
  display_name?: unknown
  grams?: unknown
  snap_energy_kcal?: unknown
  snap_protein_g?: unknown
  snap_fat_g?: unknown
  snap_carb_g?: unknown
  snap_fiber_g?: unknown
  snap_sugar_g?: unknown
  snap_sodium_mg?: unknown
}

const FAVORITE_PREFIX = 'favorite:'

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Item grams, or null when the snapshot's grams field is missing/invalid. */
function itemGrams(item: FavoriteItemSnapshot): number | null {
  const grams = asFiniteNumber(item.grams)
  return grams !== null && grams > 0 ? grams : null
}

export class FavoritesSource implements NutritionSource {
  public readonly id = 'favorite'
  // Below user_foods (100) — a matching single food keeps the top tier — and
  // above recipes (90): a favorite is the user's own logged meal, more
  // specific than any household recipe or corpus row.
  public readonly priority = 95

  constructor(private readonly userDb: DbAdapter) {}

  /** The kind='favorite' shortcut rows. A user DB without the table (or a
   *  transient handle error) is an EMPTY source, never a crash — the router
   *  fans out to every source in parallel and one rejected promise would take
   *  the merged search down with it. */
  private async favoriteRows(): Promise<Array<{ id: number; name: string; snapshot_json: string }>> {
    try {
      return await this.userDb.all<{ id: number; name: string; snapshot_json: string }>(
        "SELECT id, name, snapshot_json FROM logging_shortcuts WHERE kind = 'favorite' AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC",
      )
    } catch {
      return []
    }
  }

  async search(query: string): Promise<SourceCandidate[]> {
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    const rows = await this.favoriteRows()
    const candidates: SourceCandidate[] = []
    for (const row of rows) {
      const parsed = parseSnapshot(row.snapshot_json)
      if (!parsed) continue // corrupt/missing snapshot — skip the row, never throw
      // Case-insensitive match over the shortcut name AND the item display
      // names ("logged meals are searchable by what's inside them"). Every
      // query term must hit SOME haystack — AND across terms, OR across
      // haystacks, the same semantics the SQL sources' ANDed LIKEs give.
      // Favorites are few — a JS filter matches the existing small-source style.
      const haystacks = [row.name.toLowerCase()]
      for (const item of parsed.items) {
        const name = asNonEmptyString(item.display_name)
        if (name) haystacks.push(name.toLowerCase())
      }
      const matches = terms.every((term) => haystacks.some((haystack) => haystack.includes(term.toLowerCase())))
      if (!matches) continue

      const totals = mealTotals(parsed.items)
      const per100 = totals.totalGrams > 0 ? 100 / totals.totalGrams : 0
      const energyKcal = totals.energy !== null ? totals.energy * per100 : null
      candidates.push({
        foodId: `${FAVORITE_PREFIX}${row.id}`,
        source: this.id,
        name: row.name,
        brand: null,
        category: 'Favorite meal',
        prepFacet: null,
        // The snapshot is the user's own logged numbers; rows without energy
        // are honestly 'low' (the scorer's basis-ambiguity penalty applies).
        basisConfidence: energyKcal !== null ? 'high' : 'low',
        servingSizeG: totals.totalGrams > 0 ? totals.totalGrams : null,
        energyKcal,
        popularityRank: 100,
        completenessScore: 100,
        rawBm25: -10,
      })
    }
    return candidates
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    if (!foodId.startsWith(FAVORITE_PREFIX)) return null
    const sourceId = foodId.slice(FAVORITE_PREFIX.length)
    if (!/^\d+$/.test(sourceId)) return null
    let row: { id: number; name: string; snapshot_json: string } | null = null
    try {
      row = await this.userDb.get<{ id: number; name: string; snapshot_json: string }>(
        'SELECT id, name, snapshot_json FROM logging_shortcuts WHERE id = ? AND kind = ? AND deleted_at IS NULL',
        [Number(sourceId), 'favorite'],
      )
    } catch {
      return null
    }
    if (!row) return null
    const parsed = parseSnapshot(row.snapshot_json)
    if (!parsed || parsed.items.length === 0) return null

    const totals = mealTotals(parsed.items)
    // Edge cases fail closed: an empty meal or zero grams resolves to NOTHING
    // rather than a fabricated per-100g row.
    if (totals.totalGrams <= 0) return null
    const per100 = 100 / totals.totalGrams

    return {
      foodId,
      sourceId,
      sourceVersion: null,
      attribution: 'Your saved favorite meal',
      name: row.name,
      brand: null,
      energyKcal: totals.energy !== null ? totals.energy * per100 : null,
      proteinG: totals.protein !== null ? totals.protein * per100 : null,
      fatG: totals.fat !== null ? totals.fat * per100 : null,
      carbG: totals.carb !== null ? totals.carb * per100 : null,
      fiberG: totals.fiber !== null ? totals.fiber * per100 : null,
      sugarG: totals.sugar !== null ? totals.sugar * per100 : null,
      sodiumMg: totals.sodium !== null ? totals.sodium * per100 : null,
      servingSizeG: totals.totalGrams,
      servingDesc: `${Math.round(totals.totalGrams)} g meal`,
      license: 'User Content',
      source: this.id,
    }
  }

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Saved Favorite Meals',
      version: null,
      attribution: 'User Created',
      license: 'Private',
      redistributionPermitted: false,
    }
  }
}

/**
 * Parse snapshot_json into the item list this source consumes. Anything other
 * than a JSON object with an items ARRAY parses to null — the caller skips the
 * row (search) or returns null (resolveById). Never throws.
 */
function parseSnapshot(snapshotJson: string): { items: FavoriteItemSnapshot[] } | null {
  try {
    const parsed: unknown = JSON.parse(snapshotJson)
    if (typeof parsed !== 'object' || parsed === null) return null
    const items = (parsed as { items?: unknown }).items
    if (!Array.isArray(items)) return null
    return { items: items.filter((item): item is FavoriteItemSnapshot => typeof item === 'object' && item !== null) }
  } catch {
    return null
  }
}

interface MealTotals {
  totalGrams: number
  /** TOTAL meal amounts (not per-100g) for each nutrient — null when NO item reported it. */
  energy: number | null
  protein: number | null
  fat: number | null
  carb: number | null
  fiber: number | null
  sugar: number | null
  sodium: number | null
}

type NutrientKey = 'energy' | 'protein' | 'fat' | 'carb' | 'fiber' | 'sugar' | 'sodium'

const NUTRIENT_FIELDS: Array<[NutrientKey, keyof FavoriteItemSnapshot]> = [
  ['energy', 'snap_energy_kcal'],
  ['protein', 'snap_protein_g'],
  ['fat', 'snap_fat_g'],
  ['carb', 'snap_carb_g'],
  ['fiber', 'snap_fiber_g'],
  ['sugar', 'snap_sugar_g'],
  ['sodium', 'snap_sodium_mg'],
]

/**
 * Sum the item snapshots into meal totals. Each item contributes
 * snap × grams / 100 (snaps are per-100g). A nutrient no item reported stays
 * null — a missing report is never treated as a reported zero (AGENTS §19).
 */
function mealTotals(items: FavoriteItemSnapshot[]): MealTotals {
  let totalGrams = 0
  const seen: Record<NutrientKey, boolean> = { energy: false, protein: false, fat: false, carb: false, fiber: false, sugar: false, sodium: false }
  const totals: Record<NutrientKey, number> = { energy: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sugar: 0, sodium: 0 }
  for (const item of items) {
    const grams = itemGrams(item)
    if (grams === null) continue
    totalGrams += grams
    for (const [key, field] of NUTRIENT_FIELDS) {
      const snap = asFiniteNumber(item[field])
      if (snap === null) continue
      totals[key] += (snap * grams) / 100
      seen[key] = true
    }
  }
  return {
    totalGrams,
    energy: seen.energy ? totals.energy : null,
    protein: seen.protein ? totals.protein : null,
    fat: seen.fat ? totals.fat : null,
    carb: seen.carb ? totals.carb : null,
    fiber: seen.fiber ? totals.fiber : null,
    sugar: seen.sugar ? totals.sugar : null,
    sodium: seen.sodium ? totals.sodium : null,
  }
}
