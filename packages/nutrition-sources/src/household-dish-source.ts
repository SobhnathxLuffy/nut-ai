import type { DbAdapter } from '@nutai/db-adapter'
import { searchTerms, type NutritionSource, type SourceCandidate, type SourceResolvedFood, type SourceLicenseInfo } from './types.js'

interface HouseholdSlot {
  label?: string
  nutritionMapping?: { canonicalFoodId?: string | null }
  amountPrior?: { kind?: string; grams?: number; verified?: boolean }
}

interface HouseholdTemplate {
  ingredientSlots?: HouseholdSlot[]
  addedFat?: { foodId?: string | null; grams?: number }
  cookingMethod?: string
}

const NUTRIENT_FIELDS = 'energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg'

interface FoodNutrientRow {
  energy_kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

/**
 * Saved "My Version" dishes (the dish composer's household variants).
 *
 * QA product round — before this source existed, saving a household variant
 * wrote it into the writable user DB where NO search source looked, so the
 * dish the user had just built and confirmed could never be found again by
 * name. Household rows are the user's own reviewed composition: their grams
 * and food mappings were confirmed at save time, so replaying them is
 * deterministic arithmetic, not a guess. Anything missing or stale fails
 * closed (resolveById returns null) rather than fabricating a number.
 */
export class HouseholdDishSource implements NutritionSource {
  public readonly id = 'household_dish'
  // Below user recipes (90) — a typed recipe with servings beats a composed
  // dish row — but above IFCT (80): the user's own version of a dish should
  // outrank generic corpus rows for the same name.
  public readonly priority = 85

  constructor(
    private readonly userDb: DbAdapter,
    private readonly nutritionDb?: DbAdapter,
    private readonly ifctDb?: DbAdapter,
  ) {}

  private async tableReady(): Promise<boolean> {
    try {
      const row = await this.userDb.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dish_definitions'",
      )
      return row !== null
    } catch {
      return false
    }
  }

  async search(query: string): Promise<SourceCandidate[]> {
    if (!(await this.tableReady())) return []
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    const rows = await this.userDb.all<any>(
      `SELECT id, canonical_name, category FROM dish_definitions
       WHERE record_status = 'HOUSEHOLD' AND ${terms.map(() => 'canonical_name LIKE ?').join(' AND ')}
       ORDER BY lower(canonical_name) LIMIT 20`,
      terms.map((term) => `%${term}%`),
    )
    return rows.map((r: any) => ({
      foodId: `household_dish:${r.id}`,
      source: this.id,
      name: r.canonical_name,
      brand: null,
      category: r.category ?? null,
      prepFacet: null,
      basisConfidence: 'high',
      servingSizeG: null,
      energyKcal: null, // computed at resolve time from stored grams
      popularityRank: 100,
      completenessScore: 100,
      rawBm25: -10,
    }))
  }

  async resolveById(foodId: string): Promise<SourceResolvedFood | null> {
    if (!foodId.startsWith('household_dish:')) return null
    if (!(await this.tableReady())) return null
    const row = await this.userDb.get<any>(
      "SELECT * FROM dish_definitions WHERE id = ? AND record_status = 'HOUSEHOLD'",
      [foodId.slice('household_dish:'.length)],
    )
    if (!row) return null

    let template: HouseholdTemplate
    let portionGrams: number | null = null
    try {
      template = JSON.parse(row.recipe_template_json || '{}') as HouseholdTemplate
      const portionModel = JSON.parse(row.portion_model_json || '{}') as { standardPortionGrams?: number | null }
      portionGrams = typeof portionModel.standardPortionGrams === 'number' ? portionModel.standardPortionGrams : null
    } catch {
      return null
    }

    const slots = template.ingredientSlots ?? []
    const components: Array<{ grams: number; food: FoodNutrientRow }> = []
    let totalGrams = 0
    for (const slot of slots) {
      const foodIdRef = slot.nutritionMapping?.canonicalFoodId
      const grams = slot.amountPrior?.grams
      if (!foodIdRef || typeof grams !== 'number' || grams <= 0) return null
      const food = await this.loadFoodRow(foodIdRef)
      if (!food) return null
      components.push({ grams, food })
      totalGrams += grams
    }

    const fatFoodId = template.addedFat?.foodId
    const fatGrams = template.addedFat?.grams
    if (fatFoodId && typeof fatGrams === 'number' && fatGrams > 0) {
      const fat = await this.loadFoodRow(fatFoodId)
      if (!fat) return null
      components.push({ grams: fatGrams, food: fat })
      totalGrams += fatGrams
    }

    if (components.length === 0 || totalGrams <= 0) return null

    // ResolvedFood rows are PER-100 g (the one computational basis — the dish
    // KB source normalizes the same way). The user's confirmed portion size is
    // kept as servingSizeG so downstream gram math stays faithful.
    const servingGrams = portionGrams && portionGrams > 0 ? portionGrams : totalGrams
    const per100 = 100 / totalGrams
    const nutrient = (key: keyof FoodNutrientRow): number | null => {
      if (components.some((c) => c.food[key] == null)) return null
      const value = components.reduce((sum, c) => sum + (c.food[key] ?? 0) * c.grams / 100, 0) * per100
      return Number.isFinite(value) ? value : null
    }

    return {
      foodId,
      sourceId: foodId.slice('household_dish:'.length),
      sourceVersion: null,
      attribution: 'Your saved version of this dish',
      name: row.canonical_name,
      brand: null,
      energyKcal: nutrient('energy_kcal'),
      proteinG: nutrient('protein_g'),
      fatG: nutrient('fat_g'),
      carbG: nutrient('carb_g'),
      fiberG: nutrient('fiber_g'),
      sugarG: nutrient('sugar_g'),
      sodiumMg: nutrient('sodium_mg'),
      servingSizeG: servingGrams,
      servingDesc: `${Math.round(servingGrams)} g portion`,
      license: 'User Content',
      source: this.id,
    }
  }

  private async loadFoodRow(foodIdRef: string): Promise<FoodNutrientRow | null> {
    if (foodIdRef.startsWith('ifct:')) {
      if (!this.ifctDb) return null
      return this.ifctDb.get<FoodNutrientRow>(
        `SELECT ${NUTRIENT_FIELDS} FROM foods WHERE source = 'ifct' AND source_id = ?`,
        [foodIdRef.slice(5)],
      )
    }
    if (foodIdRef.startsWith('usda:')) {
      if (!this.nutritionDb) return null
      return this.nutritionDb.get<FoodNutrientRow>(
        `SELECT ${NUTRIENT_FIELDS} FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?`,
        [foodIdRef.slice(5)],
      )
    }
    if (foodIdRef.startsWith('userfood:')) {
      return this.userDb.get<FoodNutrientRow>(
        `SELECT ${NUTRIENT_FIELDS} FROM user_foods WHERE uuid = ? AND deleted_at IS NULL`,
        [foodIdRef.slice('userfood:'.length)],
      )
    }
    return null
  }

  getLicenseInfo(): SourceLicenseInfo {
    return {
      name: 'Household Dish Variants',
      version: null,
      attribution: 'User Created',
      license: 'Private',
      redistributionPermitted: false,
    }
  }
}
