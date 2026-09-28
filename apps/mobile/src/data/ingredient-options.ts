import type { DbAdapter } from '@nutai/db-adapter'
import { IFCTSource, USDASource, UserFoodSource } from '@nutai/nutrition-sources'
import { toMatchExpression, normalizeIndianAliases } from '@nutai/resolver'
import { createCustomFood, type CustomFood } from './custom-foods'

export interface IngredientOption {
  foodId: string
  label: string
  source: 'userfood' | 'ifct' | 'usda'
  kcalPer100g: number | null
}

/**
 * English↔English synonyms oriented at how the two bundled corpora actually
 * name foods. The user's word and the corpus word are often different English
 * words — "curd" never matches USDA's "Yogurt", "brinjal" never matches
 * IFCT-less USDA "Eggplant", "peanut" never matches IFCT's "Groundnut" — and
 * those misses are exactly why ingredient search felt USDA-only: for common
 * Indian kitchen words the IFCT cohort silently returned zero rows. Expansion
 * is bidirectional so typing either side finds both.
 */
const INGREDIENT_SYNONYMS: readonly (readonly [string, string])[] = Object.freeze([
  ['curd', 'yogurt'],
  ['dahi', 'yogurt'],
  ['curd', 'dahi'],
  ['brinjal', 'eggplant'],
  ['aubergine', 'eggplant'],
  ['peanut', 'groundnut'],
  ['mungfali', 'groundnut'],
  ['okra', 'ladies finger'],
  ['bhindi', 'ladies finger'],
  ['chickpea', 'bengal gram'],
  ['chana', 'bengal gram'],
  ['chhole', 'chickpea'],
  ['gram flour', 'besan'],
  ['gram flour', 'chickpea flour'],
  ['besan', 'chickpea flour'],
  ['refined flour', 'maida'],
  ['mutton', 'goat meat'],
  ['gosht', 'goat meat'],
  ['beetroot', 'beet'],
  ['chukandar', 'beet'],
  ['capsicum', 'bell pepper'],
  ['shimla mirch', 'bell pepper'],
  ['cottage cheese', 'paneer'],
  ['cream', 'malai'],
  ['tapioca', 'sago'],
  ['sabudana', 'sago'],
  ['rice flakes', 'poha'],
  ['flattened rice', 'poha'],
  ['semolina', 'rava'],
  ['suji', 'semolina'],
  ['fenugreek', 'methi'],
  ['asafoetida', 'hing'],
  ['carom', 'ajwain'],
  ['amaranth', 'rajgira'],
  ['pearl millet', 'bajra'],
  ['finger millet', 'ragi'],
  ['sorghum', 'jowar'],
  ['colocasia', 'arbi'],
  ['taro', 'arbi'],
  ['gooseberry', 'amla'],
  ['tamarind', 'imli'],
  ['jaggery', 'gur'],
  ['milk solids', 'khoya'],
  ['milk solids', 'mawa'],
  ['buttermilk', 'chaach'],
  ['buttermilk', 'mattha'],
  ['fox nut', 'makhana'],
  ['water chestnut', 'singhara'],
  ['sesame', 'til'],
  ['sesame', 'gingelly'],
  ['nigella seeds', 'kalonji'],
  ['mint', 'pudina'],
  ['coriander leaves', 'dhania'],
  ['cumin', 'jeera'],
  ['turmeric', 'haldi'],
  ['clarified butter', 'ghee'],
  ['red gram', 'toor'],
  ['red gram', 'arhar'],
  ['black gram', 'urad'],
  ['green gram', 'moong'],
  ['lentil', 'masoor'],
  ['kidney bean', 'rajma'],
  ['cowpea', 'lobhia'],
  ['cowpea', 'chawli'],
  ['bitter gourd', 'karela'],
  ['bottle gourd', 'lauki'],
  ['ridge gourd', 'turai'],
  ['round gourd', 'tinda'],
  ['pumpkin', 'kaddu'],
  ['radish', 'mooli'],
  ['carrot', 'gajar'],
  ['cucumber', 'kheera'],
  ['cucumber', 'kakdi'],
  ['spinach', 'palak'],
  ['cauliflower', 'gobi'],
  ['cabbage', 'pattagobi'],
  ['potato', 'aloo'],
  ['onion', 'pyaz'],
  ['garlic', 'lehsun'],
  ['ginger', 'adrak'],
  ['eggplant', 'baingan'],
  ['yam', 'suran'],
  ['sweet potato', 'shakarkandi'],
  ['turnip', 'shalgam'],
  ['buckwheat', 'kuttu'],
  ['corn', 'makki'],
  ['moth bean', 'matki'],
  ['horse gram', 'kulthi'],
  ['raisin', 'kishmish'],
  ['fig', 'anjeer'],
  ['sapota', 'chikoo'],
  ['custard apple', 'sitaphal'],
  ['java plum', 'jamun'],
  ['wood apple', 'bael'],
])

/** synonym word -> every word it can stand for (including itself via original). */
const SYNONYM_INDEX: Map<string, Set<string>> = (() => {
  const index = new Map<string, Set<string>>()
  const add = (from: string, to: string) => {
    if (!index.has(from)) index.set(from, new Set())
    index.get(from)!.add(to)
  }
  for (const [a, b] of INGREDIENT_SYNONYMS) {
    add(a, b)
    add(b, a)
  }
  return index
})()

/**
 * Expand a raw ingredient query into the small set of FTS expressions that
 * should be run against every corpus: the term itself, its Indian-alias
 * canonicalisation (methi -> fenugreek), and its corpus-naming synonyms
 * (curd -> yogurt, brinjal -> eggplant). Bounded to 5 variants so one exotic
 * query cannot fan out unboundedly.
 */
export function expandIngredientTerm(term: string): string[] {
  const cleaned = String(term ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
  if (!cleaned) return []

  const variants = new Set<string>([cleaned])

  // Whole-phrase rewrite via the dish-resolver alias table ("methi" ->
  // "fenugreek", "sabudana" -> "tapioca pearl", ...) — both the rewritten form
  // and, for multi-word phrases, the per-token rewrites.
  const aliasedPhrase = normalizeIndianAliases(cleaned)
  if (aliasedPhrase && aliasedPhrase !== cleaned) variants.add(aliasedPhrase)
  for (const token of cleaned.split(/\s+/)) {
    const aliasedToken = normalizeIndianAliases(token)
    if (aliasedToken && aliasedToken !== token) variants.add(aliasedToken)
  }

  // English corpus-naming synonyms, whole phrase first then per token.
  const addSynonymsOf = (phrase: string) => {
    const exact = SYNONYM_INDEX.get(phrase)
    if (exact) for (const synonym of exact) variants.add(synonym)
  }
  addSynonymsOf(cleaned)
  for (const token of cleaned.split(/\s+/)) addSynonymsOf(token)

  return [...variants].slice(0, 5)
}

/**
 * Search every ingredient source the decomposer can cook with: the user's own
 * custom foods first, then IFCT 2017, then USDA FDC. Each corpus is queried
 * with every term variant so a synonym or Hindi name still finds the row that
 * uses the other English word. Multi-source — the same dish ingredient often
 * exists in two corpora with different granularities, and the picker says
 * which database each row came from instead of silently hiding one.
 */
export async function searchIngredientOptions(
  nutritionDb: DbAdapter,
  ifctDb: DbAdapter | undefined,
  userDb: DbAdapter | undefined,
  term: string,
): Promise<IngredientOption[]> {
  const variants = expandIngredientTerm(term)
  if (variants.length === 0) return []
  const expressions = variants
    .map((variant) => toMatchExpression(variant))
    .filter((expression): expression is string => Boolean(expression))
  if (expressions.length === 0) return []

  async function searchCohort(
    source: { search: (expression: string) => Promise<Array<{ foodId: string; name: string; energyKcal: number | null }>> },
    sourceName: 'userfood' | 'ifct' | 'usda',
  ): Promise<IngredientOption[]> {
    const seen = new Set<string>()
    const out: IngredientOption[] = []
    for (const expression of expressions) {
      const rows = await source.search(expression).catch(() => [])
      for (const row of rows) {
        if (seen.has(row.foodId)) continue
        seen.add(row.foodId)
        out.push({
          foodId: row.foodId,
          label: row.name,
          source: sourceName,
          kcalPer100g: row.energyKcal ?? null,
        })
      }
    }
    return out
  }

  const perSourceCohorts = await Promise.all([
    (async (): Promise<IngredientOption[]> => {
      if (!userDb) return []
      return searchCohort(new UserFoodSource(userDb), 'userfood')
    })(),
    (async (): Promise<IngredientOption[]> => {
      if (!ifctDb) return []
      return searchCohort(new IFCTSource(ifctDb), 'ifct')
    })(),
    searchCohort(new USDASource(nutritionDb), 'usda'),
  ])

  const seen = new Set<string>()
  const out: IngredientOption[] = []
  // Cap per cohort so one 7,928-row corpus cannot drown the others; user rows
  // come first because they are the user's own reviewed ingredients.
  for (const cohort of perSourceCohorts) {
    for (const option of cohort.slice(0, 6)) {
      if (seen.has(option.foodId)) continue
      seen.add(option.foodId)
      out.push(option)
    }
  }
  return out
}

export interface NewIngredientInput {
  name: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g?: number | null
}

/**
 * Create a custom ingredient on a per-100 g basis. It lands in `user_foods`,
 * which the food search and the ingredient pickers both query — so an
 * ingredient that neither IFCT nor USDA knows becomes a first-class,
 * searchable citizen the moment it is saved.
 */
export async function createIngredientFood(
  userDb: DbAdapter,
  input: NewIngredientInput,
  now: number,
): Promise<CustomFood> {
  return createCustomFood(userDb, {
    name: input.name,
    servingAmount: 100,
    servingUnit: 'g',
    calories: input.kcal,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    fiber_g: input.fiber_g ?? null,
  }, now)
}
