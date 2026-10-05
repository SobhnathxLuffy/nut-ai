import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View, TextInput, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { openNutritionDb, openIfctDb, openUserDb } from '../src/db/expo-adapter'
import { showToast } from '../src/components/toast-store'

import type { DbAdapter } from '@nutai/db-adapter'
import { COOKING_FAT_OPTIONS, COOKING_METHOD_OPTIONS, resolveCookedYieldGrams } from '@nutai/indian-dishes'
import {
  searchIngredientOptions,
  createIngredientFood,
  type IngredientOption,
} from '../src/data/ingredient-options'

import { encodeFoodReview } from '../src/data/food-review'
import { per100Snapshot } from '../src/data/dish-snapshot'
import { dishIngredientBreakdown, humanizeSlotLabel, type DishRowLike } from '../src/data/dish-ingredients'
import {
  applyDishClarifications,
  clarifiedSlotLines,
  dishClarificationQuestions,
  dishOpenUnknowns,
  dishPriorKcalRange,
  dishUncertaintyModel,
  humanizeUnknownKey,
  rowIsFried,
  zeroedClarificationSlots,
  type ClarificationQuestion,
  type DishClarificationAnswer,
  type DishClarificationAnswers,
} from '../src/data/dish-clarifications'
import { estimateOilAbsorption, roundGrams } from '@nutai/recipe-engine'
import { Badge } from '../src/components/Badge'
import { Disclosure } from '../src/components/Disclosure'
import { ChipRow } from '../src/components/ChipRow'
import { NewIngredientForm } from '../src/components/NewIngredientForm'
import { Icon } from '../src/components/Icon'

type DishDef = any
interface Component { id: string, name: string, foodId: string | null, resolvedName: string | null, source: string, grams: number, protein_g: number|null, carbs_g: number|null, fat_g: number|null, kcal: number|null, /** Recipe-template slot this row was derived from; null for ingredients the user added. */ slotLabel?: string | null }

// WEB-003: household variants are persisted in the writable user DB. The table
// mirrors the corpus schema columns this screen reads and writes.
async function ensureUserDishTable(u: DbAdapter): Promise<void> {
  await u.run(
    `CREATE TABLE IF NOT EXISTS dish_definitions (
      id TEXT PRIMARY KEY NOT NULL,
      search_rowid INTEGER,
      canonical_name TEXT,
      category TEXT,
      family TEXT,
      parent_dish_id TEXT,
      recipe_template_json TEXT,
      portion_model_json TEXT,
      record_status TEXT
    )`
  )
}

interface NutrientFetch { name: string | null, kcal: number | null, protein_g: number | null, carbs_g: number | null, fat_g: number | null }

async function fetchFoodNutrients(
  nutritionDb: DbAdapter,
  ifctDb: DbAdapter | null,
  userDb: DbAdapter | null,
  foodId: string,
): Promise<NutrientFetch | null> {
  if (foodId.startsWith('ifct:') && ifctDb) {
    const row = await ifctDb.get<any>('SELECT name, energy_kcal, protein_g, fat_g, carb_g FROM foods WHERE source_id = ?', [foodId.slice(5)])
    return row ? { name: row.name, kcal: row.energy_kcal, protein_g: row.protein_g, carbs_g: row.carb_g, fat_g: row.fat_g } : null
  }
  if (foodId.startsWith('usda:') && nutritionDb) {
    const row = await nutritionDb.get<any>("SELECT name, energy_kcal, protein_g, fat_g, carb_g FROM foods WHERE source_id = ? AND source LIKE 'fdc_%'", [foodId.slice(5)])
    return row ? { name: row.name, kcal: row.energy_kcal, protein_g: row.protein_g, carbs_g: row.carb_g, fat_g: row.fat_g } : null
  }
  if (foodId.startsWith('userfood:') && userDb) {
    const row = await userDb.get<any>('SELECT name, energy_kcal, protein_g, fat_g, carb_g FROM user_foods WHERE uuid = ? AND deleted_at IS NULL', [foodId.slice('userfood:'.length)])
    return row ? { name: row.name, kcal: row.energy_kcal, protein_g: row.protein_g, carbs_g: row.carb_g, fat_g: row.fat_g } : null
  }
  return null
}

let componentKeySeq = 0
function nextComponentKey(): string {
  componentKeySeq += 1
  return `c${componentKeySeq}`
}

export default function DishComposerScreen() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dishId?: string, newDishName?: string, date?: string }>()

  const [db, setDb] = useState<DbAdapter | null>(null)
  const [ifctDb, setIfctDb] = useState<DbAdapter | null>(null)
  const [userDb, setUserDb] = useState<DbAdapter | null>(null)
  const [dish, setDish] = useState<DishDef | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [portion, setPortion] = useState('150')
  // FAT SELECTOR IS THE RECIPE'S FAT — never a second silent serving of it.
  // Initial state is overwritten by the dish load effect: a dish with its own
  // fat ingredient preselects that oil with the recipe's grams; a dish
  // without one opens at "No Added Oil / Dry Roasted" (0 g). The old
  // hardcoded mustard-14g default double-counted every dish whose template
  // already carried frying oil / tadka fat (Samosa, Sambar, Poha, Chole
  // Bhature, …) — ~100-130 kcal of invisible fat per serving.
  const [fatOptionId, setFatOptionId] = useState<string>('no-added-oil')
  const [fatGrams, setFatGrams] = useState<string>('0')
  const [cookingMethod, setCookingMethod] = useState('curried')
  const [fatNutrients, setFatNutrients] = useState<NutrientFetch | null>(null)
  // VERIFIED-YIELD RULE: a curated dish carries a verified cooked yield
  // (e.g. roti 0.88). Using it keeps the composer arithmetic IDENTICAL to the
  // curated per-100 g numbers shown in search — generic method multipliers
  // are only a fallback for dishes without one.
  const [recipeYield, setRecipeYield] = useState<number | null>(null)
  const [useRecipeYield, setUseRecipeYield] = useState(true)

  // O5 (AGENTS.md §0.2): clarification questions from the dish uncertainty
  // model. The raw DB row feeds the adapter; answers live in THIS component's
  // state only — they are never persisted to the dish record (the household
  // save stores the user's confirmed grams, not the answers).
  const [dishRow, setDishRow] = useState<DishRowLike | null>(null)
  const [answers, setAnswers] = useState<DishClarificationAnswers>({})
  const [skippedIds, setSkippedIds] = useState<Record<string, boolean>>({})
  // True once the user edits the composition (grams, fat, rows) — the shown
  // estimate stops being the pure reviewed prior, so the prior band hides.
  const [compositionEdited, setCompositionEdited] = useState(false)
  // The template JSON the component rows were last derived from — the
  // re-derive effect skips when nothing changed (skip = current behavior).
  const derivedTemplateRef = useRef<string | null>(null)
  // §8.3 rapid-tap guard: a fast double-tap on "Log household variant" used to
  // save TWO household variants (Date.now() ids) and push food-review twice.
  const isLoggingRef = useRef(false)

  // Ingredient search across user foods + IFCT + USDA, plus the create-new
  // flow for ingredients no database knows — now owned PER COMPONENT by
  // <IngredientResolver> (QA P2-21): one shared query state used to make
  // every unresolved component's box type into the same query, duplicate the
  // same result list, and attach taps to the wrong row.

  useEffect(() => {
    let alive = true
    // WEB-003: the user DB is the writable store. Household variants are user
    // data and must never be written into the read-only nutrition corpus.
    Promise.all([openNutritionDb(), openIfctDb(), openUserDb()]).then(async ([h, ih, u]) => {
      if (!alive) return
      await ensureUserDishTable(u)
      if (alive) { setDb(h); setIfctDb(ih); setUserDb(u) }
    }).catch(e => {
      if (alive) { setError(String(e)); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  const newComponent = (name: string, foodId: string | null, source: string, grams: number, slotLabel: string | null = null): Component => ({
    id: nextComponentKey(), name, foodId, resolvedName: null, source, grams, kcal: null, protein_g: null, carbs_g: null, fat_g: null, slotLabel,
  })

  // The ONE component-derivation path, shared by the load AND the
  // clarification re-derive: verified prior fractions → per-serving grams via
  // dishIngredientBreakdown, the fat_variable fold into the Cooking Fat / Oil
  // selector, per-slot nutrient fetch. Clarifications change the INPUT row
  // (slot mapping / prior range), never this code — the estimate re-derives
  // exactly as it does today.
  const buildComponentsFromRow = async (
    nutritionDb: DbAdapter,
    ifct: DbAdapter,
    user: DbAdapter,
    rowLike: DishRowLike,
    zeroedLabels: string[],
  ): Promise<{
    comps: Component[]
    fatOptionId: string | null
    fatGrams: string | null
    fatDefaultApplied: boolean
    standardPortionGrams: number | null
  }> => {
    // Build components from the template. The template's own slots win. (P2-11:
    // the name-derived "ingredientSuggestions" fallback was deleted — the
    // mechanism was provably inert for the all-CURATED corpus and never
    // produced a single suggestion.)
    const slots: any[] = JSON.parse(rowLike.recipe_template_json || '{}').ingredientSlots ?? []

    // FRACTION -> GRAMS: verified slot ranges are mass fractions of the raw
    // batch. dishIngredientBreakdown converts them to the SAME per-serving
    // grams the deterministic engine uses — mid(range)/SUM(mids) x
    // (standardPortionGrams / verifiedNumericYield). A roti opens with 1.1 g
    // ghee, never the old flat 50 g fallback.
    const breakdown = dishIngredientBreakdown(rowLike, true)

    const comps: Component[] = []
    let foldOptionId: string | null = null
    let foldGrams: string | null = null
    let fatDefaultApplied = false
    for (const slot of slots) {
      // A multiplier-0 answer ("None / Dry Roasted") REMOVES the ingredient —
      // no row, no fold, and never the 30 g fallback below.
      if (zeroedLabels.includes(slot.label)) continue
      const foodId = slot.nutritionMapping?.canonicalFoodId || null
      const line = breakdown.lines.find((candidate) => candidate.label === slot.label)
      // FOLDING RULE: a fat_variable slot whose mapped food the Cooking
      // Fat / Oil selector represents (ghee, mustard, sunflower, groundnut,
      // butter) is NOT rendered twice. It becomes the selector's preselected
      // option with the fraction-derived grams.
      if (line?.foldedIntoFat && breakdown.fatFold) {
        const option = COOKING_FAT_OPTIONS.find((f) => f.optionId === breakdown.fatFold!.optionId)
        if (option) {
          foldOptionId = option.optionId
          foldGrams = String(Math.round(breakdown.fatFold.grams * 10) / 10)
          fatDefaultApplied = true
          continue
        }
      }
      const grams = line && line.grams > 0
        ? line.grams
        : (typeof slot.amountPrior?.grams === 'number' && slot.amountPrior.grams > 0 ? slot.amountPrior.grams : 30)
      const comp = newComponent(line?.display ?? slot.label, foodId, foodId ? foodId.split(':')[0] : '', grams, slot.label)
      if (foodId) {
        const nutrients = await fetchFoodNutrients(nutritionDb, ifct, user, foodId)
        if (nutrients) {
          comp.resolvedName = nutrients.name
          comp.kcal = nutrients.kcal
          comp.protein_g = nutrients.protein_g
          comp.carbs_g = nutrients.carbs_g
          comp.fat_g = nutrients.fat_g
        }
      }
      comps.push(comp)
    }
    return { comps, fatOptionId: foldOptionId, fatGrams: foldGrams, fatDefaultApplied, standardPortionGrams: breakdown.standardPortionGrams }
  }

  useEffect(() => {
    if (!db || !ifctDb || !userDb) return
    let alive = true
    const load = async () => {
      try {
        if (!params.dishId && params.newDishName) {
           if (alive) {
              setDish({
                 id: 'new_dish_' + Date.now(),
                 searchRowId: Math.floor(Math.random() * 1000000),
                 parentDishId: null,
                 category: 'Custom',
                 family: '',
                 canonicalName: params.newDishName,
                 recordStatus: 'HOUSEHOLD',
                 recipeTemplate: { ingredientSlots: [] }
              })
              setDishRow(null)
              setAnswers({})
              setSkippedIds({})
              setCompositionEdited(false)
              derivedTemplateRef.current = null
              setComponents([])
              setLoading(false)
           }
           return
        }

        // WEB-003: household variants live in the user DB; the corpus is
        // read-only and only holds curated/draft definitions.
        const row = (await userDb.get<any>('SELECT * FROM dish_definitions WHERE id = ?', [params.dishId as string]))
          ?? (await db.get<any>('SELECT * FROM dish_definitions WHERE id = ?', [params.dishId as string]))
        if (!row) throw new Error('Dish not found')
        const parsed = {
           id: row.id,
           searchRowId: row.search_rowid,
           parentDishId: row.parent_dish_id,
           category: row.category,
           family: row.family,
           canonicalName: row.canonical_name,
           recordStatus: row.record_status,
           recipeTemplate: JSON.parse(row.recipe_template_json || '{}'),
           yieldModel: JSON.parse(row.yield_model_json || '{}'),
           portionModel: JSON.parse(row.portion_model_json || '{}')
        }
        if (alive) setDish(parsed)
        // The RAW row (incl. uncertainty_model_json) feeds the clarification
        // adapter — `parsed` above drops the columns the adapter needs.
        if (alive) setDishRow(row)

        // Portion + yield come from the reviewed record, not flat defaults:
        // a roti opens at its verified 40 g standard portion with the verified
        // 0.88 cooked yield, not 150 g / 'curried'.
        const verifiedYield = typeof parsed.yieldModel?.verifiedNumericYield === 'number' && parsed.yieldModel.verifiedNumericYield > 0
          ? parsed.yieldModel.verifiedNumericYield
          : null
        if (alive && verifiedYield != null) {
          setRecipeYield(verifiedYield)
          setUseRecipeYield(true)
        } else if (alive) {
          setRecipeYield(null)
        }

        // REFLECTIVE FAT DEFAULT. Priority order:
        //   1. A fat_variable slot whose mapped food the selector represents
        //      (ghee, mustard, sunflower, groundnut, butter) FOLDS into the
        //      selector — the slot becomes the preselected option with the
        //      fraction-derived grams and is NOT rendered twice.
        //   2. Otherwise a household variant's explicitly saved fat
        //      (template.addedFat) is restored exactly as saved.
        //   3. Otherwise the selector opens at No Added Oil (0 g) — the
        //      recipe's own named fat rows are the single source of truth.
        const built = await buildComponentsFromRow(db, ifctDb, userDb, row, [])
        if (alive) {
          if (built.fatOptionId && built.fatGrams != null) {
            setFatOptionId(built.fatOptionId)
            setFatGrams(built.fatGrams)
          }
          if (built.standardPortionGrams != null) setPortion(String(built.standardPortionGrams))
          if (!built.fatDefaultApplied) {
            // Reflect the recipe: restore an explicitly saved household fat,
            // else open with no added fat. Never a silent 14 g.
            const savedFat = parsed.recipeTemplate?.addedFat
            const savedOption = savedFat?.foodId
              ? COOKING_FAT_OPTIONS.find((f) => f.foodId === savedFat.foodId)
              : null
            if (savedOption) {
              setFatOptionId(savedOption.optionId)
              setFatGrams(String(Math.round((savedFat.grams ?? savedOption.defaultGrams) * 10) / 10))
            } else {
              setFatOptionId('no-added-oil')
              setFatGrams('0')
            }
          }
          setComponents(built.comps)
          // Fresh record: no stale answers, no manual edits, and the derive
          // baseline is THIS template so the clarify effect below stays idle.
          setAnswers({})
          setSkippedIds({})
          setCompositionEdited(false)
          derivedTemplateRef.current = row.recipe_template_json ?? null
          setLoading(false)
        }
      } catch (e) {
        if (alive) { setError(String(e)); setLoading(false) }
      }
    }
    load()
    return () => { alive = false }
  }, [db, ifctDb, userDb, params.dishId])

  // CLARIFICATIONS (O5): an answer re-runs the SAME derivation on the
  // clarified row — the answer changes the INPUT (slot mapping / prior
  // range), never the arithmetic. `applyDishClarifications` returns a NEW row
  // (the engine is immutable), so `dishRow` — and the household save below —
  // never see the answers. No answers (skip) → the row itself, byte-for-byte
  // the load-time template.
  const clarifiedRow = dishRow && Object.keys(answers).length > 0
    ? applyDishClarifications(dishRow, answers)
    : dishRow

  useEffect(() => {
    if (!clarifiedRow || !db || !ifctDb || !userDb) return
    const templateJson = clarifiedRow.recipe_template_json ?? null
    if (templateJson == null || templateJson === derivedTemplateRef.current) return
    let alive = true
    const rederive = async () => {
      try {
        const zeroed = zeroedClarificationSlots(answers)
        const built = await buildComponentsFromRow(db, ifctDb, userDb, clarifiedRow, zeroed)
        if (!alive) return
        // Slot rows re-derive from the model; ingredients the user added
        // themselves (slotLabel == null) are preserved — answering never
        // deletes user input.
        setComponents((prev) => [...built.comps, ...prev.filter((c) => c.slotLabel == null)])
        derivedTemplateRef.current = templateJson
        if (built.fatOptionId && built.fatGrams != null) {
          // The clarified fat (e.g. mustard instead of the recipe's ghee)
          // becomes the selector's preselected option with the same
          // fraction-derived grams.
          setFatOptionId(built.fatOptionId)
          setFatGrams(built.fatGrams)
        } else if (zeroed.length > 0) {
          // "None / Dry Roasted": the recipe's fat was answered away — the
          // selector resets to none rather than keeping a stale option.
          setFatOptionId('no-added-oil')
          setFatGrams('0')
        }
      } catch {
        // A failed re-derive keeps the previous derivation on screen — the
        // user can still edit everything by hand.
      }
    }
    void rederive()
    return () => { alive = false }
  }, [clarifiedRow, db, ifctDb, userDb])

  // The questions come from the RAW record (the question set is fixed at
  // load); answers stay changeable while the screen is open.
  const clarifyQuestions = useMemo(() => (dishRow ? dishClarificationQuestions(dishRow) : []), [dishRow])
  const clarifiedLines = useMemo(() => (clarifiedRow ? clarifiedSlotLines(clarifiedRow) : []), [clarifiedRow])
  const openUnknowns = useMemo(() => (dishRow ? dishOpenUnknowns(dishRow, answers) : []), [dishRow, answers])
  const hasUncertaintyModel = dishRow != null && dishUncertaintyModel(dishRow) != null
  const unansweredCount = clarifyQuestions.filter((q) => !answers[q.id] && !skippedIds[q.id]).length

  const answerQuestion = (question: ClarificationQuestion, option: ClarificationQuestion['options'][number]) => {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: option.amountMultiplier !== undefined
        ? { canonicalFoodId: option.canonicalFoodId, amountMultiplier: option.amountMultiplier }
        : { canonicalFoodId: option.canonicalFoodId },
    }))
    setSkippedIds((prev) => ({ ...prev, [question.id]: false }))
  }

  const skipQuestion = (question: ClarificationQuestion) => {
    setSkippedIds((prev) => ({ ...prev, [question.id]: true }))
  }

  const addIngredient = () => {
    setCompositionEdited(true)
    setComponents([...components, newComponent('New Ingredient', null, '', 100)])
  }

  const removeComponent = (id: string) => {
    setCompositionEdited(true)
    setComponents(components.filter(c => c.id !== id))
  }

  const updateName = (id: string, text: string) => {
    setCompositionEdited(true)
    setComponents(components.map(c => c.id === id ? { ...c, name: text, foodId: null, resolvedName: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null } : c))
  }

  const updateGrams = (id: string, text: string) => {
    setCompositionEdited(true)
    setComponents(components.map(c => c.id === id ? { ...c, grams: parseFloat(text) || 0 } : c))
  }

  const attachCandidate = (id: string, option: IngredientOption, nutrients: NutrientFetch | null) => {
    setCompositionEdited(true)
    setComponents(components.map(c => c.id === id ? {
      ...c,
      foodId: option.foodId,
      name: option.label,
      resolvedName: nutrients?.name ?? option.label,
      kcal: nutrients?.kcal ?? option.kcalPer100g,
      protein_g: nutrients?.protein_g ?? null,
      carbs_g: nutrients?.carbs_g ?? null,
      fat_g: nutrients?.fat_g ?? null,
    } : c))
  }

  const fatOption = COOKING_FAT_OPTIONS.find((f) => f.optionId === fatOptionId) ?? COOKING_FAT_OPTIONS[0]
  const fatG = fatOption.foodId ? parseFloat(fatGrams) || 0 : 0

  // The selected fat's nutrient row (per-100 g) — fetched like any ingredient.
  useEffect(() => {
    if (!db || !fatOption?.foodId) {
      setFatNutrients(null)
      return
    }
    let alive = true
    fetchFoodNutrients(db, ifctDb, userDb, fatOption.foodId).then((n) => {
      if (alive) setFatNutrients(n)
    })
    return () => { alive = false }
  }, [db, ifctDb, userDb, fatOptionId])

  const totalRawMass = components.reduce((s, c) => s + c.grams, 0) + fatG
  // Owner QA 2026-10 oil semantics: the fat input is OIL IN THE PAN, not oil
  // eaten. A fried dish (its own cook_or_fry/deep_fried methods, or the
  // user's explicit Deep Fried method choice) absorbs only part of it —
  // one shared model (estimateOilAbsorption) decides the charge everywhere.
  const dishFried = cookingMethod === 'deep_fried' || (dishRow != null && rowIsFried(dishRow))
  const oilAbsorption = estimateOilAbsorption({
    usedGrams: fatG,
    rawFoodGrams: Math.max(totalRawMass - fatG, 0),
    frying: dishFried && fatG > 0,
  })
  const fatChargeGrams = oilAbsorption.frying ? oilAbsorption.absorbedMid : fatG
  // Same yield model the decomposer uses — water-adding methods scale the pot
  // up, moisture-loss methods shrink it. When the dish carries a verified
  // recipe yield (curated records do), it governs instead so the composer
  // reproduces the curated numbers exactly.
  const effectiveYieldMultiplier = useRecipeYield && recipeYield != null ? recipeYield : null
  const cookedYield = totalRawMass > 0
    ? (effectiveYieldMultiplier != null
        ? totalRawMass * effectiveYieldMultiplier
        // eslint-disable-next-line no-restricted-syntax -- cookingMethod arrives as free text and is funnelled through the yield engine's union
        : resolveCookedYieldGrams(totalRawMass, cookingMethod as any).cookedYieldGrams)
    : 0

  const portionG = parseFloat(portion) || 150
  const multiplier = cookedYield > 0 ? portionG / cookedYield : 0

  let totalKcal = 0; let totalP = 0; let totalC = 0; let totalF = 0;
  let hasUnknowns = false
  for (const c of components) {
     if (c.kcal === null) hasUnknowns = true
     else {
       totalKcal += c.kcal * (c.grams/100)
       totalP += (c.protein_g||0) * (c.grams/100)
       totalC += (c.carbs_g||0) * (c.grams/100)
       totalF += (c.fat_g||0) * (c.grams/100)
     }
  }
  // The cooking fat's nutrients are part of the dish — at the ABSORBED share
  // on fried dishes (the rest of the poured oil stays in the pan and is not
  // counted as eaten). Previously the fat added mass here and its calories
  // silently vanished from the total; now it is charged honestly.
  if (fatOption.foodId) {
    if (fatNutrients && fatNutrients.kcal != null) {
      totalKcal += fatNutrients.kcal * (fatChargeGrams / 100)
      totalP += (fatNutrients.protein_g || 0) * (fatChargeGrams / 100)
      totalC += (fatNutrients.carbs_g || 0) * (fatChargeGrams / 100)
      totalF += (fatNutrients.fat_g || 0) * (fatChargeGrams / 100)
    } else {
      hasUnknowns = true
    }
  }

  const portionKcal = hasUnknowns ? null : totalKcal * multiplier
  const portionP = hasUnknowns ? null : totalP * multiplier
  const portionC = hasUnknowns ? null : totalC * multiplier
  const portionF = hasUnknowns ? null : totalF * multiplier

  // O5 (report Ch 10 "uncertainty stays visible"): the estimate's range from
  // the model's OWN numbers — the reviewed fraction priors clamped low/high
  // and re-derived through the same breakdown path. Honest only while the
  // composition is still the prior (no manual gram/fat edits), fully
  // resolved, and under the verified yield; a collapsed band renders nothing
  // rather than fake precision.
  const kcalBySlot: Record<string, number | null> = {}
  for (const c of components) {
    if (c.slotLabel) kcalBySlot[c.slotLabel] = c.kcal
  }
  const foldedSlotLine = clarifiedLines.find((line) => line.foldedIntoFat)
  if (foldedSlotLine && fatOption.foodId) {
    // The folded fat slot's kcal comes from the selector's nutrient row.
    kcalBySlot[foldedSlotLine.label] = fatNutrients?.kcal ?? null
  }
  const priorBand = !compositionEdited && !hasUnknowns && useRecipeYield && recipeYield != null && clarifiedRow != null && hasUncertaintyModel
    ? dishPriorKcalRange({
        row: clarifiedRow,
        kcalPer100gBySlot: kcalBySlot,
        portionGrams: portionG,
        fatAbsorptionFactor: oilAbsorption.frying && fatG > 0 ? oilAbsorption.absorbedMid / fatG : undefined,
      })
    : null

    const runLogDish = async () => {
    // UI/UX report §10.1 (Wave 1b): reversible validation and save failures
    // are toasts — the review data is untouched and the user simply retries.
    if (hasUnknowns) return showToast({ message: 'Resolve all ingredients first — every component needs a nutrition match before the dish can be logged.', tone: 'error' })
    if (!(portionG > 0)) return showToast({ message: 'Enter a valid portion weight — the final portion must be greater than zero grams.', tone: 'error' })

    // Create/update the Household Variant in dish_definitions
    const isEditingHousehold = dish?.recordStatus === 'HOUSEHOLD'
    const newId = isEditingHousehold ? params.dishId : dish?.id + '_household_' + Date.now()
    const searchRowId = isEditingHousehold ? dish.searchRowId : Math.floor(Math.random() * 1000000)
    const canonicalName = isEditingHousehold ? dish.canonicalName : dish?.canonicalName + ' (My Version)'
    const parentDishId = isEditingHousehold ? dish.parentDishId : dish?.id

    // Persist the user's CONFIRMED grams, fat, method, and portion so the
    // household variant can be re-computed (and re-found in search) later —
    // not just logged once.
    const recipeTemplate = {
      ...dish?.recipeTemplate,
      ingredientSlots: components.map(c => ({
        label: c.name,
        nutritionMapping: { canonicalFoodId: c.foodId },
        amountPrior: { kind: 'HOUSEHOLD_MEASURED', grams: c.grams, verified: true },
      })),
      addedFat: fatOption.foodId ? { foodId: fatOption.foodId, grams: fatG } : null,
      cookingMethod,
    }

    // WEB-003: save the household variant to the WRITABLE user DB, not the
    // read-only nutrition corpus. On web the corpus is deserialized with
    // SQLITE_DESERIALIZE_READONLY, so every save used to fail silently and the
    // user's "My Version" dish was never persisted.
    if (!userDb) {
      showToast({ message: 'Database is still loading — try again in a moment.', tone: 'error' })
      return
    }
    try {
      await ensureUserDishTable(userDb)
      await userDb.run(
        'INSERT OR REPLACE INTO dish_definitions (id, search_rowid, canonical_name, category, family, parent_dish_id, recipe_template_json, portion_model_json, record_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [newId, searchRowId, canonicalName, dish?.category || '', dish?.family || '', parentDishId, JSON.stringify(recipeTemplate), JSON.stringify({ standardPortionGrams: portionG, standardPortionStatus: 'verified', assumptionClass: 'HOUSEHOLD' }), 'HOUSEHOLD']
      )
    } catch (e) {
      console.error('Failed to save household variant:', e)
      showToast({ message: `Could not save your version of this dish: ${String(e)}`, tone: 'error' })
      return
    }

    const selection = {
        foodId: null,
        matchedFoodSource: 'household_variant',
        displayName: canonicalName,
        grams: portionG,
        gramPathway: 'decomposed_recipe',
        portionSource: 'user_decomposition',
        // P0-1: nutrientSnapshot is PER-100 g — food-review renders value × grams/100.
        // Sending the portion total here double-scaled every household-variant log.
        nutrientSnapshot: per100Snapshot({ kcal: portionKcal, protein_g: portionP, carbs_g: portionC, fat_g: portionF }, portionG)
    }
    router.push({ pathname: '/food-review', params: { payload: encodeFoodReview({ selection, date: params.date || '' }) } } as never)
  }

  /** Same busy-guard shape as the food tab's logCard — §8.3 duplicate writes. */
  const logDish = async () => {
    if (isLoggingRef.current) return
    isLoggingRef.current = true
    try {
      await runLogDish()
    } finally {
      isLoggingRef.current = false
    }
  }

  if (loading) return <View style={s.container}><ActivityIndicator /></View>

  if (error) {
    return (
      <View style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom, padding: space.md }]}>
        <Text style={[type.body, { color: t.safety }]}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={[s.btn, { borderColor: t.border, marginTop: space.md }]}>
          <Text style={{ color: t.text, textAlign: 'center' }}>Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView style={[s.container, { backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.headerRow}>
        <Text accessibilityRole="header" style={[type.title, { color: t.text }]}>Compose: {dish?.canonicalName}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: t.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      {dish?.recordStatus === 'CURATED' ? (
        <Text style={[s.alert, { color: t.proteinText }]}>Curated recipe — you can still modify to a household variant.</Text>
      ) : (
        <Text style={[s.alert, { color: t.safety }]}>Draft Recipe. Review ingredients and quantities before logging.</Text>
      )}

      {/* O5 (AGENTS.md §0.2): the dish uncertainty model's high-impact
          clarification questions, ABOVE the slot list. Inline cards on the
          working surface — no modal walls; every question stays answerable
          (chips remain tappable after an answer), and Skip proceeds with the
          recipe defaults exactly as the load-time behavior. */}
      {clarifyQuestions.length > 0 ? (
        <View style={{ marginHorizontal: space.md, marginTop: space.md }}>
          <Disclosure
            label="Clarify this estimate"
            caption={
              unansweredCount > 0
                ? `${unansweredCount} question${unansweredCount === 1 ? '' : 's'} from this recipe's uncertainty model — answers refine the grams below`
                : 'All questions answered or skipped'
            }
            defaultOpen
          >
            {clarifyQuestions.map((question) => (
              <ClarifyQuestionCard
                key={question.id}
                question={question}
                answer={answers[question.id]}
                skipped={Boolean(skippedIds[question.id])}
                appliedGrams={clarifiedLines.find((line) => line.label === question.slotLabel)?.grams ?? null}
                onAnswer={(option) => answerQuestion(question, option)}
                onSkip={() => skipQuestion(question)}
              />
            ))}
          </Disclosure>
        </View>
      ) : openUnknowns.length > 0 ? (
        // Owner QA 2026-10: 251 of 362 dishes carry an uncertainty model but
        // got ZERO clarify UI, because the engine only generated questions for
        // two fat-slot labels (and only 111 dishes have a fat slot at all).
        // Dishes unsure about piece weight, gravy ratio, filling amount, …
        // never said so. When there is nothing answerable, the model's own
        // unknown list is still shown — the estimate says what it does not
        // know instead of silently posing as a measurement.
        <View style={{ marginHorizontal: space.md, marginTop: space.md }}>
          <Disclosure
            label="What this estimate is unsure about"
            caption={`${openUnknowns.length} open unknown${openUnknowns.length === 1 ? '' : 's'} from this recipe's uncertainty model`}
          >
            {openUnknowns.map((key) => (
              <Text key={key} style={[type.body, { color: t.text, marginTop: space.xs }]}>
                • {humanizeUnknownKey(key)}
              </Text>
            ))}
            <Text style={[type.caption, { color: t.textMuted, marginTop: space.sm }]}>
              These are the parts of the recipe a standard home version cannot pin down — the reviewed range already covers them. Edit the grams or fat below to match what you actually ate.
            </Text>
          </Disclosure>
        </View>
      ) : null}

      {components.map((c) => (
        <View key={c.id} style={[s.row, { borderColor: t.border, flexDirection: 'column', alignItems: 'stretch' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
               <TextInput allowFontScaling style={[type.body, { color: t.text, padding: 0, margin: 0, fontWeight: 'bold' }]} value={c.name} onChangeText={t => updateName(c.id, t)} placeholder="Ingredient Name" placeholderTextColor={t.textMuted} />
               {/* P1-9: show the resolved food's NAME — a raw source id like
                   ifct:A019 tells the user nothing about the ingredient. */}
               {c.foodId ? <Text style={[type.caption, { color: t.proteinText }]} numberOfLines={2}>Resolved: {c.resolvedName ?? c.foodId}</Text> : <Text style={[type.caption, { color: t.safety }]}>Unresolved Ingredient</Text>}
               <Text style={[type.caption, { color: t.textMuted }]}>
                 {c.kcal !== null ? `${Math.round(c.kcal * (c.grams/100))} kcal · ${Math.round((c.protein_g||0)*(c.grams/100))}g P` : 'Unknown nutrition'}
               </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput allowFontScaling style={[s.input, { color: t.text, borderColor: t.border }]} value={String(c.grams)} onChangeText={t => updateGrams(c.id, t)} keyboardType="numeric" accessibilityLabel={`Grams of ${c.name}`} />
              <Text style={{ color: t.text, marginLeft: 4 }}>g</Text>
              {/* UI/UX report Table 12.1 (Wave 1b): the unicode ✕ remove glyph
                  joins the icon set — one close affordance across the app. */}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} onPress={() => removeComponent(c.id)} style={{ marginLeft: space.md }}><Icon name="close" size={18} color={t.safety}/></Pressable>
            </View>
          </View>

          {!c.foodId && (
            <IngredientResolver
              component={c}
              db={db}
              ifctDb={ifctDb}
              userDb={userDb}
              onResolve={(option, nutrients) => attachCandidate(c.id, option, nutrients)}
            />
          )}
        </View>
      ))}

      <Pressable accessibilityRole="button" onPress={addIngredient} style={[s.btn, { borderColor: t.border }]}><Text style={{ color: t.text }}>+ Add Ingredient</Text></Pressable>

      <Text style={[type.caption, { color: t.text, fontWeight: '600', marginHorizontal: space.md }]}>Cooking Fat / Oil</Text>
      <ChipRow
        items={COOKING_FAT_OPTIONS}
        keyOf={(item) => item.optionId}
        label={(item) => item.label}
        a11yLabel={(item) => `Select ${item.label}`}
        isActive={(item) => fatOptionId === item.optionId}
        onPress={(item) => { setFatOptionId(item.optionId); setFatGrams(String(item.defaultGrams)); setCompositionEdited(true) }}
        innerStyle={{ marginHorizontal: space.md }}
        chipStyle={s.chip}
      />
      {fatOption.foodId ? (
        <View style={[s.row, { borderColor: t.border }]}>
          <Text style={[type.body, { color: t.text, flex: 1 }]}>Oil in the pan (g)</Text>
          <TextInput allowFontScaling style={[s.input, { color: t.text, borderColor: t.border }]} value={fatGrams} onChangeText={(text) => { setFatGrams(text); setCompositionEdited(true) }} keyboardType="numeric" accessibilityLabel="Grams of oil in the pan" />
        </View>
      ) : null}
      {fatOption.foodId && oilAbsorption.frying ? (
        <Text style={[type.caption, { color: t.textMuted, marginHorizontal: space.md, marginTop: space.xs, lineHeight: 18 }]}>
          Estimated absorbed by the food: {roundGrams(oilAbsorption.absorbedLow)}–{roundGrams(oilAbsorption.absorbedHigh)} g (medium confidence) — nutrition counts the absorbed share, not the full pour.
        </Text>
      ) : null}

      <Text style={[type.caption, { color: t.text, fontWeight: '600', marginHorizontal: space.md }]}>Cooking Method & Yield</Text>
      {recipeYield != null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Use verified recipe yield ${recipeYield}`}
          onPress={() => setUseRecipeYield(true)}
          style={[s.chip, { backgroundColor: useRecipeYield ? t.proteinTint : t.bg, borderColor: useRecipeYield ? t.protein : t.border, alignSelf: 'flex-start', marginHorizontal: space.md, marginTop: space.xs }]}
        >
          <Text style={[type.caption, { color: useRecipeYield ? t.proteinText : t.text, fontWeight: '700' }]}>
            Verified recipe yield ×{recipeYield} (matches curated numbers)
          </Text>
        </Pressable>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', gap: space.xs, marginHorizontal: space.md }}>
          {COOKING_METHOD_OPTIONS.map((item) => {
            const active = useRecipeYield === false && cookingMethod === item.method
            return (
              <Pressable
                key={item.method}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.label}`}
                accessibilityState={{ selected: active }}
                onPress={() => { setCookingMethod(item.method); setUseRecipeYield(false) }}
                style={[s.chip, { backgroundColor: active ? t.proteinTint : t.bg, borderColor: active ? t.protein : t.border }]}
              >
                <Text style={[type.caption, { color: active ? t.proteinText : t.text }]}>{item.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>

      <View style={[s.row, { borderColor: t.border }]}>
        <Text style={[type.body, { color: t.text, flex: 1 }]}>Final Portion (g)</Text>
        <TextInput allowFontScaling style={[s.input, { color: t.text, borderColor: t.border }]} value={portion} onChangeText={setPortion} keyboardType="numeric" accessibilityLabel="Final portion grams" />
      </View>

      <View style={[s.summary, { backgroundColor: t.bgSunken, borderColor: t.border }]}>
        <Text style={[type.title, { color: t.text }]}>Nutrition ({portionG}g)</Text>
        {/* Owner QA 2026-10: the badge and the "Open unknowns" list used to
            disappear entirely whenever any ingredient was unresolved — a dish
            carrying an uncertainty model stopped saying what it was unsure
            about exactly when the estimate was least reliable. Both now render
            in every state; the numbers simply stay hidden until resolvable. */}
        {hasUncertaintyModel && openUnknowns.length > 0 ? (
          <Text style={[type.caption, { color: t.textMuted, marginTop: 2 }]}>
            Open unknowns: {openUnknowns.map(humanizeUnknownKey).join(' · ')}
          </Text>
        ) : null}
        {hasUnknowns ? (
          <Text style={[type.body, { color: t.safety }]}>Resolve ingredients to calculate.</Text>
        ) : (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Text style={[type.body, { color: t.proteinText, fontWeight: 'bold' }]}>{Math.round(portionKcal||0)} kcal</Text>
              {hasUncertaintyModel ? (
                <Badge
                  variant="uncertain"
                  size="sm"
                  label={openUnknowns.length > 0 ? `${openUnknowns.length} unknowns open` : 'Prior — not measured'}
                  accessibilityLabel={
                    openUnknowns.length > 0
                      ? `Estimate with ${openUnknowns.length} open unknowns: ${openUnknowns.map(humanizeUnknownKey).join(', ')}`
                      : 'Estimate from a curated prior, not a measurement'
                  }
                />
              ) : null}
            </View>
            {priorBand ? (
              <Text style={[type.caption, { color: t.uncertainText, marginTop: 2 }]}>
                Reviewed prior range {Math.round(priorBand.low)}–{Math.round(priorBand.high)} kcal at {Math.round(portionG)} g
              </Text>
            ) : null}
            <Text style={[type.caption, { color: t.textMuted }]}>P: {Math.round(portionP||0)}g · C: {Math.round(portionC||0)}g · F: {Math.round(portionF||0)}g</Text>
            {oilAbsorption.frying && fatG > 0 ? (
              <Text style={[type.caption, { color: t.textFaint, marginTop: 2 }]}>
                Oil: {fatG} g in the pan → ~{roundGrams(oilAbsorption.absorbedMid)} g absorbed (medium confidence)
              </Text>
            ) : null}
            <Text style={[type.caption, { color: t.textFaint, marginTop: 2 }]}>Raw {Math.round(totalRawMass)}g → cooked yield {Math.round(cookedYield)}g</Text>
          </View>
        )}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Log household variant" onPress={logDish} style={[s.saveBtn, { backgroundColor: hasUnknowns ? t.bgElevated : t.text, borderColor: t.border }]}>
        <Text style={{ color: hasUnknowns ? t.textMuted : t.bg, fontWeight: 'bold', textAlign: 'center' }}>Log household variant</Text>
      </Pressable>
    </ScrollView>
  )
}

/**
 * QA P2-21: ONE resolver per unresolved component, holding its own query,
 * results, and create-form state. The previous single shared
 * ingredientQuery/ingredientResults pair made every unresolved ingredient's
 * box type into the same query at once, rendered the same result list under
 * all of them, and attached a tapped result to only one row while the others
 * stayed stuck.
 */
function IngredientResolver({
  component,
  db,
  ifctDb,
  userDb,
  onResolve,
}: {
  component: Component
  db: DbAdapter | null
  ifctDb: DbAdapter | null
  userDb: DbAdapter | null
  onResolve: (option: IngredientOption, nutrients: NutrientFetch | null) => void
}) {
  const t = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IngredientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newIngredient, setNewIngredient] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
  const [creating, setCreating] = useState(false)

  // Live multi-corpus ingredient search while typing (debounced, per box).
  useEffect(() => {
    if (!db) return
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const options = await searchIngredientOptions(db, ifctDb ?? undefined, userDb ?? undefined, term)
        if (alive) {
          setResults(options)
          setSearching(false)
        }
      } catch {
        if (alive) setSearching(false)
      }
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, db, ifctDb, userDb])

  const resolve = async (option: IngredientOption) => {
    if (!db) return
    const nutrients = await fetchFoodNutrients(db, ifctDb, userDb, option.foodId)
    onResolve(option, nutrients)
    setQuery('')
    setResults([])
  }

  async function handleCreate() {
    if (!userDb || creating) return
    const name = newIngredient.name.trim()
    const kcal = parseFloat(newIngredient.kcal)
    const protein = parseFloat(newIngredient.protein) || 0
    const carbs = parseFloat(newIngredient.carbs) || 0
    const fat = parseFloat(newIngredient.fat) || 0
    if (!name || !Number.isFinite(kcal) || kcal < 0) {
      showToast({ message: 'Give the ingredient a name and its kcal per 100 g.', tone: 'error' })
      return
    }
    setCreating(true)
    try {
      const food = await createIngredientFood(userDb, { name, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat }, Date.now())
      onResolve(
        { foodId: `userfood:${food.uuid}`, label: food.name, source: 'userfood', kcalPer100g: food.calories },
        { name: food.name, kcal: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g, fat_g: food.fat_g },
      )
      setNewIngredient({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
      setShowCreate(false)
      setQuery('')
      setResults([])
    } catch (e) {
      showToast({ message: `Could not save the ingredient: ${String(e)}`, tone: 'error' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <View style={{ marginTop: space.sm }}>
      <Text style={[type.caption, { color: t.textMuted }]}>Search your foods, IFCT and USDA — results appear as you type.</Text>
      <TextInput
        allowFontScaling
        value={query}
        onChangeText={(text) => { setQuery(text); setShowCreate(false) }}
        placeholder="Search ingredient databases"
        placeholderTextColor={t.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        style={[s.searchInput, { color: t.text, borderColor: t.border }]}
        accessibilityLabel={`Search databases for ${component.name}`}
      />
      {searching && <ActivityIndicator style={{ marginTop: 4 }} color={t.textFaint} />}
      {results.map((res) => (
        <Pressable key={res.foodId} accessibilityRole="button" accessibilityLabel={`Select ${res.label}`} onPress={() => void resolve(res)} style={{ padding: space.sm, borderBottomWidth: 1, borderColor: t.border, minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}>
          <Text style={{ color: t.text }}>{res.label}</Text>
          <Text style={[type.caption, { color: t.textMuted }]}>
            {res.source === 'ifct' ? 'IFCT 2017' : res.source === 'userfood' ? 'Your foods' : 'USDA'}
            {res.kcalPer100g != null ? ` · ${Math.round(res.kcalPer100g)} kcal/100g` : ''}
          </Text>
        </Pressable>
      ))}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Create ${query.trim()} as a custom ingredient`}
          onPress={() => { setNewIngredient((prev) => ({ ...prev, name: query.trim() })); setShowCreate(true) }}
          style={[s.btn, { borderColor: t.protein, paddingVertical: 8 }]}
        >
          <Text style={{ color: t.proteinText, textAlign: 'center' }}>+ Create “{query.trim()}” as a custom ingredient</Text>
        </Pressable>
      )}
      {showCreate && (
        // Wave 3 (Ch. 8.3): the shared form rides the Field primitive now —
        // the per-call-site inputStyle overrides are gone (style drift was the
        // original duplicate-form bug).
        <NewIngredientForm
          value={newIngredient}
          onChange={setNewIngredient}
          onSave={() => void handleCreate()}
          saving={creating}
          containerStyle={[s.summary, { backgroundColor: t.bgSunken, borderColor: t.border, marginTop: space.sm }]}
        />
      )}
    </View>
  )
}

/**
 * O5: one inline clarification card — the engine's question text, the
 * model's answer options as ChipRow chips, and a visible Skip that proceeds
 * with the recipe defaults. An answered card shows what the answer applied
 * (per-serving grams from the clarified derivation); the chips stay tappable
 * so the question stays answerable later. No modals — the composer is a
 * working surface.
 */
function ClarifyQuestionCard({
  question,
  answer,
  skipped,
  appliedGrams,
  onAnswer,
  onSkip,
}: {
  question: ClarificationQuestion
  answer: DishClarificationAnswer | undefined
  skipped: boolean
  appliedGrams: number | null
  onAnswer: (option: ClarificationQuestion['options'][number]) => void
  onSkip: () => void
}) {
  const t = useTheme()
  const chosenLabel = answer
    ? question.options.find((o) => o.canonicalFoodId === answer.canonicalFoodId && o.amountMultiplier === answer.amountMultiplier)?.label ?? null
    : null
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.body, { color: t.text }]}>{question.questionText}</Text>
        <Text style={[type.caption, { color: t.textMuted }]}>{humanizeSlotLabel(question.slotLabel)}</Text>
      </View>
      <ChipRow
        items={question.options}
        keyOf={(option) => option.label}
        label={(option) => option.label}
        a11yLabel={(option) => `${question.questionText}: ${option.label}`}
        isActive={(option) => chosenLabel === option.label}
        onPress={(option) => onAnswer(option)}
      />
      {chosenLabel ? (
        <Text style={[type.caption, { color: t.affirmText }]}>
          {chosenLabel} applied — {appliedGrams != null && appliedGrams > 0 ? `about ${appliedGrams} g per serving` : 'removed from the recipe'}
        </Text>
      ) : skipped ? (
        <Text style={[type.caption, { color: t.textMuted }]}>Skipped — keeping the recipe default.</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip: ${question.questionText}`}
          onPress={onSkip}
          hitSlop={space.sm}
          style={s.skipBtn}
        >
          <Text style={[type.caption, { color: t.textMuted }]}>Skip — keep the recipe default</Text>
        </Pressable>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md },
  alert: { padding: space.md, fontWeight: 'bold' },
  row: { flexDirection: 'row', padding: space.md, borderBottomWidth: 1, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: radius.sm, width: 60, textAlign: 'center', paddingVertical: space.xs, minHeight: MIN_TAP_TARGET },
  searchInput: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.xs, paddingHorizontal: 8, marginTop: 4, minHeight: MIN_TAP_TARGET },
  chip: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
  skipBtn: { minHeight: MIN_TAP_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  btn: { margin: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.md, alignItems: 'center' },
  summary: { margin: space.md, padding: space.md, borderWidth: 1, borderRadius: radius.md },
  saveBtn: { margin: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 }
})
