import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DbAdapter } from '@nutai/db-adapter'
import { loadFood, resolveByText, type NutritionSourceContext, type ScoredCandidate } from '@nutai/resolver'
import {
  decomposeCompositeMeal,
  isCompositeMealQuery,
  computeUnknownDishNutrition,
  COMMON_BASE_INGREDIENTS,
  COOKING_FAT_OPTIONS,
  COOKING_METHOD_OPTIONS,
  type UnknownDishNutritionResult,
} from '@nutai/indian-dishes'
import { ifctCorpusInfo, nutritionCorpusInfo, openIfctDb, openNutritionDb, resetCorpusPromises } from '../src/db/expo-adapter'
import { db as openUserDb } from '../src/data/repo'
import { resolveSelection } from '../src/data/food-search-select'
import { type ManualFoodSelection } from '../src/data/manual-food'
import { createCustomFood } from '../src/data/custom-foods'
import { searchIngredientOptions, createIngredientFood, type IngredientOption } from '../src/data/ingredient-options'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/repo'
import { dishIngredientBreakdown } from '../src/data/dish-ingredients'
import { useTheme } from '../src/theme/ThemeProvider'
import { ChipRow } from '../src/components/ChipRow'
import { NewIngredientForm } from '../src/components/NewIngredientForm'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

interface CompositeMealMatch {
  displayName: string
  selections: ManualFoodSelection[]
  totalKcal: number
  totalProtein: number
  totalCarbs: number
  totalFat: number
}

/**
 * Resolve a tapped row for review. This function never writes a meal.
 */
async function selectFoodForReview(
  nutritionDb: DbAdapter,
  candidate: ScoredCandidate,
  context: NutritionSourceContext,
): Promise<ManualFoodSelection> {
  const resolved = await loadFood(nutritionDb, candidate.foodId, context)
  if (!resolved) {
    if (candidate.source === 'indian_dish_kb') {
      throw new Error('This dish is searchable, but its recipe is still under review. You can decompose it into ingredients below.')
    }
    throw new Error('Selected food is no longer available')
  }
  return resolveSelection(nutritionDb, candidate, resolved)
}

/**
 * Ingredient breakdown for a dish-KB row — shown on the review screen so the
 * user sees WHAT makes up the dish (and can tap through to edit it).
 */
async function loadDishIngredients(nutritionDb: DbAdapter, dishId: string) {
  try {
    const row = await nutritionDb.get<any>(
      'SELECT recipe_template_json, yield_model_json, portion_model_json FROM dish_definitions WHERE id = ?',
      [dishId],
    )
    if (!row) return null
    return dishIngredientBreakdown(row, false)
  } catch {
    return null
  }
}

export default function FoodSearch() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ date?: string }>()
  const intendedDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDate(Date.now())
  const [initialization, setInitialization] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [initAttempt, setInitAttempt] = useState(0)

  const [db, setDb] = useState<DbAdapter | null>(null)
  const [sourceContext, setSourceContext] = useState<NutritionSourceContext>({})
  const [corpus, setCorpus] = useState<{
    foods: number
    portions: number
    builtAt: string | null
    ifctFoods: number
    ifctVersion: string | null
    dishes: number
    dishKb: { dishes: number; fullyMapped: number | null; yieldVerified: number | null } | null
  } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScoredCandidate[]>([])
  const [outcome, setOutcome] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Composite Meal state
  const [compositeMeal, setCompositeMeal] = useState<CompositeMealMatch | null>(null)
  const [loggingComposite, setLoggingComposite] = useState(false)
  // P2-7: free-form "a + b + c" queries are only a GUESS at a multi-item meal.
  // They surface as a passive suggestion the user must tap to build — never as
  // a pre-built confident composition.
  const [compositeSuggestion, setCompositeSuggestion] = useState<{
    displayName: string
    components: Array<{ name: string; query: string; quantity?: number; defaultPortionGrams?: number }>
  } | null>(null)

  // Unknown Dish Fallback / Decomposition state
  const [showDecompose, setShowDecompose] = useState(false)
  const [decomposeName, setDecomposeName] = useState('')
  const [decompItems, setDecompItems] = useState<Array<{ key: string; foodId: string; label: string; source: string; grams: string }>>([])
  const [selectedFatId, setSelectedFatId] = useState<string>(COOKING_FAT_OPTIONS[0].optionId)
  const [fatGrams, setFatGrams] = useState<string>(String(COOKING_FAT_OPTIONS[0].defaultGrams))
  const [selectedMethod, setSelectedMethod] = useState<'curried' | 'sauteed' | 'deep_fried' | 'roasted' | 'boiled'>('curried')
  const [decomposePortion, setDecomposePortion] = useState('150')
  const [computedDecomp, setComputedDecomp] = useState<UnknownDishNutritionResult | null>(null)
  const [savingDecomp, setSavingDecomp] = useState(false)
  // Ingredient picker: search every corpus (user foods + IFCT + USDA) and,
  // when a genuinely missing ingredient turns up, create it on the spot.
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [ingredientResults, setIngredientResults] = useState<IngredientOption[]>([])
  const [ingredientSearching, setIngredientSearching] = useState(false)
  const [showCreateIngredient, setShowCreateIngredient] = useState(false)
  const [newIngredient, setNewIngredient] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
  const [creatingIngredient, setCreatingIngredient] = useState(false)

  function openDecompose(name: string) {
    setDecomposeName(name)
    if (decompItems.length === 0) {
      const first = COMMON_BASE_INGREDIENTS[0]
      setDecompItems([{ key: `seed-${first.optionId}`, foodId: first.foodId, label: first.label, source: 'ifct', grams: String(first.defaultRawGrams) }])
    }
    setShowDecompose(true)
  }

  const initialize = useCallback(async (isAlive: () => boolean) => {
    setInitialization('loading')
    setError(null)
    try {
      const [handle, ifctDb, userDb] = await Promise.all([openNutritionDb(), openIfctDb(), openUserDb()])
      const [info, ifctInfo] = await Promise.all([nutritionCorpusInfo(handle), ifctCorpusInfo(ifctDb)])
      if (!isAlive()) return
      setDb(handle)
      setSourceContext({ ifctDb, userDb })
      setCorpus({ ...info, ifctFoods: ifctInfo.foods, ifctVersion: ifctInfo.version })
      if (info.foods === 0 || ifctInfo.foods === 0) {
        throw new Error(
          info.foods === 0 && ifctInfo.foods === 0
            ? 'Offline food databases are unpopulated or missing.'
            : info.foods === 0
            ? 'USDA food database is empty.'
            : 'IFCT food database is empty.',
        )
      }
      setInitialization('ready')
    } catch (cause) {
      if (!isAlive()) return
      setDb(null)
      setCorpus(null)
      setInitialization('error')
      setError(cause instanceof Error ? cause.message : 'Could not open offline food data')
    }
  }, [])

  useEffect(() => {
    let alive = true
    void initialize(() => alive)
    return () => { alive = false }
  }, [initialize, initAttempt])

  useEffect(() => {
    if (!db || query.trim().length < 2) {
      setResults([])
      setOutcome('')
      setCompositeMeal(null)
      return
    }
    let alive = true
    setBusy(true)
    setError(null)
    const timer = setTimeout(async () => {
      try {
      // 1. Check composite meal
      if (isCompositeMealQuery(query)) {
        const decomposed = decomposeCompositeMeal(query)
        if (decomposed && decomposed.components.length >= 2) {
          if (decomposed.source !== 'known_pairing') {
            // P2-7: a delimiter split of arbitrary text is NOT user intent.
            // Never auto-build a composition from it — offer a suggestion the
            // user must explicitly tap. Splits with more than 5 parts are
            // almost always noise, so do not even suggest those.
            setCompositeMeal(null)
            setCompositeSuggestion(
              decomposed.components.length <= 5
                ? { displayName: decomposed.displayName, components: decomposed.components }
                : null,
            )
          } else {
            setCompositeSuggestion(null)
          const compSelections: ManualFoodSelection[] = []
          let possible = true
          for (const comp of decomposed.components) {
            const compRes = await resolveByText(db, {
              canonicalFoodKey: comp.query,
              observedBrand: null,
              prepFacet: null,
              modelCategory: null,
              estimatedGrams: comp.defaultPortionGrams ?? 100,
            }, sourceContext)

            const matchCandidate = compRes.outcome.kind === 'auto_accept'
              ? compRes.outcome.match
              : compRes.outcome.kind === 'disambiguate'
              ? compRes.outcome.candidates[0]
              : null

            if (matchCandidate) {
              try {
                const resolved = await loadFood(db, matchCandidate.foodId, sourceContext)
                if (resolved) {
                  const sel = await resolveSelection(db, matchCandidate, resolved)
                  if (comp.quantity && comp.quantity > 1) {
                    sel.grams = sel.grams * comp.quantity
                  } else if (comp.defaultPortionGrams && !resolved.servingSizeG) {
                    sel.grams = comp.defaultPortionGrams
                  }
                  compSelections.push(sel)
                } else {
                  possible = false
                  break
                }
              } catch {
                possible = false
                break
              }
            } else {
              possible = false
              break
            }
          }

          if (alive && possible && compSelections.length === decomposed.components.length) {
            const totalKcal = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.kcal * s.grams) / 100), 0)
            const totalProtein = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.protein_g * s.grams) / 100), 0)
            const totalCarbs = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.carbs_g * s.grams) / 100), 0)
            const totalFat = compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.fat_g * s.grams) / 100), 0)

            setCompositeMeal({
              displayName: decomposed.displayName,
              selections: compSelections,
              totalKcal,
              totalProtein,
              totalCarbs,
              totalFat,
            })
          } else if (alive) {
            setCompositeMeal(null)
          }
          }
        }
      } else {
        setCompositeMeal(null)
        setCompositeSuggestion(null)
      }

      // 2. Regular candidate resolution
      const r = await resolveByText(db, {
        canonicalFoodKey: query,
        observedBrand: null,
        prepFacet: null,
        modelCategory: null,
        estimatedGrams: 150,
      }, sourceContext)
      if (!alive) return
      if (r.outcome.kind === 'auto_accept') {
        setResults(r.topCandidates)
        setOutcome('Best match')
      } else if (r.outcome.kind === 'disambiguate') {
        setResults(r.topCandidates)
        setOutcome(`${r.topCandidates.length} matches`)
      } else {
        setResults([])
        setOutcome('no match — decompose into ingredients below')
      }
      } catch (cause) {
        if (alive) {
          setResults([])
          setCompositeMeal(null)
          setCompositeSuggestion(null)
          setOutcome('')
          setError(cause instanceof Error ? cause.message : 'Search failed')
        }
      } finally {
        if (alive) setBusy(false)
      }
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
  }, [db, query, sourceContext])

  // Live unknown dish calculation
  useEffect(() => {
    if (!showDecompose || !db) return
    let alive = true
    const items = decompItems
      .map((item) => ({ foodId: item.foodId, grams: parseFloat(item.grams) || 0 }))
      .filter((item) => item.grams > 0)
    const fatOpt = COOKING_FAT_OPTIONS.find((f) => f.optionId === selectedFatId) ?? COOKING_FAT_OPTIONS[0]
    const fatG = fatOpt.foodId ? parseFloat(fatGrams) || 0 : 0
    const portionG = parseFloat(decomposePortion) || 150

    if (items.length === 0) {
      setComputedDecomp(null)
      return
    }

    computeUnknownDishNutrition({
      dishName: decomposeName.trim() || query.trim() || 'Custom Recipe',
      baseIngredientId: items[0]!.foodId,
      baseIngredientGrams: items[0]!.grams,
      fatId: fatOpt.foodId,
      fatGrams: fatG,
      extraIngredients: items.slice(1),
      cookingMethod: selectedMethod,
      portionGrams: portionG,
    }, db, sourceContext.ifctDb, sourceContext.userDb).then((res) => {
      if (alive) setComputedDecomp(res)
    }).catch(() => {
      if (alive) setComputedDecomp(null)
    })

    return () => { alive = false }
  }, [showDecompose, db, decompItems, selectedFatId, fatGrams, selectedMethod, decomposePortion, decomposeName, query, sourceContext])

  // Ingredient picker: search user foods + IFCT + USDA as the user types.
  useEffect(() => {
    if (!showDecompose || !db) return
    const term = ingredientQuery.trim()
    if (term.length < 2) {
      setIngredientResults([])
      setIngredientSearching(false)
      return
    }
    let alive = true
    setIngredientSearching(true)
    const timer = setTimeout(async () => {
      try {
        const options = await searchIngredientOptions(db, sourceContext.ifctDb, sourceContext.userDb, term)
        if (alive) {
          setIngredientResults(options)
          setIngredientSearching(false)
        }
      } catch {
        if (alive) setIngredientSearching(false)
      }
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [ingredientQuery, showDecompose, db, sourceContext])

  function addDecompItem(foodId: string, label: string, source: string, grams: number) {
    setDecompItems((prev) => {
      if (prev.some((item) => item.foodId === foodId)) return prev
      return [...prev, { key: `${foodId}-${Date.now()}`, foodId, label, source, grams: String(grams) }]
    })
  }

  async function handleCreateIngredient() {
    if (!sourceContext.userDb || creatingIngredient) return
    const name = newIngredient.name.trim()
    const kcal = parseFloat(newIngredient.kcal)
    const protein = parseFloat(newIngredient.protein) || 0
    const carbs = parseFloat(newIngredient.carbs) || 0
    const fat = parseFloat(newIngredient.fat) || 0
    if (!name || !Number.isFinite(kcal) || kcal < 0) {
      setError('Give the ingredient a name and its kcal per 100 g.')
      return
    }
    setCreatingIngredient(true)
    setError(null)
    try {
      const food = await createIngredientFood(sourceContext.userDb, {
        name, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat,
      }, Date.now())
      addDecompItem(`userfood:${food.uuid}`, food.name, 'userfood', 100)
      setNewIngredient({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
      setShowCreateIngredient(false)
      setIngredientQuery('')
      setIngredientResults([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the ingredient')
    } finally {
      setCreatingIngredient(false)
    }
  }

  async function handleSelect(candidate: ScoredCandidate) {
    if (!db || selectingId != null) return
    setSelectingId(candidate.foodId)
    setError(null)
    try {
      if (candidate.source === 'indian_dish_kb' && candidate.basisConfidence === 'low') {
        setSelectingId(null)
        router.push({
          pathname: '/dish-composer',
          params: { dishId: candidate.foodId, date: intendedDate },
        } as never)
        return
      }
      const selection = await selectFoodForReview(db, candidate, sourceContext)
      setSelectingId(null)
      // Dish-KB rows carry their verified ingredient breakdown into review:
      // the user sees what composes the dish and can tap "Edit ingredients".
      let dishExtras: { dishId: string; ingredients: Array<{ label: string; grams: number }> } | undefined
      if (candidate.source === 'indian_dish_kb') {
        const breakdown = await loadDishIngredients(db, candidate.foodId)
        if (breakdown && breakdown.lines.length > 0) {
          dishExtras = {
            dishId: candidate.foodId,
            ingredients: breakdown.lines.map((line) => ({ label: line.display, grams: line.grams })),
          }
        }
      }
      router.push({
        pathname: '/food-review',
        params: { payload: encodeFoodReview({ selection, date: intendedDate, ...dishExtras }) },
      } as never)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Could not log that food — try again.'
      setError(msg)
      setSelectingId(null)
      if (candidate.source === 'indian_dish_kb') {
        openDecompose(candidate.name)
      }
    }
  }

  async function handleSelectComposite() {
    if (!compositeMeal || loggingComposite) return
    setLoggingComposite(true)
    setError(null)
    try {
      const selection: ManualFoodSelection = {
        ...compositeMeal.selections[0]!,
        displayName: compositeMeal.displayName,
        grams: compositeMeal.selections.reduce((sum, item) => sum + item.grams, 0),
      }
      setLoggingComposite(false)
      router.push({ pathname: '/food-review', params: {
        payload: encodeFoodReview({ selection, selections: compositeMeal.selections, date: intendedDate }),
      } } as never)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not log composite meal')
      setLoggingComposite(false)
    }
  }

  /**
   * P2-7: builds the suggested combo ONLY after the user taps it, and ONLY
   * from components the resolver is confident about (auto_accept). If any
   * component would require guessing a candidate, refuse with a clear
   * message instead of fabricating a composition.
   */
  async function handleBuildSuggestedCombo() {
    if (!db || !compositeSuggestion || loggingComposite) return
    setLoggingComposite(true)
    setError(null)
    try {
      const compSelections: ManualFoodSelection[] = []
      for (const comp of compositeSuggestion.components) {
        const compRes = await resolveByText(db, {
          canonicalFoodKey: comp.query,
          observedBrand: null,
          prepFacet: null,
          modelCategory: null,
          estimatedGrams: comp.defaultPortionGrams ?? 100,
        }, sourceContext)
        const match = compRes.outcome.kind === 'auto_accept' ? compRes.outcome.match : null
        if (!match) {
          setCompositeSuggestion(null)
          setError(`Could not confidently match “${comp.name}”. Search it on its own, or use “Decompose into ingredients” below.`)
          return
        }
        const resolved = await loadFood(db, match.foodId, sourceContext)
        if (!resolved) {
          setCompositeSuggestion(null)
          setError(`Could not confidently match “${comp.name}”. Search it on its own, or use “Decompose into ingredients” below.`)
          return
        }
        const sel = await resolveSelection(db, match, resolved)
        if (comp.quantity && comp.quantity > 1) {
          sel.grams = sel.grams * comp.quantity
        } else if (comp.defaultPortionGrams && !resolved.servingSizeG) {
          sel.grams = comp.defaultPortionGrams
        }
        compSelections.push(sel)
      }
      setCompositeMeal({
        displayName: compositeSuggestion.displayName,
        selections: compSelections,
        totalKcal: compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.kcal * s.grams) / 100), 0),
        totalProtein: compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.protein_g * s.grams) / 100), 0),
        totalCarbs: compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.carbs_g * s.grams) / 100), 0),
        totalFat: compSelections.reduce((sum, s) => sum + ((s.nutrientSnapshot.fat_g * s.grams) / 100), 0),
      })
      setCompositeSuggestion(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build that combo meal')
    } finally {
      setLoggingComposite(false)
    }
  }

  function handleLogDecomposed() {
    if (!computedDecomp) return
    if (computedDecomp.per100g.kcal === null || computedDecomp.per100g.protein_g === null || computedDecomp.per100g.carbs_g === null || computedDecomp.per100g.fat_g === null) {
      setError('Core nutrition is unavailable for one of these ingredients. Choose another ingredient before logging.')
      return
    }
    setError(null)
    const selection: ManualFoodSelection = {
      foodId: null,
      matchedFoodSource: 'ingredient_decomposition',
      displayName: computedDecomp.dishName,
      grams: computedDecomp.portionGrams,
      gramPathway: 'decomposed_recipe',
      portionSource: 'user_decomposition',
      nutrientSnapshot: computedDecomp.per100g,
    }
    router.push({
      pathname: '/food-review',
      params: { payload: encodeFoodReview({ selection, date: intendedDate }) },
    } as never)
  }

  async function handleSaveCustomFood() {
    if (!computedDecomp || savingDecomp) return
    if (computedDecomp.serving.kcal === null || computedDecomp.serving.protein_g === null || computedDecomp.serving.carbs_g === null || computedDecomp.serving.fat_g === null) {
      setError('Core nutrition is unavailable for one of these ingredients. Choose another ingredient before saving.')
      return
    }
    setSavingDecomp(true)
    setError(null)
    try {
      const userDb = await openUserDb()
      await createCustomFood(userDb, {
        name: computedDecomp.dishName,
        servingAmount: computedDecomp.portionGrams,
        servingUnit: 'g',
        calories: computedDecomp.serving.kcal,
        protein_g: computedDecomp.serving.protein_g,
        carbs_g: computedDecomp.serving.carbs_g,
        fat_g: computedDecomp.serving.fat_g,
        fiber_g: computedDecomp.serving.fiber_g,
      }, Date.now())
      setShowDecompose(false)
      setSavingDecomp(false)
      setQuery(computedDecomp.dishName)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save custom food')
      setSavingDecomp(false)
    }
  }

  const corpusLine = useMemo(() => {
    if (initialization === 'loading') return 'Loading offline food data…'
    if (initialization === 'error') return error ?? 'Offline food data could not be opened.'
    if (!corpus) return ''
    // P2-14: the header must also account for the dish knowledge base.
    // P1-10: the header states what the shipped artifact actually carries —
    // fully-mapped and yield-verified counts come from its own build_manifest,
    // so the app can never claim more verification than the DB holds.
    const kb = corpus.dishKb
    let dishPart = `${corpus.dishes.toLocaleString()} dish KB`
    if (kb && kb.fullyMapped != null && kb.yieldVerified != null) {
      dishPart = `${kb.dishes.toLocaleString()} dish KB · ${kb.fullyMapped.toLocaleString()} fully mapped · ${kb.yieldVerified.toLocaleString()} yield-verified`
    }
    return `${corpus.ifctFoods.toLocaleString()} IFCT foods · ${corpus.foods.toLocaleString()} USDA foods · ${dishPart} · offline`
  }, [corpus, initialization, error])

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.title, { color: theme.text }]}>Food Database</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: initialization === 'error' ? theme.safety : theme.textMuted, marginTop: space.xs }]}>
        {corpusLine}
      </Text>
      {initialization === 'error' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            resetCorpusPromises()
            setInitAttempt((value) => value + 1)
          }}
          style={[styles.retry, { borderColor: theme.border }]}
        >
          <Text style={[type.label, { color: theme.text }]}>Retry</Text>
        </Pressable>
      )}

      <TextInput
        accessibilityLabel="Search foods"
        placeholder="Search — try “litti chokha”, “idli sambar”, “roti”"
        placeholderTextColor={theme.textFaint}
        value={query}
        editable={initialization === 'ready'}
        onChangeText={(text) => {
          setQuery(text)
          if (showDecompose) setShowDecompose(false)
        }}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
      />

      {busy && <ActivityIndicator style={{ marginTop: space.lg }} color={theme.textFaint} />}

      {outcome !== '' && (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md }]}>{outcome.toUpperCase()}</Text>
      )}

      {error != null && (
        <Text style={[type.caption, { color: theme.safety, marginTop: space.md }]}>{error}</Text>
      )}

      {/* Composite Meal suggestion (P2-7) — passive until tapped */}
      {compositeSuggestion && !compositeMeal && (
        <View style={[styles.compositeCard, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Looks like several items in one meal — nothing is assumed yet:
          </Text>
          <Text style={[type.body, { color: theme.text, marginTop: space.xs }]}>
            {compositeSuggestion.components.map((c) => (c.quantity && c.quantity > 1 ? `${c.quantity}× ${c.name}` : c.name)).join('  +  ')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Build and review this combo meal"
            disabled={loggingComposite}
            onPress={handleBuildSuggestedCombo}
            style={[styles.actionBtn, { alignSelf: 'flex-start', marginTop: space.sm, backgroundColor: theme.bg, borderColor: theme.protein }]}
          >
            <Text style={[type.label, { color: theme.protein, fontWeight: '600' }]}>
              {loggingComposite ? 'Building…' : 'Review this combo'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Composite Meal Banner */}
      {compositeMeal && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review meal ${compositeMeal.displayName}`}
          disabled={loggingComposite}
          onPress={handleSelectComposite}
          style={({ pressed }) => [
            styles.compositeCard,
            { backgroundColor: theme.bgSunken, borderColor: theme.protein, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[type.body, { color: theme.protein, fontWeight: '700' }]}>
              {compositeMeal.displayName}
            </Text>
            {loggingComposite ? (
              <ActivityIndicator size="small" color={theme.protein} />
            ) : (
              <Text style={[type.caption, { color: theme.protein, fontWeight: '600' }]}>Review</Text>
            )}
          </View>
          <Text style={[type.caption, { color: theme.text, marginTop: space.xs }]}>
            {compositeMeal.selections.map((s) => `${s.grams}g ${s.displayName}`).join('  +  ')}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
            Total: {Math.round(compositeMeal.totalKcal)} kcal · {compositeMeal.totalProtein.toFixed(1)}g P · {compositeMeal.totalCarbs.toFixed(1)}g C · {compositeMeal.totalFat.toFixed(1)}g F
          </Text>
        </Pressable>
      )}

      {/* Regular Search Result Rows */}
      {results.map((r) => (
        <Pressable
          key={r.foodId}
          testID={`food-search-row-${r.foodId}`}
          accessibilityRole="button"
          accessibilityLabel={r.source === 'indian_dish_kb' && r.basisConfidence === 'low' ? `Customize draft recipe ${r.name}` : `Review ${r.name}`}
          disabled={selectingId != null}
          onPress={() => handleSelect(r)}
          style={({ pressed }) => [
            styles.row,
            { borderColor: theme.border, minHeight: MIN_TAP_TARGET, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: theme.text }]} numberOfLines={2}>{r.name}</Text>
            {r.source === 'indian_dish_kb' && r.basisConfidence === 'low' ? (
              <View style={{ marginVertical: 4, paddingVertical: 2, paddingHorizontal: 6, borderRadius: radius.sm, backgroundColor: theme.bgSunken, borderWidth: 1, borderColor: theme.safety, alignSelf: 'flex-start' }}>
                <Text style={[type.caption, { color: theme.safety, fontWeight: '700' }]}>
                  DRAFT RECIPE · UNVERIFIED NUTRITION · TAP TO CUSTOMIZE
                </Text>
              </View>
            ) : null}
            <Text style={[type.caption, { color: r.source === 'indian_dish_kb' && r.basisConfidence === 'low' ? theme.safety : theme.textMuted, marginTop: 2 }]}>
              {r.source === 'indian_dish_kb' && r.basisConfidence === 'low'
                ? 'Recipe under review · nutrition unavailable · tap to customize in recipe composer'
                : r.energyKcal != null
                ? `${Math.round(r.energyKcal)} kcal / 100 g`
                : 'Nutrition shown during review'}
              {r.brand ? ` · ${r.brand}` : ''}
            </Text>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
              {sourceLabel(r.source, r.basisConfidence)}
            </Text>
          </View>
          {selectingId === r.foodId ? <ActivityIndicator color={theme.textFaint} /> : null}
        </Pressable>
      ))}

      {/* Unknown Dish / Zero Matches Fallback Button */}
      {initialization === 'ready' && query.trim().length === 2 && !busy && (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.lg }]}>
          Search results appear from 2 characters — dish decomposition needs 3.
        </Text>
      )}
      {initialization === 'ready' && query.trim().length >= 3 && !busy && results.length === 0 && !showDecompose && (
        <View style={{ marginTop: space.lg }}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Nothing matched directly. Build an estimate from ingredients and a cooking method.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => openDecompose(query)}
            style={[styles.actionBtn, { backgroundColor: theme.bgSunken, borderColor: theme.protein }]}
          >
            <Text style={[type.body, { color: theme.protein, fontWeight: '600' }]}>
              Decompose “{query}” into Ingredients
            </Text>
          </Pressable>
        </View>
      )}

      {/* Unknown Dish Decomposition / Recipe Builder Interface */}
      {showDecompose && (
        <View style={[styles.decomposeContainer, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[type.body, { color: theme.text, fontWeight: '700' }]}>
              Dish Recipe Decomposition
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setShowDecompose(false)} hitSlop={space.sm}>
              <Text style={[type.caption, { color: theme.textMuted }]}>✕ Close</Text>
            </Pressable>
          </View>

          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
            Deterministic arithmetic: verified ingredients × yield × portion. No flat guesses.
          </Text>

          {/* Dish Name */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Dish Name</Text>
          <TextInput
            value={decomposeName}
            onChangeText={setDecomposeName}
            placeholder="Dish Name"
            placeholderTextColor={theme.textFaint}
            accessibilityLabel="Dish name"
            style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
          />

          {/* Ingredient list — every ingredient, its grams, removable */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Ingredients (grams as used in the whole dish)</Text>
          {decompItems.map((item) => (
            <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={[type.caption, { color: theme.text }]} numberOfLines={2}>{item.label}</Text>
                <Text style={[type.caption, { color: theme.textFaint }]}>{sourceLabel(item.source, undefined)}</Text>
              </View>
              <TextInput
                accessibilityLabel={`Grams of ${item.label}`}
                value={item.grams}
                onChangeText={(text) => setDecompItems((prev) => prev.map((row) => (row.key === item.key ? { ...row, grams: text } : row)))}
                keyboardType="numeric"
                style={[styles.smallInput, { width: 72, textAlign: 'center', color: theme.text, borderColor: theme.border, backgroundColor: theme.bg, marginTop: 0 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.label}`}
                onPress={() => setDecompItems((prev) => prev.filter((row) => row.key !== item.key))}
                hitSlop={space.sm}
              >
                <Text style={[type.caption, { color: theme.safety }]}>✕</Text>
              </Pressable>
            </View>
          ))}
          {decompItems.length === 0 && (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
              Add at least one ingredient below — the estimate needs some mass to work with.
            </Text>
          )}

          {/* Quick-add common ingredients */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Common ingredients (tap to add)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.xs }}>
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {COMMON_BASE_INGREDIENTS.map((item) => (
                <Pressable
                  key={item.optionId}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.label}`}
                  onPress={() => addDecompItem(item.foodId, item.label, 'ifct', item.defaultRawGrams)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: decompItems.some((row) => row.foodId === item.foodId) ? theme.protein : theme.bg,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[type.caption, { color: decompItems.some((row) => row.foodId === item.foodId) ? theme.bg : theme.text }]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Searchable ingredient picker across ALL databases */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Add any ingredient (searches your foods · IFCT · USDA)</Text>
          <TextInput
            accessibilityLabel="Search ingredients"
            value={ingredientQuery}
            onChangeText={(text) => {
              setIngredientQuery(text)
              setShowCreateIngredient(false)
            }}
            placeholder="e.g. methi, curd, soya chunks…"
            placeholderTextColor={theme.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.smallInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
          />
          {ingredientSearching && <ActivityIndicator style={{ marginTop: space.xs }} color={theme.textFaint} />}
          {ingredientQuery.trim().length >= 2 && !ingredientSearching && ingredientResults.length === 0 && !showCreateIngredient && (
            <View style={{ marginTop: space.xs }}>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                No ingredient named “{ingredientQuery.trim()}” in any database yet.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setNewIngredient((prev) => ({ ...prev, name: ingredientQuery.trim() }))
                  setShowCreateIngredient(true)
                }}
                style={[styles.actionBtn, { alignSelf: 'flex-start', marginTop: space.xs, backgroundColor: theme.bg, borderColor: theme.protein }]}
              >
                <Text style={[type.label, { color: theme.protein, fontWeight: '600' }]}>+ Create “{ingredientQuery.trim()}” as a custom ingredient</Text>
              </Pressable>
            </View>
          )}
          {ingredientResults.map((option) => (
            <Pressable
              key={option.foodId}
              accessibilityRole="button"
              accessibilityLabel={`Add ingredient ${option.label}`}
              onPress={() => addDecompItem(option.foodId, option.label, option.source, 100)}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP_TARGET, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.caption, { color: theme.text }]} numberOfLines={2}>{option.label}</Text>
                <Text style={[type.caption, { color: theme.textFaint }]}>
                  {sourceLabel(option.source, undefined)}{option.kcalPer100g != null ? ` · ${Math.round(option.kcalPer100g)} kcal/100g` : ''}
                </Text>
              </View>
              <Text style={[type.label, { color: theme.protein, fontWeight: '700' }]}>+ Add</Text>
            </Pressable>
          ))}

          {/* P2-30 (a): the shared create-ingredient mini form — this screen and
              dish-composer used to carry verbatim copies that drifted. */}
          {showCreateIngredient && (
            <NewIngredientForm
              value={newIngredient}
              onChange={setNewIngredient}
              onSave={handleCreateIngredient}
              saving={creatingIngredient}
              containerStyle={[styles.nutritionBox, { backgroundColor: theme.bg, borderColor: theme.border, marginTop: space.xs }]}
              nameInputStyle={styles.smallInput}
              macroInputStyle={[styles.smallInput, { marginTop: 0 }]}
            />
          )}

          {/* Cooking Fat / Oil Clarification — P2-30 (b): shared chip row. */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Cooking Fat / Oil (and how much)</Text>
          <ChipRow
            items={COOKING_FAT_OPTIONS}
            keyOf={(item) => item.optionId}
            label={(item) => item.label}
            a11yLabel={(item) => `Select ${item.label}`}
            isActive={(item) => selectedFatId === item.optionId}
            onPress={(item) => {
              setSelectedFatId(item.optionId)
              setFatGrams(String(item.defaultGrams))
            }}
            chipStyle={styles.chip}
          />
          {(() => {
            const fatOpt = COOKING_FAT_OPTIONS.find((f) => f.optionId === selectedFatId) ?? COOKING_FAT_OPTIONS[0]
            if (!fatOpt.foodId) return null
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
                <Text style={[type.caption, { color: theme.textMuted }]}>Oil used (g):</Text>
                <TextInput
                  accessibilityLabel="Grams of cooking oil"
                  value={fatGrams}
                  onChangeText={setFatGrams}
                  keyboardType="numeric"
                  style={[styles.smallInput, { width: 72, textAlign: 'center', color: theme.text, borderColor: theme.border, backgroundColor: theme.bg, marginTop: 0 }]}
                />
              </View>
            )
          })()}

          {/* Cooking Method / Yield Clarification — P2-30 (b): shared chip row. */}
          <Text style={[type.caption, { color: theme.text, marginTop: space.md, fontWeight: '600' }]}>Cooking Method & Yield</Text>
          <ChipRow
            items={COOKING_METHOD_OPTIONS}
            keyOf={(item) => item.method}
            label={(item) => item.label}
            a11yLabel={(item) => `${item.label} cooking method`}
            isActive={(item) => selectedMethod === item.method}
            onPress={(item) => setSelectedMethod(item.method)}
            chipStyle={styles.chip}
          />

          {/* Portion Size (grams) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.md }}>
            <Text style={[type.caption, { color: theme.text, fontWeight: '600' }]}>Portion Size (g):</Text>
            <TextInput
              value={decomposePortion}
              onChangeText={setDecomposePortion}
              keyboardType="numeric"
              style={[styles.smallInput, { width: 80, textAlign: 'center', color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
          </View>

          {/* Live Calculated Nutrition Result */}
          {computedDecomp && (
            <View style={[styles.nutritionBox, { backgroundColor: theme.bg, borderColor: theme.border }]}>
              <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>
                Calculated Serving ({computedDecomp.portionGrams}g):
              </Text>
              <Text style={[type.body, { color: theme.protein, fontWeight: '700', marginTop: 2 }]}>
                {computedDecomp.serving.kcal === null ? 'Calories unknown' : `${Math.round(computedDecomp.serving.kcal)} kcal`} · estimate
              </Text>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                Protein: {computedDecomp.serving.protein_g?.toFixed(1) ?? 'unknown'}g · Carbs: {computedDecomp.serving.carbs_g?.toFixed(1) ?? 'unknown'}g · Fat: {computedDecomp.serving.fat_g?.toFixed(1) ?? 'unknown'}g · Fiber: {computedDecomp.serving.fiber_g?.toFixed(1) ?? 'unknown'}g
              </Text>
              <Text style={[type.caption, { color: theme.textFaint, marginTop: 4 }]}>
                Raw mass: {computedDecomp.rawMassGrams}g → Cooked yield: {Math.round(computedDecomp.cookedYieldGrams)}g
              </Text>
              {computedDecomp.ingredientBreakdown.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={[type.caption, { color: theme.textMuted, fontWeight: '700' }]}>
                    By ingredient (in your {computedDecomp.portionGrams}g serving):
                  </Text>
                  {computedDecomp.ingredientBreakdown.map((part) => {
                    const label = decompItems.find((row) => row.foodId === part.foodId)?.label ?? part.foodId
                    return (
                      <Text key={part.foodId} style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
                        • {label} · {Math.round(part.grams)}g → {part.kcal === null ? 'kcal unknown' : `${Math.round(part.kcal)} kcal`}{part.protein_g != null ? `, P ${part.protein_g.toFixed(1)}g` : ''}{part.carbs_g != null ? `, C ${part.carbs_g.toFixed(1)}g` : ''}{part.fat_g != null ? `, F ${part.fat_g.toFixed(1)}g` : ''}
                      </Text>
                    )
                  })}
                </View>
              )}
            </View>
          )}

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review and log decomposed dish"
              disabled={savingDecomp || !computedDecomp}
              onPress={handleLogDecomposed}
              style={[styles.actionBtn, { flex: 1, backgroundColor: theme.protein, borderColor: theme.protein }]}
            >
              <Text style={[type.body, { color: theme.bg, fontWeight: '600' }]}>Review & log dish</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={savingDecomp || !computedDecomp}
              onPress={handleSaveCustomFood}
              style={[styles.actionBtn, { flex: 1, backgroundColor: theme.bg, borderColor: theme.border }]}
            >
              <Text style={[type.body, { color: theme.text, fontWeight: '600' }]}>Save to Foods</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl }]}>
        IFCT 2017: ICMR-NIN, used with permission. USDA FoodData Central: U.S. public domain.
        Open Food Facts barcode data: ODbL 1.0. Nut AI Indian Dish Knowledge Base.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  retry: { minHeight: MIN_TAP_TARGET, alignSelf: 'flex-start', marginTop: space.sm, paddingHorizontal: space.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  input: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    // Wave 1a: 16px input already matched type.body — reference the token
    // programmatically instead of the literal (Table 3.1).
    fontSize: type.body.fontSize,
    minHeight: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compositeCard: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  actionBtn: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  decomposeContainer: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  smallInput: {
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    // Wave 1a: 14px small input joins the label token (Table 3.1).
    fontSize: type.label.fontSize,
    minHeight: 44,
  },
  chip: {
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  nutritionBox: {
    marginTop: space.md,
    padding: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
})

function sourceLabel(source: string | undefined, basisConfidence?: string): string {
  if (source === 'ifct') return 'IFCT 2017 · ICMR-NIN'
  if (source === 'recipe') return 'HOUSEHOLD RECIPE'
  if (source === 'userfood') return 'YOUR FOOD'
  if (source === 'household_dish') return 'YOUR VERSION'
  if (source === 'off') return 'OPEN FOOD FACTS · ODbL 1.0'
  if (source === 'indian_dish_kb') {
    return basisConfidence === 'low' ? 'INDIAN DISH KB · DRAFT / UNVERIFIED' : 'INDIAN DISH KB · CURATED'
  }
  return 'USDA FOODDATA CENTRAL'
}
